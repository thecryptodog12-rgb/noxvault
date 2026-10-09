//! WOTS+ verification, mirroring sdk/wots.ts. See docs/SPEC.md.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

pub const N: usize = 32;
pub const LEN1: usize = 32;
pub const LEN: usize = 34;
pub const STEPS: u8 = 255;
pub const ALL_CHAINS: u64 = (1u64 << LEN) - 1;

pub fn message_digest(
    vault: &Pubkey,
    mint: &Pubkey,
    dest: &Pubkey,
    next_vault: &Pubkey,
    amount: u64,
) -> [u8; N] {
    hashv(&[
        b"nox/msg/v1",
        crate::ID.as_ref(),
        vault.as_ref(),
        mint.as_ref(),
        dest.as_ref(),
        next_vault.as_ref(),
        &amount.to_le_bytes(),
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

/// Walks chain `j` from position `start` to the end (position 255).
pub fn chain_to_end(pk_seed: &[u8; N], j: u8, mut v: [u8; N], start: u8) -> [u8; N] {
    let mut k = start;
    while k < STEPS {
        v = hashv(&[pk_seed, &[j, k], &v]).to_bytes();
        k += 1;
    }
    v
}

pub fn root_from_ends(pk_seed: &[u8; N], ends: &[[u8; N]; LEN]) -> [u8; N] {
    let mut parts: [&[u8]; LEN + 2] = [&[]; LEN + 2];
    parts[0] = b"nox/root";
    parts[1] = pk_seed;
    for (i, e) in ends.iter().enumerate() {
        parts[i + 2] = e;
    }
    hashv(&parts).to_bytes()
}
