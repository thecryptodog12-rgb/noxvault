//! Noxvault v4.2: vaults whose funds move only with hash-based one-time signatures, with
//! multi-signer approvals, recovery, duress mode, testament, spending rules, schedules, session
//! budgets, migration, invoice addresses and an Escape Hatch for ordinary wallets. See docs/SPEC.md.
#![allow(deprecated)] // solana_program::stake re-exports; the replacement crate needs a newer Rust
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::stake;
use anchor_lang::solana_program::sysvar;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked};

pub mod state;
pub mod wots;

use state::*;
use wots::{ALL_CHAINS, LEN, N};

declare_id!("8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4");

const STAKE_SPACE: u64 = 200;

#[program]
pub mod noxvault {
    use super::*;

    // ---------- vaults ----------

    pub fn init_vault(ctx: Context<InitVault>, config: Config) -> Result<()> {
        let signers = config.signer_trees();
        require!(signers >= 1 && config.threshold >= 1 && config.threshold <= signers, NoxError::BadConfig);
        for (i, t) in config.trees.iter().enumerate() {
            let max = if i as u8 == RECOVERY_TREE { 8 } else { wots::MAX_HEIGHT as u8 };
            require!(if t.used() { (1..=max).contains(&t.height) } else { t.height == 0 }, NoxError::BadConfig);
        }
        require!(!config.has_recovery() || config.recovery_delay > 0, NoxError::BadConfig);
        // Duress (docs/SPEC.md §11): always filled, never sharing a root with another slot.
        let d = config.duress;
        require!(d.used() && (1..=wots::MAX_HEIGHT as u8).contains(&d.height), NoxError::BadConfig);
        // v4.1 (G-05): no root in two slots, so one phrase never counts twice and one leaf never
        // signs two digests (one per slot).
        require!(config.roots_distinct(), NoxError::DuplicateRoot);
        require!(config.duress_lock >= MIN_DURESS_LOCK, NoxError::BadConfig);
        require!(config.slow_delay >= 0 && config.testament_delay >= 0 && config.recovery_delay >= 0, NoxError::BadConfig);
        // v4.1 (G-08): every delay at most 10 years, so `now + delay` can never overflow.
        require!(config.durations_bounded(), NoxError::DurationTooLong);
        let bps: u32 = config.heirs.iter().filter(|h| h.addr != Pubkey::default()).map(|h| h.bps as u32).sum();
        let any_heir = config.heirs.iter().any(|h| h.addr != Pubkey::default());
        require!(!any_heir || bps == 10_000, NoxError::BadConfig);
        require!(config.testament_delay == 0 || any_heir, NoxError::BadConfig);

        let hash = wots::config_hash(&config.try_to_vec()?);
        let (vault, bump) = Pubkey::find_program_address(&[VAULT_SEED, &hash], &crate::ID);
        require_keys_eq!(vault, ctx.accounts.vault.key(), NoxError::WrongVault);

        // $NOX tiers (docs/SPEC.md §10): multi-signer vaults need Sentinel, a testament Guardian;
        // a free-tier vault pays the creation fee. Safety features never need a tier.
        let p = &ctx.accounts.protocol.params;
        let tier = tier_of(p, &vault, &ctx.accounts.nox_account)?;
        if signers > 1 {
            require!(tier >= TIER_SENTINEL, NoxError::TierTooLow);
        }
        if config.testament_active() {
            require!(tier >= TIER_GUARDIAN, NoxError::TierTooLow);
        }
        if tier == TIER_FREE && p.create_fee > 0 {
            require_keys_eq!(ctx.accounts.treasury.key(), p.treasury, NoxError::WrongDest);
            system_program::transfer(
                CpiContext::new(ctx.accounts.system_program.to_account_info(), system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                }),
                p.create_fee,
            )?;
        }
        let now = Clock::get()?.unix_timestamp;
        let s = &mut ctx.accounts.state;
        s.vault = vault;
        s.vault_bump = bump;
        s.config_hash = hash;
        s.config = config;
        s.last_active = now;
        s.created_at = now;
        s.window_start = now;
        Ok(())
    }

    // ---------- one-time signatures ----------

    pub fn open_unlock(
        ctx: Context<OpenUnlock>,
        tree: u8,
        leaf: u16,
        pk_seed: [u8; N],
        auth_path: Vec<[u8; N]>,
        action: Action,
    ) -> Result<()> {
        let st = &ctx.accounts.state;
        let t = tree_of(&st.config, tree).ok_or(NoxError::BadTree)?;
        require!(t.used() && auth_path.len() == t.height as usize, NoxError::BadTree);
        require!((leaf as u32) < (1u32 << t.height), NoxError::BadTree);
        require!(!st.used(tree, leaf), NoxError::KeyUsed);
        let vault = ctx.accounts.vault.key();
        match &action.kind {
            Kind::Withdraw { dest, amount, .. } => {
                require_keys_neq!(*dest, vault, NoxError::DestIsVault);
                require!(*amount > 0, NoxError::ZeroAmount);
            }
            Kind::Stake { amount, .. } => require!(*amount > 0, NoxError::ZeroAmount),
            Kind::Migrate { new_vault } => require_keys_neq!(*new_vault, vault, NoxError::DestIsVault),
            _ => {}
        }
        // v4.1: refuse here what can never execute, before a one-time key is burned on it.
        require!(action.fee <= MAX_ACTION_FEE, NoxError::FeeTooHigh);
        require!(action.durations_bounded(), NoxError::DurationTooLong);
        require!(action.lock_bounded(), NoxError::LockOutOfRange);
        if tree < RECOVERY_TREE && action.fee > 0 {
            require!(!st.locked(Clock::get()?.unix_timestamp), NoxError::FeeInLockdown);
        }
        let bytes = action.try_to_vec()?;
        require!(bytes.len() <= MAX_ACTION, NoxError::BadAction);

        let mut u = ctx.accounts.unlock.load_init()?;
        u.vault = vault;
        u.payer = ctx.accounts.payer.key();
        u.pk_seed = pk_seed;
        for (i, p) in auth_path.iter().enumerate() {
            u.auth_path[i] = *p;
        }
        u.action[..bytes.len()].copy_from_slice(&bytes);
        u.action_len = bytes.len() as u16;
        u.leaf = leaf;
        u.tree = tree;
        u.height = t.height;
        u.bump = ctx.bumps.unlock;
        Ok(())
    }

    pub fn write_sigs(ctx: Context<WriteSigs>, start: u8, sigs: Vec<[u8; N]>) -> Result<()> {
        let mut u = ctx.accounts.unlock.load_mut()?;
        require!(u.frozen == 0, NoxError::Frozen);
        let start = start as usize;
        require!(start + sigs.len() <= LEN, NoxError::ChainOutOfRange);
        for (i, s) in sigs.iter().enumerate() {
            u.sigs[start + i] = *s;
            u.written |= 1 << (start + i);
        }
        Ok(())
    }

    /// Walks chains `from..to` to their ends. Freezes the buffer on first use. Permissionless.
    pub fn verify(ctx: Context<Verify>, from: u8, to: u8) -> Result<()> {
        let mut u = ctx.accounts.unlock.load_mut()?;
        if u.frozen == 0 {
            require!(u.written == ALL_CHAINS, NoxError::SignatureIncomplete);
            let len = u.action_len as usize;
            let d = wots::message_digest(u.vault.as_ref(), u.tree, u.leaf, &u.action[..len]);
            u.digits = wots::digits(&d);
            u.frozen = 1;
        }
        require!(from < to && (to as usize) <= LEN, NoxError::ChainOutOfRange);
        for j in from..to {
            let bit = 1u64 << j;
            if u.verified & bit != 0 {
                continue;
            }
            let i = j as usize;
            let end = wots::chain_to_end(&u.pk_seed, u.leaf, j, u.sigs[i], u.digits[i]);
            u.ends[i] = end;
            u.verified |= bit;
        }
        Ok(())
    }

    /// Turns a verified signature into an approval of its action and burns the key.
    pub fn approve(ctx: Context<Approve>, action_hash: [u8; N]) -> Result<()> {
        let a = &mut *ctx.accounts;
        let u = a.unlock.load()?;
        require_keys_eq!(u.payer, a.rent_receiver.key(), NoxError::WrongPayer);
        require_keys_eq!(u.vault, a.state.vault, NoxError::WrongVault);
        require!(u.verified == ALL_CHAINS, NoxError::NotVerified);
        let t = tree_of(&a.state.config, u.tree).ok_or(NoxError::BadTree)?;
        require!(t.used() && t.height == u.height, NoxError::BadTree);
        let leaf = wots::leaf_hash(&u.pk_seed, u.leaf, &u.ends);
        let root = wots::root_from_path(&u.pk_seed, u.leaf, leaf, &u.auth_path[..t.height as usize]);
        require!(root == t.root, NoxError::BadSignature);
        require!(!a.state.used(u.tree, u.leaf), NoxError::KeyUsed);
        let bytes = &u.action[..u.action_len as usize];
        require!(wots::action_hash(bytes) == action_hash, NoxError::WrongAction);

        let now = Clock::get()?.unix_timestamp;
        let ap = &mut a.approval;
        if ap.vault == Pubkey::default() {
            ap.vault = a.state.vault;
            ap.action_hash = action_hash;
            ap.action[..bytes.len()].copy_from_slice(bytes);
            ap.action_len = bytes.len() as u16;
            ap.creator = a.payer.key();
            ap.created_at = now;
        }
        ap.trees |= 1 << u.tree;
        let (tree, leaf_index) = (u.tree, u.leaf);
        drop(u);
        a.state.mark_used(tree, leaf_index);
        // Signer and duress approvals both count as activity: a duress signature looks like any other.
        // v4.2: not during a lockdown. A thief holding only the signer phrase, frozen by a
        // recovery `CancelLock`, must not keep the vault "active" with Pings and cancels and so
        // postpone recovery-after-inactivity forever (docs/SPEC.md §4, INVARIANTS.md A-13).
        if tree != RECOVERY_TREE && !a.state.locked(now) {
            a.state.last_active = now;
        }
        Ok(())
    }

    /// Closes an approval that never reached its threshold, after 7 days.
    pub fn discard_approval(ctx: Context<DiscardApproval>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(now >= ctx.accounts.approval.created_at.saturating_add(APPROVAL_TTL), NoxError::NotYet);
        Ok(())
    }

    pub fn cancel_unlock(_ctx: Context<CancelUnlock>) -> Result<()> {
        Ok(())
    }

    // ---------- executing approved actions ----------

    pub fn execute_withdraw(ctx: Context<ExecuteWithdraw>) -> Result<()> {
        let a = &mut *ctx.accounts;
        let (action, mode) = authorize(&a.approval, &a.state)?;
        let Kind::Withdraw { mint, dest, amount } = action.kind.clone() else {
            return err!(NoxError::WrongAction);
        };
        require_keys_eq!(mint, Pubkey::default(), NoxError::WrongAction);
        require_keys_eq!(dest, a.dest.key(), NoxError::WrongDest);
        let seeds_owned = vault_seeds(&a.state);
        let seeds = seeds_owned.as_slices();
        if mode == Mode::Duress {
            // docs/SPEC.md §11: pay at most duress_limit at once (fee included, nothing during a
            // lockdown already running), ignoring whitelist, instant limit and delay; then lock.
            let now = Clock::get()?.unix_timestamp;
            let (limit, lock) = (a.state.config.duress_limit, a.state.config.duress_lock);
            let above_rent = a.vault.lamports().saturating_sub(Rent::get()?.minimum_balance(0));
            let mut allowance = if a.state.locked(now) { 0 } else { limit.min(above_rent) };
            let fee = action.fee.min(allowance);
            if fee > 0 {
                require_keys_eq!(action.fee_payee, a.fee_payee.key(), NoxError::WrongFeePayee);
                sol_out(&a.system_program, &a.vault, &a.fee_payee, &seeds, fee)?;
            }
            allowance -= fee;
            sol_out(&a.system_program, &a.vault, &a.dest, &seeds, amount.min(allowance))?;
            a.state.extend_lockdown(now, lock);
            a.state.actions += 1;
            return check_rent(&a.vault);
        }
        let unrestricted = mode == Mode::Unrestricted;
        if gate(&mut a.state, PENDING_WITHDRAW, mint, dest, amount, unrestricted)? {
            require!(amount <= a.vault.lamports(), NoxError::InsufficientFunds);
            sol_out(&a.system_program, &a.vault, &a.dest, &seeds, amount)?;
        }
        pay_fee(&a.system_program, &a.vault, &a.fee_payee, &seeds, &action)?;
        a.state.actions += 1;
        check_rent(&a.vault)
    }

    pub fn execute_withdraw_token(ctx: Context<ExecuteWithdrawToken>) -> Result<()> {
        let a = &mut *ctx.accounts;
        let (action, unrestricted) = authorize_full(&a.approval, &a.state)?;
        let Kind::Withdraw { mint, dest, amount } = action.kind.clone() else {
            return err!(NoxError::WrongAction);
        };
        require_keys_eq!(mint, a.mint.key(), NoxError::WrongAction);
        require_keys_eq!(dest, a.dest.key(), NoxError::WrongDest);
        let seeds_owned = vault_seeds(&a.state);
        let seeds = seeds_owned.as_slices();
        if gate(&mut a.state, PENDING_WITHDRAW, mint, dest, amount, unrestricted)? {
            require!(amount <= a.vault_ata.amount, NoxError::InsufficientFunds);
            token_out(&a.token_program, &a.vault_ata, &a.dest_ata, &a.vault, &a.mint, &seeds, amount)?;
        }
        pay_fee(&a.system_program, &a.vault, &a.fee_payee, &seeds, &action)?;
        a.state.actions += 1;
        check_rent(&a.vault)
    }

    pub fn execute_stake(ctx: Context<ExecuteStake>) -> Result<()> {
        let a = &mut *ctx.accounts;
        let (action, _) = authorize_full(&a.approval, &a.state)?;
        let Kind::Stake { seed, vote, amount } = action.kind.clone() else {
            return err!(NoxError::WrongAction);
        };
        require_keys_eq!(vote, a.vote.key(), NoxError::WrongAction);
        let vault = a.vault.key();
        let (stake_key, stake_bump) = Pubkey::find_program_address(&[STAKE_SEED, vault.as_ref(), &[seed]], &crate::ID);
        require_keys_eq!(stake_key, a.stake.key(), NoxError::WrongStake);
        require!(amount <= a.vault.lamports(), NoxError::InsufficientFunds);
        let seeds_owned = vault_seeds(&a.state);
        let seeds = seeds_owned.as_slices();
        let stake_seeds: &[&[u8]] = &[STAKE_SEED, vault.as_ref(), &[seed], &[stake_bump]];
        system_program::create_account(
            CpiContext::new_with_signer(
                a.system_program.to_account_info(),
                system_program::CreateAccount { from: a.vault.to_account_info(), to: a.stake.to_account_info() },
                &[&seeds[..], stake_seeds],
            ),
            amount,
            STAKE_SPACE,
            &stake::program::ID,
        )?;
        let authorized = stake::state::Authorized { staker: vault, withdrawer: vault };
        invoke_signed(
            &stake::instruction::initialize(&stake_key, &authorized, &stake::state::Lockup::default()),
            &[a.stake.to_account_info(), a.rent.to_account_info(), a.stake_program.to_account_info()],
            &[],
        )?;
        invoke_signed(
            &stake::instruction::delegate_stake(&stake_key, &vault, &a.vote.key()),
            &[
                a.stake.to_account_info(),
                a.vote.to_account_info(),
                a.clock.to_account_info(),
                a.stake_history.to_account_info(),
                a.stake_config.to_account_info(),
                a.vault.to_account_info(),
                a.stake_program.to_account_info(),
            ],
            &[&seeds],
        )?;
        pay_fee(&a.system_program, &a.vault, &a.fee_payee, &seeds, &action)?;
        a.state.actions += 1;
        check_rent(&a.vault)
    }

    /// Unstake and CollectStake.
    pub fn execute_stake_authority(ctx: Context<ExecuteStakeAuthority>) -> Result<()> {
        let a = &mut *ctx.accounts;
        let (action, _) = authorize_full(&a.approval, &a.state)?;
        let seed = match action.kind {
            Kind::Unstake { seed } | Kind::CollectStake { seed } => seed,
            _ => return err!(NoxError::WrongAction),
        };
        let collect = matches!(action.kind, Kind::CollectStake { .. });
        let seeds_owned = vault_seeds(&a.state);
        let seeds = seeds_owned.as_slices();
        stake_authority(&a.vault, &a.stake, &a.clock.to_account_info(), &a.stake_history, &a.stake_program, &seeds, seed, collect)?;
        pay_fee(&a.system_program, &a.vault, &a.fee_payee, &seeds, &action)?;
        a.state.actions += 1;
        check_rent(&a.vault)
    }

    /// Cancel, CancelLock, Ping, CancelSchedule, CancelBudget and Migrate.
    pub fn execute_admin(ctx: Context<ExecuteAdmin>) -> Result<()> {
        let a = &mut *ctx.accounts;
        let (action, unrestricted) = authorize_full(&a.approval, &a.state)?;
        let by_recovery = a.approval.trees & (1 << RECOVERY_TREE) != 0;
        let by_signers = (a.approval.trees & SIGNER_BITS).count_ones() as u8 >= a.state.config.threshold;
        let now = Clock::get()?.unix_timestamp;
        let locked = a.state.locked(now);
        let vault = a.vault.to_account_info();
        match action.kind.clone() {
            Kind::Cancel => {
                // v4.1 (G-04): Cancel stops everything still waiting: the pending withdrawal or
                // migration, and a started migration (`migrate_to`) whatever it has not swept yet.
                a.state.pending = None;
                // v4.2: during a lockdown only a Cancel the recovery tree approved stops a started
                // migration, so a frozen signer phrase cannot interrupt the owner's escape.
                if by_recovery || !locked {
                    a.state.migrate_to = None;
                }
                // The recovery holder, not the coerced owner, decides when a lockdown ends.
                if by_recovery {
                    a.state.lockdown_until = 0;
                }
            }
            Kind::CancelLock { secs } => {
                // v4.2: Cancel, then freeze (authorize checked the recovery bit and the bounds).
                // Extends a running lockdown, never shortens it.
                a.state.pending = None;
                a.state.migrate_to = None;
                a.state.extend_lockdown(now, secs);
            }
            Kind::Ping => {}
            Kind::CancelSchedule { id } => {
                let s = a.schedule.as_ref().ok_or(NoxError::MissingAccount)?;
                require!(s.id == id && s.vault == a.vault.key(), NoxError::WrongAction);
                s.close(vault.clone())?;
            }
            Kind::CancelBudget { id } => {
                let b = a.budget.as_ref().ok_or(NoxError::MissingAccount)?;
                require!(b.id == id && b.vault == a.vault.key(), NoxError::WrongAction);
                b.close(vault.clone())?;
            }
            Kind::Migrate { new_vault } => {
                let ns = a.new_state.as_ref().ok_or(NoxError::MissingAccount)?;
                require_keys_eq!(ns.vault, new_vault, NoxError::WrongDest);
                // v4.1 (G-02): the same rule as withdrawals (§3), instant limit included. A
                // migration moves everything, so it never uses the instant allowance.
                // v4.2, the escape: during a lockdown the signers and the recovery tree together
                // migrate at once (a waiting migration could not run before the lockdown ends,
                // and the frozen signer phrase could cancel it).
                let escape = locked && by_recovery && by_signers;
                if !unrestricted && !escape && a.state.config.restricted(&new_vault) {
                    let c = &a.state.config;
                    require!(c.slow_delay > 0, NoxError::NotWhitelisted);
                    require!(a.state.pending.is_none(), NoxError::PendingExists);
                    let executable_at = now.saturating_add(c.slow_delay);
                    a.state.pending =
                        Some(Pending { kind: PENDING_MIGRATE, mint: Pubkey::default(), dest: new_vault, amount: 0, executable_at });
                } else {
                    a.state.migrate_to = Some(new_vault);
                }
            }
            _ => return err!(NoxError::WrongAction),
        }
        let seeds_owned = vault_seeds(&a.state);
        pay_fee(&a.system_program, &a.vault, &a.fee_payee, &seeds_owned.as_slices(), &action)?;
        a.state.actions += 1;
        check_rent(&a.vault)
    }

    pub fn execute_create_schedule(ctx: Context<ExecuteCreateSchedule>, id: u8) -> Result<()> {
        let a = &mut *ctx.accounts;
        let (action, unrestricted) = authorize_full(&a.approval, &a.state)?;
        let tier = tier_of(&a.protocol.params, &a.vault.key(), &a.nox_account)?;
        require!(tier >= TIER_GUARDIAN, NoxError::TierTooLow);
        let Kind::Schedule { id: sid, mint, dest, amount, interval, count, start } = action.kind.clone() else {
            return err!(NoxError::WrongAction);
        };
        require!(sid == id, NoxError::WrongAction);
        require!(amount > 0 && interval > 0 && count > 0, NoxError::BadAction);
        require!(interval <= MAX_DURATION, NoxError::DurationTooLong);
        require_keys_neq!(dest, a.vault.key(), NoxError::DestIsVault);
        let now = Clock::get()?.unix_timestamp;
        let mut first = start.max(now);
        if !unrestricted && a.state.config.restricted(&dest) {
            require!(a.state.config.slow_delay > 0, NoxError::NotWhitelisted);
            first = first.max(now.saturating_add(a.state.config.slow_delay));
        }
        let s = &mut a.schedule;
        s.vault = a.vault.key();
        s.id = id;
        s.mint = mint;
        s.dest = dest;
        s.amount = amount;
        s.interval = interval;
        s.remaining = count;
        s.next_at = first;
        let seeds_owned = vault_seeds(&a.state);
        pay_fee(&a.system_program, &a.vault, &a.fee_payee, &seeds_owned.as_slices(), &action)?;
        a.state.actions += 1;
        check_rent(&a.vault)
    }

    pub fn execute_create_budget(ctx: Context<ExecuteCreateBudget>, id: u8) -> Result<()> {
        let a = &mut *ctx.accounts;
        let (action, _) = authorize_full(&a.approval, &a.state)?;
        let tier = tier_of(&a.protocol.params, &a.vault.key(), &a.nox_account)?;
        require!(tier >= TIER_GUARDIAN, NoxError::TierTooLow);
        let Kind::Budget { id: bid, session, mint, limit, period, expires } = action.kind.clone() else {
            return err!(NoxError::WrongAction);
        };
        require!(bid == id, NoxError::WrongAction);
        let now = Clock::get()?.unix_timestamp;
        require!(session != Pubkey::default() && limit > 0 && period > 0 && expires > now, NoxError::BadAction);
        require!(period <= MAX_DURATION, NoxError::DurationTooLong);
        // v4.1 (G-03): a budget only ever pays non-restricted destinations; refuse one that could
        // never spend (every destination restricted: no whitelist and an instant limit).
        require!(a.state.config.has_unrestricted(), NoxError::BudgetDestRestricted);
        let b = &mut a.budget;
        b.vault = a.vault.key();
        b.id = id;
        b.session = session;
        b.mint = mint;
        b.limit = limit;
        b.period = period;
        b.expires = expires;
        b.window_start = now;
        b.spent = 0;
        let seeds_owned = vault_seeds(&a.state);
        pay_fee(&a.system_program, &a.vault, &a.fee_payee, &seeds_owned.as_slices(), &action)?;
        a.state.actions += 1;
        check_rent(&a.vault)
    }

    /// LetterKey (docs/SPEC.md §12): only a signer-threshold approval sets the letter key. Duress
    /// and recovery approvals never do, not even after the owner's inactivity.
    pub fn execute_letter_key(ctx: Context<ExecuteLetterKey>) -> Result<()> {
        let a = &mut *ctx.accounts;
        let (action, mode) = authorize(&a.approval, &a.state)?;
        let signers = (a.approval.trees & SIGNER_BITS).count_ones() as u8;
        require!(mode == Mode::Normal && signers >= a.state.config.threshold, NoxError::LetterKeySignersOnly);
        let Kind::LetterKey { key } = action.kind.clone() else {
            return err!(NoxError::WrongAction);
        };
        let lk = &mut a.letter_key;
        lk.vault = a.vault.key();
        lk.key = key;
        lk.updated_at = Clock::get()?.unix_timestamp;
        let seeds_owned = vault_seeds(&a.state);
        pay_fee(&a.system_program, &a.vault, &a.fee_payee, &seeds_owned.as_slices(), &action)?;
        a.state.actions += 1;
        check_rent(&a.vault)
    }

    // ---------- sealed letters (docs/SPEC.md §12) ----------

    /// Creates or overwrites letter `id`: sizes it for `len` ciphertext bytes and writes the first
    /// `data` bytes (the rest follows with `append_letter`). Signed and paid by the letter key;
    /// never touches the vault's funds or its activity clock.
    pub fn write_letter(ctx: Context<WriteLetter>, id: u32, unlock_round: u64, label: Vec<u8>, len: u32, data: Vec<u8>) -> Result<()> {
        let len = len as usize;
        require!(label.len() <= MAX_LETTER_LABEL && len > 0 && len <= MAX_LETTER, NoxError::LetterTooBig);
        require!(data.len() <= len, NoxError::LetterOverflow);
        let a = &ctx.accounts;
        let info = a.letter.to_account_info();
        let key = a.key.to_account_info();
        let vault = a.vault.key();
        let space = Letter::space(label.len(), len);
        let rent = Rent::get()?.minimum_balance(space);
        let have = info.lamports();
        if have < rent {
            system_program::transfer(
                CpiContext::new(a.system_program.to_account_info(), system_program::Transfer { from: key.clone(), to: info.clone() }),
                rent - have,
            )?;
        }
        if *info.owner == system_program::ID {
            let idb = id.to_le_bytes();
            let seeds: &[&[u8]] = &[LETTER_SEED, vault.as_ref(), &idb, &[ctx.bumps.letter]];
            let sys = a.system_program.to_account_info();
            system_program::allocate(
                CpiContext::new_with_signer(sys.clone(), system_program::Allocate { account_to_allocate: info.clone() }, &[seeds]),
                space as u64,
            )?;
            system_program::assign(
                CpiContext::new_with_signer(sys, system_program::Assign { account_to_assign: info.clone() }, &[seeds]),
                &crate::ID,
            )?;
        } else {
            require_keys_eq!(*info.owner, crate::ID, NoxError::WrongAction);
            let old = Letter::try_deserialize(&mut &info.try_borrow_data()?[..])?;
            require_keys_eq!(old.vault, vault, NoxError::WrongVault);
            if have > rent {
                // Shrinking: the letter key gets the spare rent back.
                **info.try_borrow_mut_lamports()? -= have - rent;
                **key.try_borrow_mut_lamports()? += have - rent;
            }
            info.realloc(space, false)?;
        }
        let filled = data.len() as u32;
        let mut content = data;
        content.resize(len, 0);
        let letter = Letter { vault, id, unlock_round, updated_at: Clock::get()?.unix_timestamp, filled, label, content };
        let mut buf = info.try_borrow_mut_data()?;
        letter.try_serialize(&mut &mut buf[..])?;
        Ok(())
    }

    /// Writes the next chunk of a letter's ciphertext, at `offset` == bytes filled so far.
    pub fn append_letter(ctx: Context<AppendLetter>, _id: u32, offset: u32, data: Vec<u8>) -> Result<()> {
        let l = &mut ctx.accounts.letter;
        let end = (offset as usize).checked_add(data.len()).ok_or(NoxError::LetterOverflow)?;
        require!(offset == l.filled && end <= l.content.len(), NoxError::LetterOverflow);
        l.content[offset as usize..end].copy_from_slice(&data);
        l.filled = end as u32;
        l.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Deletes a letter; its rent goes back to the letter key.
    pub fn close_letter(_ctx: Context<CloseLetter>, _id: u32) -> Result<()> {
        Ok(())
    }

    // ---------- permissionless follow-ups ----------

    /// Pays the pending SOL withdrawal, or starts the pending migration, once due.
    pub fn execute_pending(ctx: Context<ExecutePending>) -> Result<()> {
        let a = &mut *ctx.accounts;
        not_locked(&a.state)?;
        let p = take_due_pending(&mut a.state)?;
        if p.kind == PENDING_MIGRATE {
            a.state.migrate_to = Some(p.dest);
            return Ok(());
        }
        require_keys_eq!(p.mint, Pubkey::default(), NoxError::WrongAction);
        require_keys_eq!(p.dest, a.dest.key(), NoxError::WrongDest);
        require!(p.amount <= a.vault.lamports(), NoxError::InsufficientFunds);
        let seeds_owned = vault_seeds(&a.state);
        sol_out(&a.system_program, &a.vault, &a.dest, &seeds_owned.as_slices(), p.amount)?;
        check_rent(&a.vault)
    }

    pub fn execute_pending_token(ctx: Context<ExecutePendingToken>) -> Result<()> {
        let a = &mut *ctx.accounts;
        not_locked(&a.state)?;
        let p = take_due_pending(&mut a.state)?;
        require!(p.kind == PENDING_WITHDRAW, NoxError::WrongAction);
        require_keys_eq!(p.mint, a.mint.key(), NoxError::WrongAction);
        require_keys_eq!(p.dest, a.dest.key(), NoxError::WrongDest);
        require!(p.amount <= a.vault_ata.amount, NoxError::InsufficientFunds);
        let seeds_owned = vault_seeds(&a.state);
        token_out(&a.token_program, &a.vault_ata, &a.dest_ata, &a.vault, &a.mint, &seeds_owned.as_slices(), p.amount)
    }

    pub fn run_schedule(ctx: Context<RunSchedule>) -> Result<()> {
        let a = &mut *ctx.accounts;
        let amount = schedule_due(&mut a.schedule)?;
        require_keys_eq!(a.schedule.mint, Pubkey::default(), NoxError::WrongAction);
        require_keys_eq!(a.schedule.dest, a.dest.key(), NoxError::WrongDest);
        require!(amount <= a.vault.lamports(), NoxError::InsufficientFunds);
        let seeds_owned = vault_seeds(&a.state);
        sol_out(&a.system_program, &a.vault, &a.dest, &seeds_owned.as_slices(), amount)?;
        if a.schedule.remaining == 0 {
            a.schedule.close(a.vault.to_account_info())?;
        }
        check_rent(&a.vault)
    }

    pub fn run_schedule_token(ctx: Context<RunScheduleToken>) -> Result<()> {
        let a = &mut *ctx.accounts;
        let amount = schedule_due(&mut a.schedule)?;
        require_keys_eq!(a.schedule.mint, a.mint.key(), NoxError::WrongAction);
        require_keys_eq!(a.schedule.dest, a.dest.key(), NoxError::WrongDest);
        require!(amount <= a.vault_ata.amount, NoxError::InsufficientFunds);
        let seeds_owned = vault_seeds(&a.state);
        token_out(&a.token_program, &a.vault_ata, &a.dest_ata, &a.vault, &a.mint, &seeds_owned.as_slices(), amount)?;
        if a.schedule.remaining == 0 {
            a.schedule.close(a.vault.to_account_info())?;
        }
        Ok(())
    }

    /// An ordinary session key spends from its budget (docs/SPEC.md §4).
    pub fn spend_budget(ctx: Context<SpendBudget>, amount: u64) -> Result<()> {
        let a = &mut *ctx.accounts;
        not_locked(&a.state)?;
        budget_spend(&mut a.budget, &a.state, &a.dest.key(), Pubkey::default(), amount)?;
        require!(amount <= a.vault.lamports(), NoxError::InsufficientFunds);
        let seeds_owned = vault_seeds(&a.state);
        sol_out(&a.system_program, &a.vault, &a.dest, &seeds_owned.as_slices(), amount)?;
        check_rent(&a.vault)
    }

    pub fn spend_budget_token(ctx: Context<SpendBudgetToken>, amount: u64) -> Result<()> {
        let a = &mut *ctx.accounts;
        not_locked(&a.state)?;
        budget_spend(&mut a.budget, &a.state, &a.dest.key(), a.mint.key(), amount)?;
        require!(amount <= a.vault_ata.amount, NoxError::InsufficientFunds);
        let seeds_owned = vault_seeds(&a.state);
        token_out(&a.token_program, &a.vault_ata, &a.dest_ata, &a.vault, &a.mint, &seeds_owned.as_slices(), amount)
    }

    pub fn migrate_sol(ctx: Context<MigrateSol>) -> Result<()> {
        let a = &mut *ctx.accounts;
        require!(a.state.migrate_to == Some(a.new_vault.key()), NoxError::WrongDest);
        let all = a.vault.lamports();
        let seeds_owned = vault_seeds(&a.state);
        sol_out(&a.system_program, &a.vault, &a.new_vault, &seeds_owned.as_slices(), all)
    }

    pub fn migrate_token(ctx: Context<MigrateToken>) -> Result<()> {
        let a = &mut *ctx.accounts;
        require!(a.state.migrate_to == Some(a.new_vault.key()), NoxError::WrongDest);
        let seeds_owned = vault_seeds(&a.state);
        let seeds = seeds_owned.as_slices();
        let all = a.vault_ata.amount;
        token_out(&a.token_program, &a.vault_ata, &a.new_ata, &a.vault, &a.mint, &seeds, all)?;
        token_interface::close_account(CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            CloseAccount {
                account: a.vault_ata.to_account_info(),
                destination: a.new_vault.to_account_info(),
                authority: a.vault.to_account_info(),
            },
            &[&seeds],
        ))
    }

    /// Splits all SOL among the heirs; heirs are the remaining accounts, in config order.
    pub fn testament_sol<'info>(ctx: Context<'_, '_, 'info, 'info, TestamentSol<'info>>) -> Result<()> {
        let a = &ctx.accounts;
        testament_open(&a.state)?;
        let heirs = used_heirs(&a.state.config);
        require!(ctx.remaining_accounts.len() == heirs.len(), NoxError::MissingAccount);
        let total = a.vault.lamports();
        let shares = split(total, &heirs);
        let seeds_owned = vault_seeds(&a.state);
        let seeds = seeds_owned.as_slices();
        for ((heir, share), acct) in heirs.iter().zip(shares).zip(ctx.remaining_accounts.iter()) {
            require_keys_eq!(heir.addr, acct.key(), NoxError::WrongDest);
            sol_out(&a.system_program, &a.vault, acct, &seeds, share)?;
        }
        Ok(())
    }

    /// Splits all of one token among the heirs; remaining accounts are the heirs' token
    /// accounts for this mint, in config order (create them first).
    pub fn testament_token<'info>(ctx: Context<'_, '_, 'info, 'info, TestamentToken<'info>>) -> Result<()> {
        let a = &ctx.accounts;
        testament_open(&a.state)?;
        let heirs = used_heirs(&a.state.config);
        require!(ctx.remaining_accounts.len() == heirs.len(), NoxError::MissingAccount);
        let shares = split(a.vault_ata.amount, &heirs);
        let seeds_owned = vault_seeds(&a.state);
        let seeds = seeds_owned.as_slices();
        for ((heir, share), acct) in heirs.iter().zip(shares).zip(ctx.remaining_accounts.iter()) {
            let ta = InterfaceAccount::<TokenAccount>::try_from(acct)?;
            require_keys_eq!(ta.owner, heir.addr, NoxError::WrongDest);
            require_keys_eq!(ta.mint, a.mint.key(), NoxError::WrongDest);
            token_out(&a.token_program, &a.vault_ata, &ta, &a.vault, &a.mint, &seeds, share)?;
        }
        Ok(())
    }

    pub fn testament_stake(ctx: Context<TestamentStake>, seed: u8, collect: bool) -> Result<()> {
        let a = &ctx.accounts;
        testament_open(&a.state)?;
        let seeds_owned = vault_seeds(&a.state);
        stake_authority(&a.vault, &a.stake, &a.clock.to_account_info(), &a.stake_history, &a.stake_program, &seeds_owned.as_slices(), seed, collect)
    }

    // ---------- invoice addresses ----------

    pub fn sweep_inbox(ctx: Context<SweepInbox>, id: u32) -> Result<()> {
        let a = &ctx.accounts;
        let vault = a.vault.key();
        let all = a.inbox.lamports();
        let idb = id.to_le_bytes();
        let seeds: &[&[u8]] = &[INBOX_SEED, vault.as_ref(), &idb, &[ctx.bumps.inbox]];
        sol_out(&a.system_program, &a.inbox, &a.vault, seeds, all)
    }

    pub fn sweep_inbox_token(ctx: Context<SweepInboxToken>, id: u32) -> Result<()> {
        let a = &ctx.accounts;
        let vault = a.vault.key();
        let idb = id.to_le_bytes();
        let seeds: &[&[u8]] = &[INBOX_SEED, vault.as_ref(), &idb, &[ctx.bumps.inbox]];
        token_out(&a.token_program, &a.inbox_ata, &a.vault_ata, &a.inbox, &a.mint, seeds, a.inbox_ata.amount)?;
        token_interface::close_account(CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            CloseAccount {
                account: a.inbox_ata.to_account_info(),
                destination: a.vault.to_account_info(),
                authority: a.inbox.to_account_info(),
            },
            &[seeds],
        ))
    }

    // ---------- protocol parameters ----------

    pub fn init_protocol(ctx: Context<InitProtocol>, params: ProtocolParams) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), PROTOCOL_ADMIN, NoxError::NotAdmin);
        require!(params.guardian <= params.sentinel, NoxError::BadConfig);
        let p = &mut ctx.accounts.protocol;
        p.admin = PROTOCOL_ADMIN;
        p.params = params;
        Ok(())
    }

    pub fn update_protocol(ctx: Context<UpdateProtocol>, params: ProtocolParams) -> Result<()> {
        let p = &mut ctx.accounts.protocol;
        require!(!p.frozen, NoxError::Frozen);
        require!(params.guardian <= params.sentinel, NoxError::BadConfig);
        p.params = params;
        Ok(())
    }

    /// Hands the parameters to another admin (a multisig, later governance).
    pub fn set_protocol_admin(ctx: Context<UpdateProtocol>, admin: Pubkey) -> Result<()> {
        require!(!ctx.accounts.protocol.frozen, NoxError::Frozen);
        ctx.accounts.protocol.admin = admin;
        Ok(())
    }

    /// Makes the parameters permanent.
    pub fn freeze_protocol(ctx: Context<UpdateProtocol>) -> Result<()> {
        ctx.accounts.protocol.frozen = true;
        Ok(())
    }

    // ---------- Escape Hatch, registry and canary ----------

    pub fn register_link(ctx: Context<RegisterLink>) -> Result<()> {
        let l = &mut ctx.accounts.link;
        l.wallet = ctx.accounts.wallet.key();
        l.vault = ctx.accounts.vault.key();
        l.created_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn request_link_change(ctx: Context<RequestLinkChange>) -> Result<()> {
        require!(!ctx.accounts.canary.tripped, NoxError::CanaryTripped);
        let at = Clock::get()?.unix_timestamp.saturating_add(LINK_CHANGE_DELAY);
        ctx.accounts.link.change = Some(LinkChange { vault: ctx.accounts.new_vault.key(), at });
        Ok(())
    }

    pub fn apply_link_change(ctx: Context<ApplyLinkChange>) -> Result<()> {
        require!(!ctx.accounts.canary.tripped, NoxError::CanaryTripped);
        let l = &mut ctx.accounts.link;
        let c = l.change.clone().ok_or(NoxError::NoPending)?;
        require!(Clock::get()?.unix_timestamp >= c.at, NoxError::NotYet);
        l.vault = c.vault;
        l.change = None;
        Ok(())
    }

    pub fn set_escape_tx(ctx: Context<WalletLink>, tx: Vec<u8>) -> Result<()> {
        require!(tx.len() <= MAX_ESCAPE_TX, NoxError::BadAction);
        ctx.accounts.link.escape_tx = tx;
        Ok(())
    }

    pub fn set_panic(ctx: Context<WalletLink>, on: bool) -> Result<()> {
        ctx.accounts.link.panic = on;
        Ok(())
    }

    /// Moves a delegated token account of a linked wallet into its vault. Permissionless once
    /// the canary has tripped or the wallet pressed panic.
    pub fn escape_token(ctx: Context<EscapeToken>) -> Result<()> {
        let a = &ctx.accounts;
        require!(a.canary.tripped || a.link.panic, NoxError::NotTriggered);
        require_keys_eq!(a.source.owner, a.link.wallet, NoxError::WrongDest);
        let escape = a.escape.key();
        require!(a.source.delegate == Some(escape).into(), NoxError::NotDelegated);
        let amount = a.source.amount.min(a.source.delegated_amount);
        let wallet = a.link.wallet;
        let seeds: &[&[u8]] = &[ESCAPE_SEED, wallet.as_ref(), &[ctx.bumps.escape]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                a.token_program.to_account_info(),
                TransferChecked {
                    from: a.source.to_account_info(),
                    mint: a.mint.to_account_info(),
                    to: a.vault_ata.to_account_info(),
                    authority: a.escape.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            a.mint.decimals,
        )
    }

    /// Moves all of a wallet's SOL into its linked vault. Signed by the wallet, usually in a
    /// pre-signed durable-nonce transaction stored in the link (docs/SPEC.md §7).
    pub fn escape_sol(ctx: Context<EscapeSol>) -> Result<()> {
        let a = &ctx.accounts;
        let all = a.wallet.lamports();
        if all == 0 {
            return Ok(());
        }
        system_program::transfer(
            CpiContext::new(a.system_program.to_account_info(), system_program::Transfer {
                from: a.wallet.to_account_info(),
                to: a.vault.to_account_info(),
            }),
            all,
        )
    }

    pub fn init_canary(ctx: Context<InitCanary>) -> Result<()> {
        let c = &mut ctx.accounts.canary;
        c.watched = CANARY_ADDRESS;
        c.baseline = ctx.accounts.watched.lamports();
        Ok(())
    }

    /// Records a higher bounty as the new baseline (anyone may top the canary up).
    pub fn raise_baseline(ctx: Context<CanaryWatch>) -> Result<()> {
        let c = &mut ctx.accounts.canary;
        let now = ctx.accounts.watched.lamports();
        if !c.tripped && now > c.baseline {
            c.baseline = now;
        }
        Ok(())
    }

    /// Trips the canary if its bounty moved: only possible if ed25519 is broken.
    pub fn trip_canary(ctx: Context<CanaryWatch>) -> Result<()> {
        let c = &mut ctx.accounts.canary;
        require!(!c.tripped, NoxError::CanaryTripped);
        require!(ctx.accounts.watched.lamports() < c.baseline, NoxError::NotTriggered);
        c.tripped = true;
        c.tripped_at = Clock::get()?.unix_timestamp;
        msg!("quantum canary tripped");
        Ok(())
    }
}

// ---------- rules ----------

/// A vault's $NOX tier from the $NOX token account it owns (docs/SPEC.md §10).
/// Tiers are off (everything open) while no $NOX mint is set.
fn tier_of(p: &ProtocolParams, vault: &Pubkey, nox: &Option<Box<InterfaceAccount<TokenAccount>>>) -> Result<u8> {
    if p.nox_mint == Pubkey::default() {
        return Ok(TIER_SENTINEL);
    }
    let held = match nox {
        Some(a) => {
            require_keys_eq!(a.owner, *vault, NoxError::WrongDest);
            require_keys_eq!(a.mint, p.nox_mint, NoxError::WrongAction);
            a.amount
        }
        None => 0,
    };
    Ok(if held >= p.sentinel {
        TIER_SENTINEL
    } else if held >= p.guardian {
        TIER_GUARDIAN
    } else {
        TIER_FREE
    })
}

/// Checks an approval against the vault's rules (docs/SPEC.md §4, §11): `state::approval_mode`
/// with the vault's clock state. The duress bit never counts toward the threshold and never adds
/// to recovery powers; a coercer or thief holding only a signer phrase moves nothing during a
/// lockdown, not even through the fee (v4.1, G-01).
fn authorize(ap: &Approval, st: &VaultState) -> Result<(Action, Mode)> {
    let action = ap.action()?;
    let now = Clock::get()?.unix_timestamp;
    let recovery_open = st.inactive_for(st.config.recovery_delay, now);
    let mode = approval_mode(ap.trees, st.config.threshold, st.locked(now), recovery_open, &action).map_err(|e| error!(e))?;
    Ok((action, mode))
}

/// `authorize` for every instruction except execute_withdraw: duress approvals are refused.
/// Returns whether destinations are unrestricted.
fn authorize_full(ap: &Approval, st: &VaultState) -> Result<(Action, bool)> {
    let (action, mode) = authorize(ap, st)?;
    require!(mode != Mode::Duress, NoxError::DuressSolOnly);
    Ok((action, mode == Mode::Unrestricted))
}

fn not_locked(st: &VaultState) -> Result<()> {
    require!(!st.locked(Clock::get()?.unix_timestamp), NoxError::Lockdown);
    Ok(())
}

/// Applies the restriction rules of docs/SPEC.md §3. Returns true to pay now, false if queued.
fn gate(st: &mut VaultState, kind: u8, mint: Pubkey, dest: Pubkey, amount: u64, unrestricted: bool) -> Result<bool> {
    if unrestricted || !st.config.restricted(&dest) {
        return Ok(true);
    }
    let now = Clock::get()?.unix_timestamp;
    if mint == Pubkey::default() && st.config.instant_limit > 0 {
        if now >= st.window_start.saturating_add(DAY) {
            st.window_start = now;
            st.window_spent = 0;
        }
        if st.window_spent.saturating_add(amount) <= st.config.instant_limit {
            st.window_spent = st.window_spent.saturating_add(amount);
            return Ok(true);
        }
    }
    require!(st.config.slow_delay > 0, NoxError::NotWhitelisted);
    require!(st.pending.is_none(), NoxError::PendingExists);
    let executable_at = now.saturating_add(st.config.slow_delay);
    st.pending = Some(Pending { kind, mint, dest, amount, executable_at });
    msg!("queued until {}", executable_at);
    Ok(false)
}

fn take_due_pending(st: &mut VaultState) -> Result<Pending> {
    let p = st.pending.clone().ok_or(NoxError::NoPending)?;
    require!(Clock::get()?.unix_timestamp >= p.executable_at, NoxError::NotYet);
    st.pending = None;
    Ok(p)
}

fn schedule_due(s: &mut Schedule) -> Result<u64> {
    require!(s.remaining > 0, NoxError::NoPending);
    require!(Clock::get()?.unix_timestamp >= s.next_at, NoxError::NotYet);
    s.remaining -= 1;
    s.next_at = s.next_at.saturating_add(s.interval);
    Ok(s.amount)
}

fn budget_spend(b: &mut Budget, st: &VaultState, dest: &Pubkey, mint: Pubkey, amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now < b.expires, NoxError::BudgetExpired);
    require_keys_eq!(b.mint, mint, NoxError::WrongAction);
    // v4.1 (G-03): only non-restricted destinations (§3), instant limit included.
    require!(!st.config.restricted(dest), NoxError::BudgetDestRestricted);
    require_keys_neq!(*dest, st.vault, NoxError::DestIsVault);
    if now >= b.window_start.saturating_add(b.period) {
        b.window_start = now;
        b.spent = 0;
    }
    require!(b.spent.saturating_add(amount) <= b.limit, NoxError::OverBudget);
    b.spent = b.spent.saturating_add(amount);
    Ok(())
}

fn testament_open(st: &VaultState) -> Result<()> {
    require!(st.config.testament_active(), NoxError::NoTestament);
    let now = Clock::get()?.unix_timestamp;
    require!(st.inactive_for(st.config.testament_delay, now), NoxError::NotYet);
    Ok(())
}

fn used_heirs(c: &Config) -> Vec<Heir> {
    c.heirs.iter().filter(|h| h.addr != Pubkey::default()).copied().collect()
}

/// Shares by basis points; the last heir also gets the rounding remainder.
fn split(total: u64, heirs: &[Heir]) -> Vec<u64> {
    let mut out: Vec<u64> = heirs.iter().map(|h| ((total as u128 * h.bps as u128) / 10_000) as u64).collect();
    let given: u64 = out.iter().sum();
    if let Some(last) = out.last_mut() {
        *last += total - given;
    }
    out
}

fn check_rent(vault: &AccountInfo) -> Result<()> {
    let left = vault.lamports();
    require!(left == 0 || left >= Rent::get()?.minimum_balance(0), NoxError::RentDust);
    Ok(())
}

struct VaultSeeds {
    hash: [u8; N],
    bump: [u8; 1],
}

impl VaultSeeds {
    fn as_slices(&self) -> [&[u8]; 3] {
        [VAULT_SEED, &self.hash, &self.bump]
    }
}

fn vault_seeds(st: &VaultState) -> VaultSeeds {
    VaultSeeds { hash: st.config_hash, bump: [st.vault_bump] }
}

// ---------- transfers ----------

fn pay_fee<'info>(
    system_program: &Program<'info, System>,
    vault: &AccountInfo<'info>,
    fee_payee: &AccountInfo<'info>,
    seeds: &[&[u8]],
    action: &Action,
) -> Result<()> {
    if action.fee == 0 {
        return Ok(());
    }
    require!(action.fee <= MAX_ACTION_FEE, NoxError::FeeTooHigh);
    require_keys_eq!(action.fee_payee, fee_payee.key(), NoxError::WrongFeePayee);
    require!(action.fee <= vault.lamports(), NoxError::InsufficientFunds);
    sol_out(system_program, vault, fee_payee, seeds, action.fee)
}

fn sol_out<'info>(
    system_program: &Program<'info, System>,
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    seeds: &[&[u8]],
    lamports: u64,
) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    system_program::transfer(
        CpiContext::new_with_signer(
            system_program.to_account_info(),
            system_program::Transfer { from: from.clone(), to: to.clone() },
            &[seeds],
        ),
        lamports,
    )
}

fn token_out<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: &AccountInfo<'info>,
    mint: &InterfaceAccount<'info, Mint>,
    seeds: &[&[u8]],
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: authority.clone(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )
}

#[allow(clippy::too_many_arguments)]
fn stake_authority<'info>(
    vault: &AccountInfo<'info>,
    stake_acct: &AccountInfo<'info>,
    clock: &AccountInfo<'info>,
    stake_history: &AccountInfo<'info>,
    stake_program: &AccountInfo<'info>,
    seeds: &[&[u8]],
    seed: u8,
    collect: bool,
) -> Result<()> {
    let vkey = vault.key();
    let (want, _) = Pubkey::find_program_address(&[STAKE_SEED, vkey.as_ref(), &[seed]], &crate::ID);
    require_keys_eq!(want, stake_acct.key(), NoxError::WrongStake);
    if collect {
        invoke_signed(
            &stake::instruction::withdraw(&want, &vkey, &vkey, stake_acct.lamports(), None),
            &[stake_acct.clone(), vault.clone(), clock.clone(), stake_history.clone(), vault.clone(), stake_program.clone()],
            &[seeds],
        )?;
    } else {
        invoke_signed(
            &stake::instruction::deactivate_stake(&want, &vkey),
            &[stake_acct.clone(), clock.clone(), vault.clone(), stake_program.clone()],
            &[seeds],
        )?;
    }
    Ok(())
}

// ---------- accounts: vaults and signatures ----------

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: checked against the config hash in the handler.
    pub vault: UncheckedAccount<'info>,
    #[account(init, payer = payer, space = 8 + VaultState::INIT_SPACE, seeds = [STATE_SEED, vault.key().as_ref()], bump)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(seeds = [PROTOCOL_SEED], bump)]
    pub protocol: Box<Account<'info, Protocol>>,
    /// The vault's $NOX account, if any: sets its tier.
    pub nox_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    /// CHECK: must equal protocol.params.treasury when a fee is due.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenUnlock<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: equals state.vault (has_one).
    pub vault: UncheckedAccount<'info>,
    #[account(seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(init, payer = payer, space = Unlock::SPACE, seeds = [UNLOCK_SEED, vault.key().as_ref(), payer.key().as_ref()], bump)]
    pub unlock: AccountLoader<'info, Unlock>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WriteSigs<'info> {
    pub payer: Signer<'info>,
    /// CHECK: equals unlock.vault (has_one). Listed so every transaction that publishes
    /// signature bytes shows up in the vault's history (docs/SPEC.md §9).
    pub vault: UncheckedAccount<'info>,
    #[account(mut, has_one = payer, has_one = vault)]
    pub unlock: AccountLoader<'info, Unlock>,
}

#[derive(Accounts)]
pub struct Verify<'info> {
    #[account(mut)]
    pub unlock: AccountLoader<'info, Unlock>,
}

#[derive(Accounts)]
#[instruction(action_hash: [u8; 32])]
pub struct Approve<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, close = rent_receiver)]
    pub unlock: AccountLoader<'info, Unlock>,
    /// CHECK: must equal the buffer's payer; gets the buffer rent back.
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
    #[account(mut, seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    /// CHECK: equals state.vault (has_one).
    pub vault: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Approval::INIT_SPACE,
        seeds = [APPROVAL_SEED, vault.key().as_ref(), &action_hash],
        bump
    )]
    pub approval: Box<Account<'info, Approval>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DiscardApproval<'info> {
    #[account(mut, close = creator, has_one = creator)]
    pub approval: Box<Account<'info, Approval>>,
    /// CHECK: equals approval.creator; gets the rent back.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CancelUnlock<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, has_one = payer, close = payer)]
    pub unlock: AccountLoader<'info, Unlock>,
}

// ---------- accounts: execution ----------

#[derive(Accounts)]
pub struct ExecuteWithdraw<'info> {
    #[account(mut, close = creator, has_one = vault, has_one = creator)]
    pub approval: Box<Account<'info, Approval>>,
    /// CHECK: equals approval.creator; gets the approval rent back.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
    #[account(mut, seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    /// CHECK: must equal the signed destination.
    #[account(mut)]
    pub dest: UncheckedAccount<'info>,
    /// CHECK: must equal the signed fee payee when there is a fee.
    #[account(mut)]
    pub fee_payee: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteWithdrawToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, close = creator, has_one = vault, has_one = creator)]
    pub approval: Box<Account<'info, Approval>>,
    /// CHECK: equals approval.creator.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
    #[account(mut, seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = vault, associated_token::token_program = token_program)]
    pub vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: must equal the signed destination owner.
    pub dest: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = payer, associated_token::mint = mint, associated_token::authority = dest, associated_token::token_program = token_program)]
    pub dest_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: must equal the signed fee payee when there is a fee.
    #[account(mut)]
    pub fee_payee: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteStake<'info> {
    #[account(mut, close = creator, has_one = vault, has_one = creator)]
    pub approval: Box<Account<'info, Approval>>,
    /// CHECK: equals approval.creator.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
    #[account(mut, seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    /// CHECK: PDA ["stake", vault, seed], checked in the handler; created here.
    #[account(mut)]
    pub stake: UncheckedAccount<'info>,
    /// CHECK: must equal the signed vote account; the stake program checks it is one.
    pub vote: UncheckedAccount<'info>,
    /// CHECK: must equal the signed fee payee when there is a fee.
    #[account(mut)]
    pub fee_payee: UncheckedAccount<'info>,
    pub clock: Sysvar<'info, Clock>,
    pub rent: Sysvar<'info, Rent>,
    /// CHECK: the stake history sysvar.
    #[account(address = sysvar::stake_history::ID)]
    pub stake_history: UncheckedAccount<'info>,
    /// CHECK: the (unused but required) stake config account.
    #[account(address = stake::config::ID)]
    pub stake_config: UncheckedAccount<'info>,
    /// CHECK: the stake program.
    #[account(address = stake::program::ID)]
    pub stake_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteStakeAuthority<'info> {
    #[account(mut, close = creator, has_one = vault, has_one = creator)]
    pub approval: Box<Account<'info, Approval>>,
    /// CHECK: equals approval.creator.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
    #[account(mut, seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    /// CHECK: PDA ["stake", vault, seed], checked in the handler.
    #[account(mut)]
    pub stake: UncheckedAccount<'info>,
    /// CHECK: must equal the signed fee payee when there is a fee.
    #[account(mut)]
    pub fee_payee: UncheckedAccount<'info>,
    pub clock: Sysvar<'info, Clock>,
    /// CHECK: the stake history sysvar.
    #[account(address = sysvar::stake_history::ID)]
    pub stake_history: UncheckedAccount<'info>,
    /// CHECK: the stake program.
    #[account(address = stake::program::ID)]
    pub stake_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteAdmin<'info> {
    #[account(mut, close = creator, has_one = vault, has_one = creator)]
    pub approval: Box<Account<'info, Approval>>,
    /// CHECK: equals approval.creator.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
    #[account(mut, seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    /// CHECK: must equal the signed fee payee when there is a fee.
    #[account(mut)]
    pub fee_payee: UncheckedAccount<'info>,
    #[account(mut)]
    pub schedule: Option<Box<Account<'info, Schedule>>>,
    #[account(mut)]
    pub budget: Option<Box<Account<'info, Budget>>>,
    pub new_state: Option<Box<Account<'info, VaultState>>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: u8)]
pub struct ExecuteCreateSchedule<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, close = creator, has_one = vault, has_one = creator)]
    pub approval: Box<Account<'info, Approval>>,
    /// CHECK: equals approval.creator.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
    #[account(mut, seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    #[account(init, payer = payer, space = 8 + Schedule::INIT_SPACE, seeds = [SCHEDULE_SEED, vault.key().as_ref(), &[id]], bump)]
    pub schedule: Box<Account<'info, Schedule>>,
    /// CHECK: must equal the signed fee payee when there is a fee.
    #[account(mut)]
    pub fee_payee: UncheckedAccount<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump)]
    pub protocol: Box<Account<'info, Protocol>>,
    /// The vault's $NOX account, if any: sets its tier.
    pub nox_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: u8)]
pub struct ExecuteCreateBudget<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, close = creator, has_one = vault, has_one = creator)]
    pub approval: Box<Account<'info, Approval>>,
    /// CHECK: equals approval.creator.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
    #[account(mut, seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    #[account(init, payer = payer, space = 8 + Budget::INIT_SPACE, seeds = [BUDGET_SEED, vault.key().as_ref(), &[id]], bump)]
    pub budget: Box<Account<'info, Budget>>,
    /// CHECK: must equal the signed fee payee when there is a fee.
    #[account(mut)]
    pub fee_payee: UncheckedAccount<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump)]
    pub protocol: Box<Account<'info, Protocol>>,
    /// The vault's $NOX account, if any: sets its tier.
    pub nox_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteLetterKey<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, close = creator, has_one = vault, has_one = creator)]
    pub approval: Box<Account<'info, Approval>>,
    /// CHECK: equals approval.creator.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
    #[account(mut, seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    #[account(init_if_needed, payer = payer, space = 8 + LetterKey::INIT_SPACE, seeds = [LETTER_KEY_SEED, vault.key().as_ref()], bump)]
    pub letter_key: Box<Account<'info, LetterKey>>,
    /// CHECK: must equal the signed fee payee when there is a fee.
    #[account(mut)]
    pub fee_payee: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

// ---------- accounts: sealed letters ----------

#[derive(Accounts)]
#[instruction(id: u32)]
pub struct WriteLetter<'info> {
    /// The vault's letter key: signs and pays.
    #[account(mut)]
    pub key: Signer<'info>,
    /// CHECK: bound to letter_key by its seeds and has_one.
    pub vault: UncheckedAccount<'info>,
    #[account(
        seeds = [LETTER_KEY_SEED, vault.key().as_ref()],
        bump,
        has_one = vault,
        constraint = letter_key.key == key.key() && letter_key.key != Pubkey::default() @ NoxError::NotLetterKey
    )]
    pub letter_key: Box<Account<'info, LetterKey>>,
    /// CHECK: PDA ["letter", vault, id]; created, resized and written in the handler.
    #[account(mut, seeds = [LETTER_SEED, vault.key().as_ref(), &id.to_le_bytes()], bump)]
    pub letter: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: u32)]
pub struct AppendLetter<'info> {
    pub key: Signer<'info>,
    /// CHECK: bound to letter_key by its seeds and has_one.
    pub vault: UncheckedAccount<'info>,
    #[account(
        seeds = [LETTER_KEY_SEED, vault.key().as_ref()],
        bump,
        has_one = vault,
        constraint = letter_key.key == key.key() && letter_key.key != Pubkey::default() @ NoxError::NotLetterKey
    )]
    pub letter_key: Box<Account<'info, LetterKey>>,
    #[account(mut, seeds = [LETTER_SEED, vault.key().as_ref(), &id.to_le_bytes()], bump, has_one = vault)]
    pub letter: Box<Account<'info, Letter>>,
}

#[derive(Accounts)]
#[instruction(id: u32)]
pub struct CloseLetter<'info> {
    #[account(mut)]
    pub key: Signer<'info>,
    /// CHECK: bound to letter_key by its seeds and has_one.
    pub vault: UncheckedAccount<'info>,
    #[account(
        seeds = [LETTER_KEY_SEED, vault.key().as_ref()],
        bump,
        has_one = vault,
        constraint = letter_key.key == key.key() && letter_key.key != Pubkey::default() @ NoxError::NotLetterKey
    )]
    pub letter_key: Box<Account<'info, LetterKey>>,
    #[account(mut, close = key, seeds = [LETTER_SEED, vault.key().as_ref(), &id.to_le_bytes()], bump, has_one = vault)]
    pub letter: Box<Account<'info, Letter>>,
}

// ---------- accounts: permissionless follow-ups ----------

#[derive(Accounts)]
pub struct ExecutePending<'info> {
    #[account(mut, seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    /// CHECK: must equal the pending destination (any account for a pending migration).
    #[account(mut)]
    pub dest: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecutePendingToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    pub vault: SystemAccount<'info>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = vault, associated_token::token_program = token_program)]
    pub vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: must equal the pending destination owner.
    pub dest: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = payer, associated_token::mint = mint, associated_token::authority = dest, associated_token::token_program = token_program)]
    pub dest_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RunSchedule<'info> {
    #[account(mut, has_one = vault)]
    pub schedule: Box<Account<'info, Schedule>>,
    #[account(seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    /// CHECK: equals schedule.dest.
    #[account(mut)]
    pub dest: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RunScheduleToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, has_one = vault)]
    pub schedule: Box<Account<'info, Schedule>>,
    #[account(seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = vault, associated_token::token_program = token_program)]
    pub vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: equals schedule.dest.
    pub dest: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = payer, associated_token::mint = mint, associated_token::authority = dest, associated_token::token_program = token_program)]
    pub dest_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SpendBudget<'info> {
    pub session: Signer<'info>,
    #[account(mut, has_one = vault, has_one = session)]
    pub budget: Box<Account<'info, Budget>>,
    #[account(seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    /// CHECK: checked against the whitelist in the handler.
    #[account(mut)]
    pub dest: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SpendBudgetToken<'info> {
    #[account(mut)]
    pub session: Signer<'info>,
    #[account(mut, has_one = vault, has_one = session)]
    pub budget: Box<Account<'info, Budget>>,
    #[account(seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    pub vault: SystemAccount<'info>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = vault, associated_token::token_program = token_program)]
    pub vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: checked against the whitelist in the handler.
    pub dest: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = session, associated_token::mint = mint, associated_token::authority = dest, associated_token::token_program = token_program)]
    pub dest_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MigrateSol<'info> {
    #[account(seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    /// CHECK: equals state.migrate_to.
    #[account(mut)]
    pub new_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MigrateToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    pub vault: SystemAccount<'info>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = vault, associated_token::token_program = token_program)]
    pub vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: equals state.migrate_to; receives the closed ATA's rent.
    #[account(mut)]
    pub new_vault: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = payer, associated_token::mint = mint, associated_token::authority = new_vault, associated_token::token_program = token_program)]
    pub new_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TestamentSol<'info> {
    #[account(seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TestamentToken<'info> {
    #[account(seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    pub vault: SystemAccount<'info>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = vault, associated_token::token_program = token_program)]
    pub vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct TestamentStake<'info> {
    #[account(seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    /// CHECK: PDA ["stake", vault, seed], checked in the handler.
    #[account(mut)]
    pub stake: UncheckedAccount<'info>,
    pub clock: Sysvar<'info, Clock>,
    /// CHECK: the stake history sysvar.
    #[account(address = sysvar::stake_history::ID)]
    pub stake_history: UncheckedAccount<'info>,
    /// CHECK: the stake program.
    #[account(address = stake::program::ID)]
    pub stake_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(id: u32)]
pub struct SweepInbox<'info> {
    #[account(seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    #[account(mut, seeds = [INBOX_SEED, vault.key().as_ref(), &id.to_le_bytes()], bump)]
    pub inbox: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: u32)]
pub struct SweepInboxToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    /// CHECK: PDA ["inbox", vault, id]; signs for its token accounts.
    #[account(seeds = [INBOX_SEED, vault.key().as_ref(), &id.to_le_bytes()], bump)]
    pub inbox: UncheckedAccount<'info>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = inbox, associated_token::token_program = token_program)]
    pub inbox_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init_if_needed, payer = payer, associated_token::mint = mint, associated_token::authority = vault, associated_token::token_program = token_program)]
    pub vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ---------- accounts: Escape Hatch ----------

#[derive(Accounts)]
pub struct RegisterLink<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,
    #[account(seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    /// CHECK: equals state.vault: links only point at real vaults.
    pub vault: UncheckedAccount<'info>,
    #[account(init, payer = wallet, space = 8 + Link::INIT_SPACE, seeds = [LINK_SEED, wallet.key().as_ref()], bump)]
    pub link: Box<Account<'info, Link>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestLinkChange<'info> {
    pub wallet: Signer<'info>,
    #[account(mut, seeds = [LINK_SEED, wallet.key().as_ref()], bump, has_one = wallet)]
    pub link: Box<Account<'info, Link>>,
    #[account(seeds = [STATE_SEED, new_vault.key().as_ref()], bump, constraint = new_state.vault == new_vault.key())]
    pub new_state: Box<Account<'info, VaultState>>,
    /// CHECK: equals new_state.vault.
    pub new_vault: UncheckedAccount<'info>,
    #[account(seeds = [CANARY_SEED], bump)]
    pub canary: Box<Account<'info, Canary>>,
}

#[derive(Accounts)]
pub struct ApplyLinkChange<'info> {
    #[account(mut)]
    pub link: Box<Account<'info, Link>>,
    #[account(seeds = [CANARY_SEED], bump)]
    pub canary: Box<Account<'info, Canary>>,
}

#[derive(Accounts)]
pub struct WalletLink<'info> {
    pub wallet: Signer<'info>,
    #[account(mut, seeds = [LINK_SEED, wallet.key().as_ref()], bump, has_one = wallet)]
    pub link: Box<Account<'info, Link>>,
}

#[derive(Accounts)]
pub struct EscapeToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [LINK_SEED, link.wallet.as_ref()], bump, has_one = vault)]
    pub link: Box<Account<'info, Link>>,
    #[account(seeds = [CANARY_SEED], bump)]
    pub canary: Box<Account<'info, Canary>>,
    /// CHECK: PDA ["escape", wallet]: the delegate the wallet approved.
    #[account(seeds = [ESCAPE_SEED, link.wallet.as_ref()], bump)]
    pub escape: UncheckedAccount<'info>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub source: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: equals link.vault (has_one).
    pub vault: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = payer, associated_token::mint = mint, associated_token::authority = vault, associated_token::token_program = token_program)]
    pub vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EscapeSol<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,
    #[account(seeds = [LINK_SEED, wallet.key().as_ref()], bump, has_one = wallet, has_one = vault)]
    pub link: Box<Account<'info, Link>>,
    /// CHECK: equals link.vault (has_one).
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitProtocol<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Protocol::INIT_SPACE, seeds = [PROTOCOL_SEED], bump)]
    pub protocol: Box<Account<'info, Protocol>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateProtocol<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [PROTOCOL_SEED], bump, has_one = admin)]
    pub protocol: Box<Account<'info, Protocol>>,
}

#[derive(Accounts)]
pub struct InitCanary<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + Canary::INIT_SPACE, seeds = [CANARY_SEED], bump)]
    pub canary: Box<Account<'info, Canary>>,
    /// CHECK: the fixed canary address.
    #[account(address = CANARY_ADDRESS)]
    pub watched: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CanaryWatch<'info> {
    #[account(mut, seeds = [CANARY_SEED], bump)]
    pub canary: Box<Account<'info, Canary>>,
    /// CHECK: the fixed canary address.
    #[account(address = CANARY_ADDRESS)]
    pub watched: UncheckedAccount<'info>,
}

#[error_code]
pub enum NoxError {
    #[msg("The vault address does not match")]
    WrongVault,
    #[msg("Invalid vault config")]
    BadConfig,
    #[msg("Unknown tree, wrong auth path length or leaf out of range")]
    BadTree,
    #[msg("This one-time key has already been used")]
    KeyUsed,
    #[msg("The destination cannot be the vault itself")]
    DestIsVault,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Invalid action")]
    BadAction,
    #[msg("The signature can no longer change: verification has started")]
    Frozen,
    #[msg("Chain index out of range")]
    ChainOutOfRange,
    #[msg("Not every chain of the signature has been written")]
    SignatureIncomplete,
    #[msg("Not every chain has been verified")]
    NotVerified,
    #[msg("The signature does not match this vault's keys")]
    BadSignature,
    #[msg("Rent receiver must be the account that opened the unlock")]
    WrongPayer,
    #[msg("This instruction cannot execute this action")]
    WrongAction,
    #[msg("Destination does not match")]
    WrongDest,
    #[msg("Fee payee does not match the signed action")]
    WrongFeePayee,
    #[msg("Stake account does not match")]
    WrongStake,
    #[msg("The vault holds less than this needs")]
    InsufficientFunds,
    #[msg("The vault would be left with less SOL than the rent minimum")]
    RentDust,
    #[msg("Not enough approvals")]
    NotApproved,
    #[msg("The recovery key may only cancel until the owner has been inactive long enough")]
    RecoveryLocked,
    #[msg("This destination is not allowed by the vault's rules")]
    NotWhitelisted,
    #[msg("Something is already pending")]
    PendingExists,
    #[msg("Nothing is pending")]
    NoPending,
    #[msg("Not yet")]
    NotYet,
    #[msg("A required account is missing")]
    MissingAccount,
    #[msg("This budget has expired")]
    BudgetExpired,
    #[msg("This would exceed the budget for this period")]
    OverBudget,
    #[msg("This vault has no testament")]
    NoTestament,
    #[msg("The quantum canary has tripped")]
    CanaryTripped,
    #[msg("The Escape Hatch has not been triggered")]
    NotTriggered,
    #[msg("This token account has not delegated to the Escape Hatch")]
    NotDelegated,
    #[msg("This needs a higher $NOX tier: hold more $NOX in the vault")]
    TierTooLow,
    #[msg("Only the protocol admin can do this")]
    NotAdmin,
    #[msg("The vault is in lockdown: only Ping and cancels execute until it ends")]
    Lockdown,
    #[msg("A duress approval can only withdraw SOL")]
    DuressSolOnly,
    #[msg("Only the vault's signers can set the letter key (not duress or recovery)")]
    LetterKeySignersOnly,
    #[msg("This key is not the vault's letter key")]
    NotLetterKey,
    #[msg("Letter too big: at most 8192 ciphertext bytes and a 64-byte label")]
    LetterTooBig,
    #[msg("Letter chunk out of order or past the letter's length")]
    LetterOverflow,
    // ---- v4.1 (append only) ----
    #[msg("The fee is above the protocol maximum of 0.01 SOL per action")]
    FeeTooHigh,
    #[msg("During a lockdown the vault's signers can only Ping or cancel with fee 0")]
    FeeInLockdown,
    #[msg("Two tree slots share a root: signer, recovery and duress trees must all differ")]
    DuplicateRoot,
    #[msg("Session budgets only pay non-restricted destinations (whitelisted, or no instant limit)")]
    BudgetDestRestricted,
    #[msg("A delay, lock, interval or period is longer than 10 years")]
    DurationTooLong,
    // ---- v4.2 (append only) ----
    #[msg("Only an approval that includes the recovery tree can cancel and freeze the vault")]
    CancelLockNeedsRecovery,
    #[msg("A freeze lasts at least 1 day and at most 90 days")]
    LockOutOfRange,
}
