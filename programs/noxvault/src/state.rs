use anchor_lang::prelude::*;

use crate::wots::{LEN, N};

pub const VAULT_SEED: &[u8] = b"vault";
pub const UNLOCK_SEED: &[u8] = b"unlock";
pub const SPENT_SEED: &[u8] = b"spent";
pub const RECORD_SEED: &[u8] = b"record";

/// A signed withdrawal being assembled and verified over several transactions.
/// Zero-copy: the signature and chain ends are too big for the BPF stack.
#[account(zero_copy)]
pub struct Unlock {
    pub amount: u64,
    /// Bit j set once chain j's signature value is written.
    pub written: u64,
    /// Bit j set once chain j has been walked to its end.
    pub verified: u64,
    pub vault: Pubkey,
    pub payer: Pubkey,
    pub pk_seed: [u8; N],
    pub mint: Pubkey,
    pub dest: Pubkey,
    pub next_vault: Pubkey,
    /// Digits of the message digest, fixed when the buffer freezes.
    pub digits: [u8; LEN],
    /// 1 once verification started: the message and signature can no longer change.
    pub frozen: u8,
    pub bump: u8,
    pub _pad: [u8; 4],
    pub sigs: [[u8; N]; LEN],
    pub ends: [[u8; N]; LEN],
}

impl Unlock {
    pub const SPACE: usize = 8 + std::mem::size_of::<Unlock>();
}

/// Marks a vault key as used. Its existence is what stops a key from ever signing twice.
#[account]
#[derive(InitSpace)]
pub struct Spent {
    pub vault: Pubkey,
    pub root: [u8; N],
    pub vault_bump: u8,
    /// Where everything left in (or later sent to) this vault is forwarded.
    pub successor: Pubkey,
    pub mint: Pubkey,
    pub dest: Pubkey,
    pub amount: u64,
    pub slot: u64,
}

/// Optional public listing of a vault, for the explorer.
#[account]
#[derive(InitSpace)]
pub struct Record {
    pub vault: Pubkey,
    pub root: [u8; N],
    pub created_at: i64,
}
