use anchor_lang::prelude::*;

use crate::wots::{LEN, MAX_HEIGHT, N};

pub const VAULT_SEED: &[u8] = b"vault";
pub const STATE_SEED: &[u8] = b"state";
pub const UNLOCK_SEED: &[u8] = b"unlock";
pub const STAKE_SEED: &[u8] = b"stake";

pub const TREE_PRIMARY: u8 = 0;
pub const TREE_RECOVERY: u8 = 1;
pub const MAX_ACTION: usize = 160;

/// The rules of a vault. Its hash is part of the vault address, so it can never change.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq)]
pub struct Config {
    pub primary_root: [u8; N],
    pub primary_height: u8,
    pub recovery_root: [u8; N],
    pub recovery_height: u8,
    pub recovery_delay: i64,
    pub whitelist: [Pubkey; 4],
    pub slow_delay: i64,
}

impl Config {
    pub fn has_recovery(&self) -> bool {
        self.recovery_root != [0u8; N]
    }
    pub fn whitelist_active(&self) -> bool {
        self.whitelist.iter().any(|k| *k != Pubkey::default())
    }
    pub fn whitelisted(&self, dest: &Pubkey) -> bool {
        *dest != Pubkey::default() && self.whitelist.contains(dest)
    }
}

/// What one one-time key authorizes. Signed as borsh bytes (docs/SPEC.md §5).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum Action {
    Withdraw { mint: Pubkey, dest: Pubkey, amount: u64, fee: u64, fee_payee: Pubkey },
    Stake { seed: u8, vote: Pubkey, amount: u64, fee: u64, fee_payee: Pubkey },
    Unstake { seed: u8, fee: u64, fee_payee: Pubkey },
    CollectStake { seed: u8, fee: u64, fee_payee: Pubkey },
    Cancel { fee: u64, fee_payee: Pubkey },
    Ping { fee: u64, fee_payee: Pubkey },
}

impl Action {
    pub fn fee(&self) -> (u64, Pubkey) {
        match self {
            Action::Withdraw { fee, fee_payee, .. }
            | Action::Stake { fee, fee_payee, .. }
            | Action::Unstake { fee, fee_payee, .. }
            | Action::CollectStake { fee, fee_payee, .. }
            | Action::Cancel { fee, fee_payee }
            | Action::Ping { fee, fee_payee } => (*fee, *fee_payee),
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct Pending {
    pub mint: Pubkey,
    pub dest: Pubkey,
    pub amount: u64,
    pub executable_at: i64,
    pub leaf: u16,
}

#[account]
#[derive(InitSpace)]
pub struct VaultState {
    pub vault: Pubkey,
    pub vault_bump: u8,
    pub config_hash: [u8; N],
    pub config: Config,
    /// Bit l set once leaf l of the tree has been used.
    pub used_primary: [u8; 32],
    pub used_recovery: [u8; 32],
    pub last_active: i64,
    pub created_at: i64,
    pub actions: u32,
    pub pending: Option<Pending>,
}

impl VaultState {
    pub fn used(&self, tree: u8, leaf: u16) -> bool {
        let map = if tree == TREE_PRIMARY { &self.used_primary } else { &self.used_recovery };
        map[(leaf / 8) as usize] & (1 << (leaf % 8)) != 0
    }
    pub fn mark_used(&mut self, tree: u8, leaf: u16) {
        let map = if tree == TREE_PRIMARY { &mut self.used_primary } else { &mut self.used_recovery };
        map[(leaf / 8) as usize] |= 1 << (leaf % 8);
    }
    pub fn tree(&self, tree: u8) -> ([u8; N], u8) {
        if tree == TREE_PRIMARY {
            (self.config.primary_root, self.config.primary_height)
        } else {
            (self.config.recovery_root, self.config.recovery_height)
        }
    }
}

/// A signed action being assembled and verified over several transactions.
/// Zero-copy: the signature and chain ends are too big for the BPF stack.
#[account(zero_copy)]
pub struct Unlock {
    /// Bit j set once chain j's signature value is written.
    pub written: u64,
    /// Bit j set once chain j has been walked to its end.
    pub verified: u64,
    pub vault: Pubkey,
    pub payer: Pubkey,
    pub pk_seed: [u8; N],
    pub auth_path: [[u8; N]; MAX_HEIGHT],
    pub action: [u8; MAX_ACTION],
    pub action_len: u16,
    pub leaf: u16,
    pub tree: u8,
    pub height: u8,
    /// 1 once verification started: the message and signature can no longer change.
    pub frozen: u8,
    pub bump: u8,
    /// Digits of the message digest, fixed when the buffer freezes.
    pub digits: [u8; LEN],
    pub _pad: [u8; 6],
    pub sigs: [[u8; N]; LEN],
    pub ends: [[u8; N]; LEN],
}

impl Unlock {
    pub const SPACE: usize = 8 + std::mem::size_of::<Unlock>();
}
