use anchor_lang::prelude::*;

use crate::wots::{LEN, MAX_HEIGHT, N};

pub const VAULT_SEED: &[u8] = b"vault";
pub const STATE_SEED: &[u8] = b"state";
pub const UNLOCK_SEED: &[u8] = b"unlock";
pub const APPROVAL_SEED: &[u8] = b"approval";
pub const STAKE_SEED: &[u8] = b"stake";
pub const SCHEDULE_SEED: &[u8] = b"schedule";
pub const BUDGET_SEED: &[u8] = b"budget";
pub const INBOX_SEED: &[u8] = b"inbox";
pub const LINK_SEED: &[u8] = b"link";
pub const ESCAPE_SEED: &[u8] = b"escape";
pub const CANARY_SEED: &[u8] = b"canary";
pub const PROTOCOL_SEED: &[u8] = b"protocol";
pub const LETTER_KEY_SEED: &[u8] = b"letterkey";
pub const LETTER_SEED: &[u8] = b"letter";

/// Who may set the protocol parameters until governance takes over (docs/SPEC.md §10).
/// Devnet: the deployer. Mainnet: the team multisig, later the governance program.
pub const PROTOCOL_ADMIN: Pubkey = anchor_lang::pubkey!("BFwro7RnsG9GR2jV3yGXGwtGkRq8MDxH9LSoTAjMQf2x");

pub const TIER_FREE: u8 = 0;
pub const TIER_GUARDIAN: u8 = 1;
pub const TIER_SENTINEL: u8 = 2;

pub const SIGNER_SLOTS: usize = 3;
pub const RECOVERY_TREE: u8 = 3;
/// The duress tree (docs/SPEC.md §11): its own phrase, stored in `Config::duress`.
pub const DURESS_TREE: u8 = 4;
pub const TREE_COUNT: usize = 5;
/// Shortest lockdown a duress withdrawal may start.
pub const MIN_DURESS_LOCK: i64 = DAY;
pub const MAX_ACTION: usize = 160;
pub const MAX_ESCAPE_TX: usize = 1232;
pub const DAY: i64 = 86_400;
pub const LINK_CHANGE_DELAY: i64 = 30 * DAY;
pub const APPROVAL_TTL: i64 = 7 * DAY;
/// Sealed letters (docs/SPEC.md §12): ciphertext bytes per letter, plaintext label bytes.
/// 8 KiB keeps a whole letter within one realloc step (10 KiB per instruction).
pub const MAX_LETTER: usize = 8_192;
pub const MAX_LETTER_LABEL: usize = 64;
/// Most lamports any action may pay as its fee (docs/SPEC.md §4, v4.1). Every execution path
/// refuses a larger fee. 0.01 SOL is ~10x what a relayer needs today (min fee 0.0001 SOL, plus
/// ~0.0015 SOL rent when the action creates the letter-key account), and bounds what a stolen
/// signer phrase can move through fees: one fee per one-time key.
pub const MAX_ACTION_FEE: u64 = 10_000_000;
/// Longest delay, lock, interval or period a config or action may set (10 years). Keeps every
/// `now + x` far from i64 overflow (docs/SPEC.md §3, v4.1).
pub const MAX_DURATION: i64 = 10 * 365 * DAY;

/// The canary: a point on the ed25519 curve found by hashing, so nobody knows its private key
/// (docs/SPEC.md §7). Derivation: first i with SHA256("noxvault/canary/v1" || u32le(i)) on the
/// curve; i = 0. Base58 6S396A19NFHWdABtBP17tjfFCZA9LJuuvuPK7hWzj7w9.
pub const CANARY_ADDRESS: Pubkey = Pubkey::new_from_array([
    0x50, 0xb4, 0x5f, 0xbb, 0xb1, 0x9c, 0x72, 0x9b, 0xc3, 0x7c, 0xd3, 0x46, 0xf1, 0xf6, 0xdf, 0xaf,
    0xeb, 0x74, 0x40, 0x42, 0x18, 0x7c, 0xe5, 0xc8, 0xa0, 0x5c, 0x7f, 0x6b, 0x59, 0xe8, 0xe0, 0x5c,
]);

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Default)]
pub struct Tree {
    pub root: [u8; N],
    pub height: u8,
}

impl Tree {
    pub fn used(&self) -> bool {
        self.root != [0u8; N]
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Default)]
pub struct Heir {
    pub addr: Pubkey,
    pub bps: u16,
}

/// The rules of a vault. Its hash is part of the vault address, so it can never change.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq)]
pub struct Config {
    pub trees: [Tree; 4],
    pub threshold: u8,
    pub recovery_delay: i64,
    pub whitelist: [Pubkey; 4],
    pub slow_delay: i64,
    pub instant_limit: u64,
    pub heirs: [Heir; 4],
    pub testament_delay: i64,
    /// Duress tree: always filled (a random root when the owner set no duress phrase), so
    /// every vault looks the same (docs/SPEC.md §11).
    pub duress: Tree,
    /// Lamports a duress withdrawal pays out at once.
    pub duress_limit: u64,
    /// Lockdown length after a duress withdrawal (at least one day).
    pub duress_lock: i64,
}

/// Tree `idx` of a config: 0..2 signers, 3 recovery, 4 duress.
pub fn tree_of(config: &Config, idx: u8) -> Option<Tree> {
    match idx {
        i if i <= RECOVERY_TREE => Some(config.trees[i as usize]),
        DURESS_TREE => Some(config.duress),
        _ => None,
    }
}

impl Config {
    pub fn signer_trees(&self) -> u8 {
        self.trees[..SIGNER_SLOTS].iter().filter(|t| t.used()).count() as u8
    }
    pub fn has_recovery(&self) -> bool {
        self.trees[RECOVERY_TREE as usize].used()
    }
    pub fn whitelist_active(&self) -> bool {
        self.whitelist.iter().any(|k| *k != Pubkey::default())
    }
    pub fn whitelisted(&self, k: &Pubkey) -> bool {
        *k != Pubkey::default() && self.whitelist.contains(k)
    }
    /// docs/SPEC.md §3: restricted destinations wait or are refused.
    pub fn restricted(&self, dest: &Pubkey) -> bool {
        if self.whitelist_active() {
            !self.whitelisted(dest)
        } else {
            self.instant_limit > 0
        }
    }
    /// True when at least one destination is not restricted (§3), i.e. a session budget can
    /// ever spend: a whitelist is set, or there is no instant limit.
    pub fn has_unrestricted(&self) -> bool {
        self.whitelist_active() || self.instant_limit == 0
    }
    pub fn testament_active(&self) -> bool {
        self.testament_delay > 0 && self.heirs.iter().any(|h| h.addr != Pubkey::default())
    }
    /// Every used root (signer slots, recovery slot, duress tree) differs from every other.
    pub fn roots_distinct(&self) -> bool {
        let roots: Vec<&[u8; N]> = self.trees.iter().chain(core::iter::once(&self.duress)).filter(|t| t.used()).map(|t| &t.root).collect();
        roots.iter().enumerate().all(|(i, a)| roots[i + 1..].iter().all(|b| a != b))
    }
    /// Delays and locks are at most MAX_DURATION (negative values are refused separately).
    pub fn durations_bounded(&self) -> bool {
        [self.slow_delay, self.recovery_delay, self.testament_delay, self.duress_lock].iter().all(|d| *d <= MAX_DURATION)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum Kind {
    Withdraw { mint: Pubkey, dest: Pubkey, amount: u64 },
    Stake { seed: u8, vote: Pubkey, amount: u64 },
    Unstake { seed: u8 },
    CollectStake { seed: u8 },
    Cancel,
    Ping,
    Schedule { id: u8, mint: Pubkey, dest: Pubkey, amount: u64, interval: i64, count: u16, start: i64 },
    CancelSchedule { id: u8 },
    Budget { id: u8, session: Pubkey, mint: Pubkey, limit: u64, period: i64, expires: i64 },
    CancelBudget { id: u8 },
    Migrate { new_vault: Pubkey },
    /// Authorizes an ordinary ed25519 key to write the vault's sealed letters (docs/SPEC.md §12).
    /// The default key revokes it.
    LetterKey { key: Pubkey },
}

/// What one approval authorizes. Signed as borsh bytes (docs/SPEC.md §4).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub struct Action {
    pub kind: Kind,
    pub fee: u64,
    pub fee_payee: Pubkey,
}

impl Action {
    /// Actions the recovery tree may approve at any time.
    pub fn is_cancel(&self) -> bool {
        matches!(self.kind, Kind::Cancel | Kind::CancelSchedule { .. } | Kind::CancelBudget { .. })
    }
    /// Actions signer approvals may still execute during a lockdown (with fee 0, v4.1).
    pub fn allowed_in_lockdown(&self) -> bool {
        self.is_cancel() || matches!(self.kind, Kind::Ping)
    }
    /// Intervals and periods the action sets are within (0, MAX_DURATION] where it has them.
    pub fn durations_bounded(&self) -> bool {
        match self.kind {
            Kind::Schedule { interval, .. } => interval <= MAX_DURATION,
            Kind::Budget { period, .. } => period <= MAX_DURATION,
            _ => true,
        }
    }
}

pub const PENDING_WITHDRAW: u8 = 0;
pub const PENDING_MIGRATE: u8 = 1;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct Pending {
    pub kind: u8,
    pub mint: Pubkey,
    pub dest: Pubkey,
    pub amount: u64,
    pub executable_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct VaultState {
    pub vault: Pubkey,
    pub vault_bump: u8,
    pub config_hash: [u8; N],
    pub config: Config,
    /// Bit l of used[t] set once leaf l of tree t has been used (t = 4: duress tree).
    pub used: [[u8; 32]; TREE_COUNT],
    pub last_active: i64,
    pub created_at: i64,
    pub actions: u32,
    pub pending: Option<Pending>,
    /// 24 h window for the instant limit.
    pub window_start: i64,
    pub window_spent: u64,
    pub migrate_to: Option<Pubkey>,
    /// Until then only Ping and cancels execute (set by a duress withdrawal, docs/SPEC.md §11).
    pub lockdown_until: i64,
}

impl VaultState {
    pub fn locked(&self, now: i64) -> bool {
        now < self.lockdown_until
    }
    pub fn used(&self, tree: u8, leaf: u16) -> bool {
        self.used[tree as usize][(leaf / 8) as usize] & (1 << (leaf % 8)) != 0
    }
    pub fn mark_used(&mut self, tree: u8, leaf: u16) {
        self.used[tree as usize][(leaf / 8) as usize] |= 1 << (leaf % 8);
    }
    pub fn inactive_for(&self, delay: i64, now: i64) -> bool {
        now >= self.last_active.saturating_add(delay)
    }
}

/// Approvals collected for one action (docs/SPEC.md §4).
#[account]
#[derive(InitSpace)]
pub struct Approval {
    pub vault: Pubkey,
    pub action_hash: [u8; N],
    pub action: [u8; MAX_ACTION],
    pub action_len: u16,
    /// Bit t set once tree t approved.
    pub trees: u8,
    pub creator: Pubkey,
    pub created_at: i64,
}

impl Approval {
    pub fn action(&self) -> Result<Action> {
        Ok(Action::try_from_slice(&self.action[..self.action_len as usize])?)
    }
}

#[account]
#[derive(InitSpace)]
pub struct Schedule {
    pub vault: Pubkey,
    pub id: u8,
    pub mint: Pubkey,
    pub dest: Pubkey,
    pub amount: u64,
    pub interval: i64,
    pub remaining: u16,
    pub next_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct Budget {
    pub vault: Pubkey,
    pub id: u8,
    pub session: Pubkey,
    pub mint: Pubkey,
    pub limit: u64,
    pub period: i64,
    pub expires: i64,
    pub window_start: i64,
    pub spent: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct LinkChange {
    pub vault: Pubkey,
    pub at: i64,
}

/// An ordinary wallet's link to its vault: registry entry and Escape Hatch (docs/SPEC.md §7).
#[account]
#[derive(InitSpace)]
pub struct Link {
    pub wallet: Pubkey,
    pub vault: Pubkey,
    pub created_at: i64,
    pub panic: bool,
    pub change: Option<LinkChange>,
    #[max_len(MAX_ESCAPE_TX)]
    pub escape_tx: Vec<u8>,
}

/// Protocol parameters: the $NOX mint, tier thresholds and fees (docs/SPEC.md §10).
#[account]
#[derive(InitSpace)]
pub struct Protocol {
    pub admin: Pubkey,
    pub params: ProtocolParams,
    /// Once true, nothing here can change again.
    pub frozen: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct ProtocolParams {
    /// default = tiers off: every feature open to everyone.
    pub nox_mint: Pubkey,
    /// $NOX base units a vault must hold for each tier.
    pub guardian: u64,
    pub sentinel: u64,
    /// Lamports a free-tier vault pays the treasury once, at creation.
    pub create_fee: u64,
    pub treasury: Pubkey,
}

#[account]
#[derive(InitSpace)]
pub struct Canary {
    pub watched: Pubkey,
    pub baseline: u64,
    pub tripped: bool,
    pub tripped_at: i64,
}

/// The key allowed to write a vault's sealed letters (docs/SPEC.md §12). A separate account so
/// `VaultState` keeps its layout. PDA ["letterkey", vault].
#[account]
#[derive(InitSpace)]
pub struct LetterKey {
    pub vault: Pubkey,
    /// default = no letter key (revoked).
    pub key: Pubkey,
    pub updated_at: i64,
}

/// One sealed letter: tlock ciphertext only, written by the vault's letter key.
/// PDA ["letter", vault, u32le(id)].
#[account]
pub struct Letter {
    pub vault: Pubkey,
    pub id: u32,
    /// drand quicknet round after which the ciphertext can be decrypted.
    pub unlock_round: u64,
    pub updated_at: i64,
    /// Bytes of `content` written so far; the letter is complete when filled == content.len().
    pub filled: u32,
    /// Short plaintext label / recipient hint (at most MAX_LETTER_LABEL bytes).
    pub label: Vec<u8>,
    /// Opaque ciphertext (at most MAX_LETTER bytes).
    pub content: Vec<u8>,
}

impl Letter {
    pub fn space(label_len: usize, content_len: usize) -> usize {
        8 + 32 + 4 + 8 + 8 + 4 + (4 + label_len) + (4 + content_len)
    }
}

/// A signed action being assembled and verified over several transactions.
/// Zero-copy: the signature and chain ends are too big for the BPF stack.
#[account(zero_copy)]
pub struct Unlock {
    pub written: u64,
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
    pub frozen: u8,
    pub bump: u8,
    pub digits: [u8; LEN],
    pub _pad: [u8; 6],
    pub sigs: [[u8; N]; LEN],
    pub ends: [[u8; N]; LEN],
}

impl Unlock {
    pub const SPACE: usize = 8 + std::mem::size_of::<Unlock>();
}
