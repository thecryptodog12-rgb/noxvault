//! WOTS+ chains and the Merkle tree over them, mirroring sdk/wots.ts. See docs/SPEC.md §3.
use anchor_lang::solana_program::hash::hashv;

pub const N: usize = 32;
pub const LEN1: usize = 32;
pub const LEN: usize = 34;
pub const STEPS: u8 = 255;
pub const ALL_CHAINS: u64 = (1u64 << LEN) - 1;
pub const MAX_HEIGHT: usize = 8;

pub fn message_digest(vault: &[u8], tree: u8, leaf: u16, action: &[u8]) -> [u8; N] {
    hashv(&[
        b"nox3/msg",
        crate::ID.as_ref(),
        vault,
        &[tree],
        &leaf.to_le_bytes(),
        action,
    ])
    .to_bytes()
}

pub fn digits(digest: &[u8; N]) -> [u8; LEN] {
    let mut a = [0u8; LEN];
    a[..LEN1].copy_from_slice(digest);
    let csum: u32 = digest.iter().map(|&x| (STEPS - x) as u32).sum();
    a[LEN1] = (csum >> 8) as u8;
    a[LEN1 + 1] = (csum & 0xff) as u8;
    a
}

/// Walks chain `j` of leaf `leaf` from position `start` to the end (position 255).
pub fn chain_to_end(pk_seed: &[u8; N], leaf: u16, j: u8, mut v: [u8; N], start: u8) -> [u8; N] {
    let l = leaf.to_le_bytes();
    let mut k = start;
    while k < STEPS {
        v = hashv(&[pk_seed, &l, &[j, k], &v]).to_bytes();
        k += 1;
    }
    v
}

pub fn leaf_hash(pk_seed: &[u8; N], leaf: u16, ends: &[[u8; N]; LEN]) -> [u8; N] {
    let l = leaf.to_le_bytes();
    let mut parts: [&[u8]; LEN + 3] = [&[]; LEN + 3];
    parts[0] = b"nox2/leaf";
    parts[1] = pk_seed;
    parts[2] = &l;
    for (i, e) in ends.iter().enumerate() {
        parts[i + 3] = e;
    }
    hashv(&parts).to_bytes()
}

/// Climbs from a leaf hash to the tree root along its auth path (siblings, bottom to top).
pub fn root_from_path(pk_seed: &[u8; N], leaf: u16, leaf_hash: [u8; N], path: &[[u8; N]]) -> [u8; N] {
    let mut cur = leaf_hash;
    let mut idx = leaf as u32;
    for (i, sib) in path.iter().enumerate() {
        let h = (i + 1) as u8;
        let parent = ((idx >> 1) as u16).to_le_bytes();
        cur = if idx & 1 == 0 {
            hashv(&[b"nox2/node", pk_seed, &[h], &parent, &cur, sib]).to_bytes()
        } else {
            hashv(&[b"nox2/node", pk_seed, &[h], &parent, sib, &cur]).to_bytes()
        };
        idx >>= 1;
    }
    cur
}

pub fn config_hash(config_bytes: &[u8]) -> [u8; N] {
    hashv(&[b"nox3/config", config_bytes]).to_bytes()
}

pub fn action_hash(action_bytes: &[u8]) -> [u8; N] {
    hashv(&[b"nox3/action", action_bytes]).to_bytes()
}
