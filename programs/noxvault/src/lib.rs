//! Noxvault v2: vaults whose funds move only with hash-based one-time signatures, arranged in
//! a Merkle tree so one vault address serves many actions. See docs/SPEC.md.
#![allow(deprecated)] // solana_program::stake re-exports; the replacement crate is not on Rust 1.79
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::stake;
use anchor_lang::solana_program::sysvar;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

pub mod state;
pub mod wots;

use state::*;
use wots::{ALL_CHAINS, LEN, N};

declare_id!("8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4");

/// Size of a stake account (StakeStateV2).
const STAKE_SPACE: u64 = 200;

#[program]
pub mod noxvault {
    use super::*;

    /// Creates the state of a vault from its config. Permissionless: the vault address is the
    /// hash of the config, so nobody can register different rules for it.
    pub fn init_vault(ctx: Context<InitVault>, config: Config) -> Result<()> {
        require!((1..=wots::MAX_HEIGHT as u8).contains(&config.primary_height), NoxError::BadConfig);
        if config.has_recovery() {
            require!((1..=wots::MAX_HEIGHT as u8).contains(&config.recovery_height), NoxError::BadConfig);
            require!(config.recovery_delay > 0, NoxError::BadConfig);
        } else {
            require!(config.recovery_height == 0, NoxError::BadConfig);
        }
        require!(config.slow_delay >= 0, NoxError::BadConfig);

        let hash = wots::config_hash(&config.try_to_vec()?);
        let (vault, bump) = Pubkey::find_program_address(&[VAULT_SEED, &hash], &crate::ID);
        require_keys_eq!(vault, ctx.accounts.vault.key(), NoxError::WrongVault);

        let now = Clock::get()?.unix_timestamp;
        let s = &mut ctx.accounts.state;
        s.vault = vault;
        s.vault_bump = bump;
        s.config_hash = hash;
        s.config = config;
        s.last_active = now;
        s.created_at = now;
        Ok(())
    }

    pub fn open_unlock(
        ctx: Context<OpenUnlock>,
        tree: u8,
        leaf: u16,
        pk_seed: [u8; N],
        auth_path: Vec<[u8; N]>,
        action: Action,
    ) -> Result<()> {
        let st = &ctx.accounts.state;
        require!(tree == TREE_PRIMARY || tree == TREE_RECOVERY, NoxError::BadTree);
        let (_, height) = st.tree(tree);
        require!(height > 0 && auth_path.len() == height as usize, NoxError::BadTree);
        require!((leaf as u32) < (1u32 << height), NoxError::BadTree);
        require!(!st.used(tree, leaf), NoxError::KeyUsed);
        let vault = ctx.accounts.vault.key();
        match &action {
            Action::Withdraw { dest, amount, .. } => {
                require_keys_neq!(*dest, vault, NoxError::DestIsVault);
                require!(*amount > 0, NoxError::ZeroAmount);
            }
            Action::Stake { amount, .. } => require!(*amount > 0, NoxError::ZeroAmount),
            _ => {}
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
        u.height = height;
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

    /// Withdraws SOL (or queues it as the pending withdrawal). Permissionless once verified.
    pub fn finish_withdraw(ctx: Context<FinishWithdraw>) -> Result<()> {
        let a = &mut *ctx.accounts;
        let (action, tree, leaf) = consume(&a.unlock, &a.rent_receiver, &mut a.state)?;
        let Action::Withdraw { mint, dest, amount, .. } = action.clone() else {
            return err!(NoxError::WrongAction);
        };
        require_keys_eq!(mint, Pubkey::default(), NoxError::WrongAction);
        require_keys_eq!(dest, a.dest.key(), NoxError::WrongDest);

        let seeds_owned = vault_seeds(&a.state);
        let seeds = seeds_owned.as_slices();
        if !queue_if_slow(&mut a.state, tree, leaf, mint, dest, amount)? {
            require!(amount <= a.vault.lamports(), NoxError::InsufficientFunds);
            sol_out(&a.system_program, &a.vault, &a.dest, &seeds, amount)?;
        }
        pay_fee(&a.system_program, &a.vault, &a.fee_payee, &seeds, &action)?;
        check_rent(&a.vault)
    }

    /// Withdraws an SPL / Token-2022 token (or queues it). Permissionless once verified.
    pub fn finish_withdraw_token(ctx: Context<FinishWithdrawToken>) -> Result<()> {
        let a = &mut *ctx.accounts;
        let (action, tree, leaf) = consume(&a.unlock, &a.rent_receiver, &mut a.state)?;
        let Action::Withdraw { mint, dest, amount, .. } = action.clone() else {
            return err!(NoxError::WrongAction);
        };
        require_keys_eq!(mint, a.mint.key(), NoxError::WrongAction);
        require_keys_eq!(dest, a.dest.key(), NoxError::WrongDest);

        let seeds_owned = vault_seeds(&a.state);
        let seeds = seeds_owned.as_slices();
        if !queue_if_slow(&mut a.state, tree, leaf, mint, dest, amount)? {
            require!(amount <= a.vault_ata.amount, NoxError::InsufficientFunds);
            token_out(&a.token_program, &a.vault_ata, &a.dest_ata, &a.vault, &a.mint, &seeds, amount)?;
        }
        pay_fee(&a.system_program, &a.vault, &a.fee_payee, &seeds, &action)?;
        check_rent(&a.vault)
    }

    /// Pays out the pending SOL withdrawal once its delay has passed. Permissionless.
    pub fn execute_pending(ctx: Context<ExecutePending>) -> Result<()> {
        let a = &mut *ctx.accounts;
        let p = take_due_pending(&mut a.state)?;
        require_keys_eq!(p.mint, Pubkey::default(), NoxError::WrongAction);
        require_keys_eq!(p.dest, a.dest.key(), NoxError::WrongDest);
        require!(p.amount <= a.vault.lamports(), NoxError::InsufficientFunds);
        let seeds_owned = vault_seeds(&a.state);
        sol_out(&a.system_program, &a.vault, &a.dest, &seeds_owned.as_slices(), p.amount)?;
        check_rent(&a.vault)
    }

    /// Pays out the pending token withdrawal once its delay has passed. Permissionless.
    pub fn execute_pending_token(ctx: Context<ExecutePendingToken>) -> Result<()> {
        let a = &mut *ctx.accounts;
        let p = take_due_pending(&mut a.state)?;
        require_keys_eq!(p.mint, a.mint.key(), NoxError::WrongAction);
        require_keys_eq!(p.dest, a.dest.key(), NoxError::WrongDest);
        require!(p.amount <= a.vault_ata.amount, NoxError::InsufficientFunds);
        let seeds_owned = vault_seeds(&a.state);
        token_out(&a.token_program, &a.vault_ata, &a.dest_ata, &a.vault, &a.mint, &seeds_owned.as_slices(), p.amount)
    }

    /// Opens a stake account owned by the vault and delegates it. Permissionless once verified.
    pub fn finish_stake(ctx: Context<FinishStake>) -> Result<()> {
        let a = &mut *ctx.accounts;
        let (action, _, _) = consume(&a.unlock, &a.rent_receiver, &mut a.state)?;
        let Action::Stake { seed, vote, amount, .. } = action.clone() else {
            return err!(NoxError::WrongAction);
        };
        require_keys_eq!(vote, a.vote.key(), NoxError::WrongAction);
        let vault = a.vault.key();
        let (stake_key, stake_bump) =
            Pubkey::find_program_address(&[STAKE_SEED, vault.as_ref(), &[seed]], &crate::ID);
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
        check_rent(&a.vault)
    }

    /// Deactivates one of the vault's stake accounts. Permissionless once verified.
    pub fn finish_unstake(ctx: Context<FinishStakeAuthority>) -> Result<()> {
        let a = &mut *ctx.accounts;
        let (action, _, _) = consume(&a.unlock, &a.rent_receiver, &mut a.state)?;
        let Action::Unstake { seed, .. } = action.clone() else {
            return err!(NoxError::WrongAction);
        };
        check_stake_address(&a.vault.key(), seed, &a.stake.key())?;
        let seeds_owned = vault_seeds(&a.state);
        let seeds = seeds_owned.as_slices();
        invoke_signed(
            &stake::instruction::deactivate_stake(&a.stake.key(), &a.vault.key()),
            &[
                a.stake.to_account_info(),
                a.clock.to_account_info(),
                a.vault.to_account_info(),
                a.stake_program.to_account_info(),
            ],
            &[&seeds],
        )?;
        pay_fee(&a.system_program, &a.vault, &a.fee_payee, &seeds, &action)?;
        check_rent(&a.vault)
    }

    /// Moves everything in a deactivated stake account back into the vault.
    pub fn finish_collect_stake(ctx: Context<FinishStakeAuthority>) -> Result<()> {
        let a = &mut *ctx.accounts;
        let (action, _, _) = consume(&a.unlock, &a.rent_receiver, &mut a.state)?;
        let Action::CollectStake { seed, .. } = action.clone() else {
            return err!(NoxError::WrongAction);
        };
        let vault = a.vault.key();
        check_stake_address(&vault, seed, &a.stake.key())?;
        let seeds_owned = vault_seeds(&a.state);
        let seeds = seeds_owned.as_slices();
        invoke_signed(
            &stake::instruction::withdraw(&a.stake.key(), &vault, &vault, a.stake.lamports(), None),
            &[
                a.stake.to_account_info(),
                a.vault.to_account_info(),
                a.clock.to_account_info(),
                a.stake_history.to_account_info(),
                a.vault.to_account_info(),
                a.stake_program.to_account_info(),
            ],
            &[&seeds],
        )?;
        pay_fee(&a.system_program, &a.vault, &a.fee_payee, &seeds, &action)?;
        check_rent(&a.vault)
    }

    /// Cancel (drops the pending withdrawal) and Ping (proves the owner is alive).
    pub fn finish_admin(ctx: Context<FinishAdmin>) -> Result<()> {
        let a = &mut *ctx.accounts;
        let (action, _, _) = consume(&a.unlock, &a.rent_receiver, &mut a.state)?;
        match action {
            Action::Cancel { .. } => a.state.pending = None,
            Action::Ping { .. } => {}
            _ => return err!(NoxError::WrongAction),
        }
        let seeds_owned = vault_seeds(&a.state);
        pay_fee(&a.system_program, &a.vault, &a.fee_payee, &seeds_owned.as_slices(), &action)?;
        check_rent(&a.vault)
    }

    /// Closes an unlock buffer and returns its rent. Only the payer who opened it.
    pub fn cancel_unlock(_ctx: Context<CancelUnlock>) -> Result<()> {
        Ok(())
    }
}

// ---------- shared checks ----------

/// Verifies a finished buffer against the vault's trees, burns the leaf and applies the
/// permission rules (docs/SPEC.md §5). Returns the signed action.
fn consume(unlock: &AccountLoader<Unlock>, rent_receiver: &UncheckedAccount, st: &mut VaultState) -> Result<(Action, u8, u16)> {
    let u = unlock.load()?;
    require_keys_eq!(u.payer, rent_receiver.key(), NoxError::WrongPayer);
    require_keys_eq!(u.vault, st.vault, NoxError::WrongVault);
    require!(u.verified == ALL_CHAINS, NoxError::NotVerified);

    let (want, height) = st.tree(u.tree);
    require!(height > 0 && height == u.height, NoxError::BadTree);
    let leaf = wots::leaf_hash(&u.pk_seed, u.leaf, &u.ends);
    let root = wots::root_from_path(&u.pk_seed, u.leaf, leaf, &u.auth_path[..height as usize]);
    require!(root == want, NoxError::BadSignature);
    require!(!st.used(u.tree, u.leaf), NoxError::KeyUsed);
    st.mark_used(u.tree, u.leaf);

    let action = Action::try_from_slice(&u.action[..u.action_len as usize])?;
    let now = Clock::get()?.unix_timestamp;
    if u.tree == TREE_RECOVERY {
        let unlocked = now >= st.last_active.saturating_add(st.config.recovery_delay);
        require!(matches!(action, Action::Cancel { .. }) || unlocked, NoxError::RecoveryLocked);
    } else {
        st.last_active = now;
    }
    st.actions += 1;
    Ok((action, u.tree, u.leaf))
}

/// Queues a primary-tree withdrawal outside the whitelist as the pending withdrawal.
/// Returns true if it was queued instead of paid now.
fn queue_if_slow(st: &mut VaultState, tree: u8, leaf: u16, mint: Pubkey, dest: Pubkey, amount: u64) -> Result<bool> {
    let c = &st.config;
    if tree != TREE_PRIMARY || !c.whitelist_active() || c.whitelisted(&dest) {
        return Ok(false);
    }
    require!(c.slow_delay > 0, NoxError::NotWhitelisted);
    require!(st.pending.is_none(), NoxError::PendingExists);
    let executable_at = Clock::get()?.unix_timestamp + c.slow_delay;
    st.pending = Some(Pending { mint, dest, amount, executable_at, leaf });
    msg!("withdrawal queued until {}", executable_at);
    Ok(true)
}

fn take_due_pending(st: &mut VaultState) -> Result<Pending> {
    let p = st.pending.clone().ok_or(NoxError::NoPending)?;
    require!(Clock::get()?.unix_timestamp >= p.executable_at, NoxError::NotYet);
    st.pending = None;
    Ok(p)
}

fn check_stake_address(vault: &Pubkey, seed: u8, stake: &Pubkey) -> Result<()> {
    let (want, _) = Pubkey::find_program_address(&[STAKE_SEED, vault.as_ref(), &[seed]], &crate::ID);
    require_keys_eq!(want, *stake, NoxError::WrongStake);
    Ok(())
}

fn check_rent(vault: &AccountInfo) -> Result<()> {
    let left = vault.lamports();
    require!(left == 0 || left >= Rent::get()?.minimum_balance(0), NoxError::RentDust);
    Ok(())
}

/// Signer seeds of a vault, owned so they can outlive the state borrow.
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

fn pay_fee<'info>(
    system_program: &Program<'info, System>,
    vault: &AccountInfo<'info>,
    fee_payee: &AccountInfo<'info>,
    seeds: &[&[u8]],
    action: &Action,
) -> Result<()> {
    let (fee, payee) = action.fee();
    if fee == 0 {
        return Ok(());
    }
    require_keys_eq!(payee, fee_payee.key(), NoxError::WrongFeePayee);
    require!(fee <= vault.lamports(), NoxError::InsufficientFunds);
    sol_out(system_program, vault, fee_payee, seeds, fee)
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
    vault: &AccountInfo<'info>,
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
                authority: vault.clone(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )
}

// ---------- accounts ----------

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: checked against the config hash in the handler.
    pub vault: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [STATE_SEED, vault.key().as_ref()],
        bump
    )]
    pub state: Box<Account<'info, VaultState>>,
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
    #[account(
        init,
        payer = payer,
        space = Unlock::SPACE,
        seeds = [UNLOCK_SEED, vault.key().as_ref(), payer.key().as_ref()],
        bump
    )]
    pub unlock: AccountLoader<'info, Unlock>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WriteSigs<'info> {
    pub payer: Signer<'info>,
    /// CHECK: equals unlock.vault (has_one). Listed so every transaction that publishes
    /// signature bytes shows up in the vault's history (docs/SPEC.md §8).
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
pub struct FinishWithdraw<'info> {
    #[account(mut, close = rent_receiver)]
    pub unlock: AccountLoader<'info, Unlock>,
    /// CHECK: must equal the buffer's payer; gets the buffer rent back.
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
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
pub struct FinishWithdrawToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, close = rent_receiver)]
    pub unlock: AccountLoader<'info, Unlock>,
    /// CHECK: must equal the buffer's payer; gets the buffer rent back.
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
    #[account(mut, seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program
    )]
    pub vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: must equal the signed destination owner.
    pub dest: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = dest,
        associated_token::token_program = token_program
    )]
    pub dest_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: must equal the signed fee payee when there is a fee.
    #[account(mut)]
    pub fee_payee: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecutePending<'info> {
    #[account(mut, seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    /// CHECK: must equal the pending destination.
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
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program
    )]
    pub vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: must equal the pending destination owner.
    pub dest: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = dest,
        associated_token::token_program = token_program
    )]
    pub dest_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinishStake<'info> {
    #[account(mut, close = rent_receiver)]
    pub unlock: AccountLoader<'info, Unlock>,
    /// CHECK: must equal the buffer's payer; gets the buffer rent back.
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
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
pub struct FinishStakeAuthority<'info> {
    #[account(mut, close = rent_receiver)]
    pub unlock: AccountLoader<'info, Unlock>,
    /// CHECK: must equal the buffer's payer; gets the buffer rent back.
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
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
pub struct FinishAdmin<'info> {
    #[account(mut, close = rent_receiver)]
    pub unlock: AccountLoader<'info, Unlock>,
    /// CHECK: must equal the buffer's payer; gets the buffer rent back.
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
    #[account(mut, seeds = [STATE_SEED, vault.key().as_ref()], bump, has_one = vault)]
    pub state: Box<Account<'info, VaultState>>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    /// CHECK: must equal the signed fee payee when there is a fee.
    #[account(mut)]
    pub fee_payee: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelUnlock<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, has_one = payer, close = payer)]
    pub unlock: AccountLoader<'info, Unlock>,
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
    #[msg("Action too large")]
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
    #[msg("This instruction cannot execute the signed action")]
    WrongAction,
    #[msg("Destination does not match the signed action")]
    WrongDest,
    #[msg("Fee payee does not match the signed action")]
    WrongFeePayee,
    #[msg("Stake account does not match the signed action")]
    WrongStake,
    #[msg("The vault holds less than this needs")]
    InsufficientFunds,
    #[msg("The vault would be left with less SOL than the rent minimum")]
    RentDust,
    #[msg("The recovery key may only cancel until the owner has been inactive long enough")]
    RecoveryLocked,
    #[msg("This destination is not on the vault's whitelist")]
    NotWhitelisted,
    #[msg("A withdrawal is already pending")]
    PendingExists,
    #[msg("No withdrawal is pending")]
    NoPending,
    #[msg("The pending withdrawal's delay has not passed yet")]
    NotYet,
}
