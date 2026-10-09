//! Noxvault: SOL and tokens that only move with a WOTS+ hash-based signature.
//! The protocol is described in docs/SPEC.md; this program follows it step by step.
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

pub mod state;
pub mod wots;

use state::*;
use wots::{ALL_CHAINS, LEN, N};

declare_id!("8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4");

#[program]
pub mod noxvault {
    use super::*;

    /// Lists a vault in the public explorer. Anyone can do it; it proves nothing but the address.
    pub fn register(ctx: Context<Register>, root: [u8; N]) -> Result<()> {
        let (vault, _) = Pubkey::find_program_address(&[VAULT_SEED, &root], &crate::ID);
        require_keys_eq!(vault, ctx.accounts.vault.key(), NoxError::WrongVault);
        let r = &mut ctx.accounts.record;
        r.vault = vault;
        r.root = root;
        r.created_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn open_unlock(ctx: Context<OpenUnlock>, args: OpenArgs) -> Result<()> {
        let vault = ctx.accounts.vault.key();
        require_keys_neq!(args.next_vault, vault, NoxError::NextIsSelf);
        require_keys_neq!(args.dest, vault, NoxError::DestIsSelf);
        require!(args.amount > 0, NoxError::ZeroAmount);

        let mut u = ctx.accounts.unlock.load_init()?;
        u.vault = vault;
        u.payer = ctx.accounts.payer.key();
        u.pk_seed = args.pk_seed;
        u.mint = args.mint;
        u.dest = args.dest;
        u.next_vault = args.next_vault;
        u.amount = args.amount;
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
            let d = wots::message_digest(&u.vault, &u.mint, &u.dest, &u.next_vault, u.amount);
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
            let end = wots::chain_to_end(&u.pk_seed, j, u.sigs[i], u.digits[i]);
            u.ends[i] = end;
            u.verified |= bit;
        }
        Ok(())
    }

    /// Pays out SOL once the signature rebuilds the vault. Permissionless.
    pub fn finish_unlock(ctx: Context<FinishUnlock>) -> Result<()> {
        let v = checked_unlock(&ctx.accounts.unlock, &ctx.accounts.rent_receiver)?;
        require_keys_eq!(v.vault, ctx.accounts.vault.key(), NoxError::WrongVault);
        require_keys_eq!(v.dest, ctx.accounts.dest.key(), NoxError::WrongDest);
        require_keys_eq!(v.next_vault, ctx.accounts.next_vault.key(), NoxError::WrongNext);
        require_keys_eq!(v.mint, Pubkey::default(), NoxError::WrongMint);

        let balance = ctx.accounts.vault.lamports();
        require!(v.amount <= balance, NoxError::InsufficientFunds);
        let mut payment = v.amount;
        let mut rest = balance - v.amount;
        let rent_min = Rent::get()?.minimum_balance(0);
        if rest > 0 && rest < rent_min && ctx.accounts.next_vault.lamports() == 0 {
            payment += rest;
            rest = 0;
        }

        let seeds: &[&[u8]] = &[VAULT_SEED, &v.root, &[v.vault_bump]];
        let sys = ctx.accounts.system_program.to_account_info();
        let from = ctx.accounts.vault.to_account_info();
        sol_transfer(&sys, &from, &ctx.accounts.dest, seeds, payment)?;
        sol_transfer(&sys, &from, &ctx.accounts.next_vault, seeds, rest)?;

        mark_spent(&mut ctx.accounts.spent, &v)?;
        msg!("unlock {} lamports, {} forwarded", payment, rest);
        Ok(())
    }

    /// Pays out an SPL / Token-2022 token once the signature rebuilds the vault. Permissionless.
    pub fn finish_unlock_token(ctx: Context<FinishUnlockToken>) -> Result<()> {
        let v = checked_unlock(&ctx.accounts.unlock, &ctx.accounts.rent_receiver)?;
        let a = &ctx.accounts;
        require_keys_eq!(v.vault, a.vault.key(), NoxError::WrongVault);
        require_keys_eq!(v.dest, a.dest.key(), NoxError::WrongDest);
        require_keys_eq!(v.next_vault, a.next_vault.key(), NoxError::WrongNext);
        require_keys_eq!(v.mint, a.mint.key(), NoxError::WrongMint);

        let balance = a.vault_ata.amount;
        require!(v.amount <= balance, NoxError::InsufficientFunds);
        let seeds: &[&[u8]] = &[VAULT_SEED, &v.root, &[v.vault_bump]];
        token_out(a.token(), &a.vault_ata, &a.dest_ata, &a.vault, &a.mint, seeds, v.amount)?;
        token_out(a.token(), &a.vault_ata, &a.next_ata, &a.vault, &a.mint, seeds, balance - v.amount)?;
        close_ata(a.token(), &a.vault_ata, &a.next_vault, &a.vault, seeds)?;

        mark_spent(&mut ctx.accounts.spent, &v)?;
        Ok(())
    }

    /// Forwards all SOL in a spent vault to its successor. Permissionless.
    pub fn sweep(ctx: Context<Sweep>) -> Result<()> {
        let s = &ctx.accounts.spent;
        let amount = ctx.accounts.vault.lamports();
        if amount == 0 {
            return Ok(());
        }
        let rent_min = Rent::get()?.minimum_balance(0);
        require!(
            amount >= rent_min || ctx.accounts.successor.lamports() > 0,
            NoxError::DustTooSmall
        );
        let seeds: &[&[u8]] = &[VAULT_SEED, &s.root, &[s.vault_bump]];
        sol_transfer(
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.successor,
            seeds,
            amount,
        )
    }

    /// Forwards all of one token in a spent vault to its successor and closes the vault's ATA.
    pub fn sweep_token(ctx: Context<SweepToken>) -> Result<()> {
        let a = &ctx.accounts;
        let seeds: &[&[u8]] = &[VAULT_SEED, &a.spent.root, &[a.spent.vault_bump]];
        let amount = a.vault_ata.amount;
        token_out(a.token(), &a.vault_ata, &a.successor_ata, &a.vault, &a.mint, seeds, amount)?;
        close_ata(a.token(), &a.vault_ata, &a.successor, &a.vault, seeds)
    }

    /// Closes an unlock buffer and returns its rent. Only the payer who opened it.
    pub fn cancel_unlock(_ctx: Context<CancelUnlock>) -> Result<()> {
        Ok(())
    }
}

/// The parts of a fully verified unlock that payout needs, copied out of the zero-copy buffer.
struct Verified {
    vault: Pubkey,
    root: [u8; N],
    vault_bump: u8,
    mint: Pubkey,
    dest: Pubkey,
    next_vault: Pubkey,
    amount: u64,
}

fn checked_unlock(unlock: &AccountLoader<Unlock>, rent_receiver: &UncheckedAccount) -> Result<Verified> {
    let u = unlock.load()?;
    require_keys_eq!(u.payer, rent_receiver.key(), NoxError::WrongPayer);
    require!(u.verified == ALL_CHAINS, NoxError::NotVerified);
    let root = wots::root_from_ends(&u.pk_seed, &u.ends);
    let (vault, vault_bump) = Pubkey::find_program_address(&[VAULT_SEED, &root], &crate::ID);
    require_keys_eq!(vault, u.vault, NoxError::BadSignature);
    Ok(Verified {
        vault,
        root,
        vault_bump,
        mint: u.mint,
        dest: u.dest,
        next_vault: u.next_vault,
        amount: u.amount,
    })
}

fn mark_spent(spent: &mut Account<Spent>, v: &Verified) -> Result<()> {
    spent.vault = v.vault;
    spent.root = v.root;
    spent.vault_bump = v.vault_bump;
    spent.successor = v.next_vault;
    spent.mint = v.mint;
    spent.dest = v.dest;
    spent.amount = v.amount;
    spent.slot = Clock::get()?.slot;
    Ok(())
}

fn sol_transfer<'info>(
    system_program: &AccountInfo<'info>,
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
            system_program.clone(),
            system_program::Transfer { from: from.clone(), to: to.clone() },
            &[seeds],
        ),
        lamports,
    )
}

fn token_out<'info>(
    token_program: AccountInfo<'info>,
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
            token_program,
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

fn close_ata<'info>(
    token_program: AccountInfo<'info>,
    ata: &InterfaceAccount<'info, TokenAccount>,
    destination: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    seeds: &[&[u8]],
) -> Result<()> {
    token_interface::close_account(CpiContext::new_with_signer(
        token_program,
        CloseAccount {
            account: ata.to_account_info(),
            destination: destination.clone(),
            authority: vault.clone(),
        },
        &[seeds],
    ))
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OpenArgs {
    pub pk_seed: [u8; N],
    pub mint: Pubkey,
    pub dest: Pubkey,
    pub next_vault: Pubkey,
    pub amount: u64,
}

#[derive(Accounts)]
#[instruction(root: [u8; N])]
pub struct Register<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: checked against the root in the handler.
    pub vault: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Record::INIT_SPACE,
        seeds = [RECORD_SEED, vault.key().as_ref()],
        bump
    )]
    pub record: Account<'info, Record>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenUnlock<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: only used as a seed; the signature must rebuild it before anything moves.
    pub vault: UncheckedAccount<'info>,
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
    /// signature bytes shows up in the vault's history, where clients look for an earlier
    /// signature before ever signing (docs/SPEC.md, client rules).
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
pub struct FinishUnlock<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, close = rent_receiver)]
    pub unlock: AccountLoader<'info, Unlock>,
    /// CHECK: must equal the buffer's payer; gets the buffer rent back.
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Spent::INIT_SPACE,
        seeds = [SPENT_SEED, vault.key().as_ref()],
        bump
    )]
    pub spent: Account<'info, Spent>,
    /// CHECK: must equal the signed destination.
    #[account(mut)]
    pub dest: UncheckedAccount<'info>,
    /// CHECK: must equal the signed next vault.
    #[account(mut)]
    pub next_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinishUnlockToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, close = rent_receiver)]
    pub unlock: AccountLoader<'info, Unlock>,
    /// CHECK: must equal the buffer's payer; gets the buffer rent back.
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
    /// CHECK: PDA rebuilt from the signature in the handler.
    pub vault: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Spent::INIT_SPACE,
        seeds = [SPENT_SEED, vault.key().as_ref()],
        bump
    )]
    pub spent: Box<Account<'info, Spent>>,
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
    /// CHECK: must equal the signed next vault; receives the closed ATA's rent.
    #[account(mut)]
    pub next_vault: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = next_vault,
        associated_token::token_program = token_program
    )]
    pub next_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> FinishUnlockToken<'info> {
    fn token(&self) -> AccountInfo<'info> {
        self.token_program.to_account_info()
    }
}

#[derive(Accounts)]
pub struct Sweep<'info> {
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    #[account(seeds = [SPENT_SEED, vault.key().as_ref()], bump, has_one = vault, has_one = successor)]
    pub spent: Account<'info, Spent>,
    /// CHECK: equals spent.successor (has_one).
    #[account(mut)]
    pub successor: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SweepToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: equals spent.vault (has_one).
    pub vault: UncheckedAccount<'info>,
    #[account(seeds = [SPENT_SEED, vault.key().as_ref()], bump, has_one = vault, has_one = successor)]
    pub spent: Box<Account<'info, Spent>>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program
    )]
    pub vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: equals spent.successor (has_one); receives the closed ATA's rent.
    #[account(mut)]
    pub successor: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = successor,
        associated_token::token_program = token_program
    )]
    pub successor_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> SweepToken<'info> {
    fn token(&self) -> AccountInfo<'info> {
        self.token_program.to_account_info()
    }
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
    #[msg("The next vault cannot be the vault itself")]
    NextIsSelf,
    #[msg("The destination cannot be the vault itself")]
    DestIsSelf,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("The signature can no longer change: verification has started")]
    Frozen,
    #[msg("Chain index out of range")]
    ChainOutOfRange,
    #[msg("Not every chain of the signature has been written")]
    SignatureIncomplete,
    #[msg("Not every chain has been verified")]
    NotVerified,
    #[msg("The signature does not rebuild this vault")]
    BadSignature,
    #[msg("Rent receiver must be the account that opened the unlock")]
    WrongPayer,
    #[msg("Destination does not match the signed message")]
    WrongDest,
    #[msg("Next vault does not match the signed message")]
    WrongNext,
    #[msg("Asset does not match the signed message")]
    WrongMint,
    #[msg("The vault holds less than the signed amount")]
    InsufficientFunds,
    #[msg("Too little SOL to open the successor vault")]
    DustTooSmall,
}
