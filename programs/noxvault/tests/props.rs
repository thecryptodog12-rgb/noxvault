//! Host-side property tests for the program's pure functions (wots.rs, state.rs), with no extra
//! crates: a fixed-seed xorshift generator drives each property over many random inputs. IDs
//! (R-xx) refer to docs/audit/INVARIANTS.md. Run: `cargo test -p noxvault --test props`
//! (or `pnpm test:rust`). Override the seed with NOX_PROP_SEED=<u64>, the run count with
//! NOX_PROP_RUNS=<n>. Parity vectors were produced by sdk/wots.ts, so these tests also pin the
//! Rust and TypeScript implementations to each other.
use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::hash::hashv;
use anchor_lang::{AccountSerialize, AnchorSerialize};
use noxvault::state::*;
use noxvault::wots::{self, LEN, N, STEPS};

struct Rng(u64);
impl Rng {
    fn new() -> Self {
        let seed = std::env::var("NOX_PROP_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or(0x9e37_79b9_7f4a_7c15);
        Rng(seed | 1)
    }
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn bytes32(&mut self) -> [u8; 32] {
        let mut b = [0u8; 32];
        for c in b.chunks_mut(8) {
            c.copy_from_slice(&self.next().to_le_bytes());
        }
        b
    }
    fn key(&mut self) -> Pubkey {
        Pubkey::new_from_array(self.bytes32())
    }
}

fn runs(default: usize) -> usize {
    std::env::var("NOX_PROP_RUNS").ok().and_then(|s| s.parse().ok()).unwrap_or(default)
}

fn unhex(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap();
    }
    out
}

/// One step of chain j at position k (docs/SPEC.md §2 `F`), as the program computes it.
fn f(pk: &[u8; N], leaf: u16, j: u8, k: u8, v: &[u8; N]) -> [u8; N] {
    hashv(&[pk, &leaf.to_le_bytes(), &[j, k], v]).to_bytes()
}

// ---------- parity with sdk/wots.ts ----------

#[test]
fn r01_parity_with_the_typescript_sdk() {
    let vault = [7u8; 32];
    let action: Vec<u8> = (0..42u32).map(|i| (i * 3 & 255) as u8).collect();
    let d = wots::message_digest(&vault, 2, 300, &action);
    assert_eq!(d, unhex("f46834c06985a2a2960019e3969ce23b0c0ef1a514cdbe2f1c01b5856a60f9b7"));
    assert_eq!(&wots::digits(&d)[32..], &[16, 46]);
    let pk = [9u8; 32];
    assert_eq!(wots::chain_to_end(&pk, 17, 3, [5u8; 32], 200), unhex("9f17365f11805c757cbc50c9f4f4f4b74485f478a10a8d3bc30252e26278cd34"));
    let mut ends = [[0u8; N]; LEN];
    for (j, e) in ends.iter_mut().enumerate() {
        *e = [j as u8; 32];
    }
    let leaf = wots::leaf_hash(&pk, 17, &ends);
    assert_eq!(leaf, unhex("8ea4109d380fd19972e3934af6d6faa9341bc7cda5e930afb466e105e5e30e20"));
    let root = wots::root_from_path(&pk, 5, leaf, &[[1u8; 32], [2u8; 32], [3u8; 32]]);
    assert_eq!(root, unhex("85b0a9ecb4027d934014c8de52ab6e45da1807d9da4f4b0c371764d02bb82c10"));
    assert_eq!(wots::action_hash(&action), unhex("70145f9d4d70da571e484cd924344c9843a96741bda9e0cd588ce304e288221f"));
    assert_eq!(wots::config_hash(&action), unhex("c168081a58c6bfba8fad93ad427837c1060db3867445b5ca08264372eac93e76"));
}

// ---------- WOTS+ ----------

#[test]
fn r02_checksum_goes_down_when_any_message_digit_goes_up() {
    let mut r = Rng::new();
    for _ in 0..runs(20_000) {
        let d = r.bytes32();
        let mut d2 = d;
        let i = r.below(32) as usize;
        let room = 255 - d[i];
        if room == 0 {
            continue;
        }
        d2[i] += 1 + r.below(room as u64) as u8;
        // A few more random raises.
        for _ in 0..r.below(4) {
            let k = r.below(32) as usize;
            d2[k] = d2[k].saturating_add(r.below(10) as u8);
        }
        let (a, b) = (wots::digits(&d), wots::digits(&d2));
        assert_eq!(&a[..32], &d[..]);
        let ca = (a[32] as u32) << 8 | a[33] as u32;
        let cb = (b[32] as u32) << 8 | b[33] as u32;
        assert!(ca <= 32 * STEPS as u32);
        assert!(cb < ca, "checksum must strictly drop");
        assert!(b[32] < a[32] || b[33] < a[33], "some checksum digit must drop");
    }
}

#[test]
fn r03_chain_to_end_composes_step_by_step() {
    let mut r = Rng::new();
    for _ in 0..runs(200) {
        let pk = r.bytes32();
        let v = r.bytes32();
        let leaf = r.below(256) as u16;
        let j = r.below(LEN as u64) as u8;
        let start = r.below(255) as u8;
        // end(v, start) == end(F(v, start), start + 1), and end(v, 255) == v.
        let next = f(&pk, leaf, j, start, &v);
        assert_eq!(wots::chain_to_end(&pk, leaf, j, v, start), wots::chain_to_end(&pk, leaf, j, next, start + 1));
        assert_eq!(wots::chain_to_end(&pk, leaf, j, v, STEPS), v);
    }
}

#[test]
fn r04_every_leaf_of_a_tree_climbs_to_the_same_root() {
    let mut r = Rng::new();
    for _ in 0..runs(50) {
        let pk = r.bytes32();
        let height = 1 + r.below(4) as usize; // 1..=4
        let leaves: Vec<[u8; 32]> = (0..1usize << height).map(|_| r.bytes32()).collect();
        let mut levels = vec![leaves.clone()];
        for h in 1..=height {
            let below = &levels[h - 1];
            let row: Vec<[u8; 32]> = (0..below.len() / 2)
                .map(|i| hashv(&[b"nox2/node", &pk, &[h as u8], &(i as u16).to_le_bytes(), &below[2 * i], &below[2 * i + 1]]).to_bytes())
                .collect();
            levels.push(row);
        }
        let root = levels[height][0];
        for (l, leaf) in leaves.iter().enumerate() {
            let path: Vec<[u8; 32]> = (0..height).map(|h| levels[h][(l >> h) ^ 1]).collect();
            assert_eq!(wots::root_from_path(&pk, l as u16, *leaf, &path), root);
            // The same path from a different index never reaches the root.
            let other = (l ^ 1) as u16;
            assert_ne!(wots::root_from_path(&pk, other, *leaf, &path), root);
        }
    }
}

#[test]
fn r05_digest_binds_vault_tree_leaf_and_action() {
    let mut r = Rng::new();
    for _ in 0..runs(2_000) {
        let vault = r.bytes32();
        let tree = r.below(5) as u8;
        let leaf = r.below(256) as u16;
        let action: Vec<u8> = (0..1 + r.below(160)).map(|_| r.next() as u8).collect();
        let d = wots::message_digest(&vault, tree, leaf, &action);
        let mut v2 = vault;
        v2[r.below(32) as usize] ^= 1 << r.below(8);
        assert_ne!(d, wots::message_digest(&v2, tree, leaf, &action));
        assert_ne!(d, wots::message_digest(&vault, (tree + 1 + r.below(4) as u8) % 5, leaf, &action));
        assert_ne!(d, wots::message_digest(&vault, tree, leaf ^ (1 + r.below(255) as u16), &action));
        let mut a2 = action.clone();
        let k = r.below(a2.len() as u64) as usize;
        a2[k] ^= 1 << r.below(8);
        assert_ne!(d, wots::message_digest(&vault, tree, leaf, &a2));
        // Appending bytes changes it too (no framing ambiguity: the action is the last field).
        let mut a3 = action.clone();
        a3.push(0);
        assert_ne!(d, wots::message_digest(&vault, tree, leaf, &a3));
        assert_ne!(wots::action_hash(&action), wots::config_hash(&action));
    }
}

// ---------- state.rs rules ----------

fn tree(root: [u8; 32], height: u8) -> Tree {
    Tree { root, height }
}

fn config(r: &mut Rng) -> Config {
    let used = |r: &mut Rng| if r.below(2) == 0 { tree(r.bytes32(), 8) } else { Tree::default() };
    let wl_len = r.below(5) as usize;
    let mut whitelist = [Pubkey::default(); 4];
    for k in whitelist.iter_mut().take(wl_len) {
        *k = r.key();
    }
    Config {
        trees: [tree(r.bytes32(), 8), used(r), used(r), used(r)],
        threshold: 1,
        recovery_delay: 60,
        whitelist,
        slow_delay: [0, 60][r.below(2) as usize],
        instant_limit: [0, 1_000][r.below(2) as usize],
        heirs: [Heir::default(); 4],
        testament_delay: 0,
        duress: tree(r.bytes32(), 8),
        duress_limit: r.below(1 << 40),
        duress_lock: DAY,
    }
}

#[test]
fn r06_restricted_matches_the_spec_definition() {
    let mut r = Rng::new();
    for _ in 0..runs(5_000) {
        let c = config(&mut r);
        let listed: Vec<Pubkey> = c.whitelist.iter().filter(|k| **k != Pubkey::default()).copied().collect();
        let dest = if !listed.is_empty() && r.below(2) == 0 { listed[r.below(listed.len() as u64) as usize] } else { r.key() };
        // Spec §3: restricted iff (whitelist set and dest not on it) or (no whitelist and instant_limit > 0).
        let want = if listed.is_empty() { c.instant_limit > 0 } else { !listed.contains(&dest) };
        assert_eq!(c.restricted(&dest), want);
        // The default key is never whitelisted, even though empty slots hold it.
        assert!(!c.whitelisted(&Pubkey::default()));
    }
}

#[test]
fn r07_tree_of_maps_slots_and_nothing_else() {
    let mut r = Rng::new();
    let c = config(&mut r);
    for i in 0..=255u8 {
        match i {
            0..=3 => assert!(tree_of(&c, i) == Some(c.trees[i as usize])),
            4 => assert!(tree_of(&c, i) == Some(c.duress)),
            _ => assert!(tree_of(&c, i).is_none()),
        }
    }
}

#[test]
fn r08_leaf_bitmap_has_no_aliasing() {
    let mut r = Rng::new();
    for _ in 0..runs(300) {
        let mut st = VaultState {
            vault: Pubkey::default(),
            vault_bump: 0,
            config_hash: [0; 32],
            config: config(&mut r),
            used: [[0; 32]; TREE_COUNT],
            last_active: 0,
            created_at: 0,
            actions: 0,
            pending: None,
            window_start: 0,
            window_spent: 0,
            migrate_to: None,
            lockdown_until: 0,
        };
        let mut marked = std::collections::HashSet::new();
        for _ in 0..r.below(60) {
            let (t, l) = (r.below(TREE_COUNT as u64) as u8, r.below(256) as u16);
            st.mark_used(t, l);
            marked.insert((t, l));
        }
        for t in 0..TREE_COUNT as u8 {
            for l in 0..256u16 {
                assert_eq!(st.used(t, l), marked.contains(&(t, l)), "tree {t} leaf {l}");
            }
        }
    }
}

#[test]
fn r09_only_cancels_and_ping_pass_a_lockdown() {
    let k = Pubkey::new_unique();
    let kinds = [
        Kind::Withdraw { mint: k, dest: k, amount: 1 },
        Kind::Stake { seed: 0, vote: k, amount: 1 },
        Kind::Unstake { seed: 0 },
        Kind::CollectStake { seed: 0 },
        Kind::Cancel,
        Kind::Ping,
        Kind::Schedule { id: 0, mint: k, dest: k, amount: 1, interval: 1, count: 1, start: 0 },
        Kind::CancelSchedule { id: 0 },
        Kind::Budget { id: 0, session: k, mint: k, limit: 1, period: 1, expires: 1 },
        Kind::CancelBudget { id: 0 },
        Kind::Migrate { new_vault: k },
        Kind::LetterKey { key: k },
    ];
    for kind in kinds {
        let tag = kind.try_to_vec().unwrap()[0];
        let a = Action { kind, fee: u64::MAX, fee_payee: k };
        assert_eq!(a.is_cancel(), matches!(tag, 4 | 7 | 9), "tag {tag}");
        assert_eq!(a.allowed_in_lockdown(), matches!(tag, 4 | 5 | 7 | 9), "tag {tag}");
        // Every action fits the on-chain buffers (Unlock.action, Approval.action).
        assert!(a.try_to_vec().unwrap().len() <= MAX_ACTION);
    }
}

#[test]
fn r10_letter_space_is_exactly_its_serialized_size() {
    let mut r = Rng::new();
    for _ in 0..runs(200) {
        let label_len = r.below(MAX_LETTER_LABEL as u64 + 1) as usize;
        let content_len = 1 + r.below(MAX_LETTER as u64) as usize;
        let l = Letter {
            vault: r.key(),
            id: r.next() as u32,
            unlock_round: r.next(),
            updated_at: r.next() as i64,
            filled: r.next() as u32,
            label: vec![7; label_len],
            content: vec![9; content_len],
        };
        let mut buf = Vec::new();
        l.try_serialize(&mut buf).unwrap();
        assert_eq!(buf.len(), Letter::space(label_len, content_len));
    }
}

// ---------- v4.1 fixes (docs/audit/INVARIANTS.md §9) ----------

#[test]
fn r11_roots_distinct_rejects_any_shared_used_root() {
    // G-05: a used root may fill one slot only (signers, recovery, duress); unused slots are zero.
    let mut r = Rng::new();
    let pool: Vec<[u8; 32]> = (0..3).map(|_| r.bytes32()).collect();
    for _ in 0..runs(5_000) {
        let pick = |r: &mut Rng| if r.below(3) == 0 { Tree::default() } else { tree(pool[r.below(3) as usize], 8) };
        let mut c = config(&mut r);
        c.trees = [tree(pool[r.below(3) as usize], 8), pick(&mut r), pick(&mut r), pick(&mut r)];
        c.duress = tree(pool[r.below(3) as usize], 8);
        let used: Vec<[u8; 32]> = c.trees.iter().chain(std::iter::once(&c.duress)).filter(|t| t.used()).map(|t| t.root).collect();
        let unique: std::collections::HashSet<[u8; 32]> = used.iter().copied().collect();
        assert_eq!(c.roots_distinct(), unique.len() == used.len());
    }
}

#[test]
fn r12_durations_are_bounded_and_far_from_overflow() {
    // G-08: every bounded duration added to any realistic clock stays far below i64::MAX.
    assert!(MAX_DURATION == 10 * 365 * DAY);
    assert!(i64::MAX - MAX_DURATION > 1i64 << 62);
    let mut r = Rng::new();
    let k = Pubkey::new_unique();
    for _ in 0..runs(2_000) {
        let mut c = config(&mut r);
        let d = [0, 1, MAX_DURATION, MAX_DURATION + 1, i64::MAX][r.below(5) as usize];
        match r.below(4) {
            0 => c.slow_delay = d,
            1 => c.recovery_delay = d,
            2 => c.testament_delay = d,
            _ => c.duress_lock = d,
        }
        assert_eq!(c.durations_bounded(), d <= MAX_DURATION);
        let s = Action { kind: Kind::Schedule { id: 0, mint: k, dest: k, amount: 1, interval: d, count: 1, start: 0 }, fee: 0, fee_payee: k };
        let b = Action { kind: Kind::Budget { id: 0, session: k, mint: k, limit: 1, period: d, expires: 1 }, fee: 0, fee_payee: k };
        assert_eq!(s.durations_bounded(), d <= MAX_DURATION);
        assert_eq!(b.durations_bounded(), d <= MAX_DURATION);
        assert!(Action { kind: Kind::Ping, fee: 0, fee_payee: k }.durations_bounded());
    }
}

#[test]
fn r13_budgets_need_some_unrestricted_destination() {
    // G-03: has_unrestricted is exactly "some destination is not restricted".
    let mut r = Rng::new();
    for _ in 0..runs(5_000) {
        let c = config(&mut r);
        let listed = c.whitelist.iter().find(|k| **k != Pubkey::default()).copied();
        let some_free = match listed {
            Some(w) => !c.restricted(&w),
            None => !c.restricted(&r.key()),
        };
        assert_eq!(c.has_unrestricted(), some_free);
    }
    // The fee cap: 0.01 SOL.
    assert_eq!(MAX_ACTION_FEE, 10_000_000);
}
