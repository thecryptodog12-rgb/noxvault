# Noxvault: upgrade authority plan

Goal: no single key can change the program. The upgrade authority moves to the vault of a
**Squads v4 multisig** with a **7-day time lock**, and every upgrade is announced publicly when its
proposal is created. That gives users at least 7 days to read the change and leave.

Program: `8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4` (same id on devnet and, planned, mainnet).
Squads v4 program: `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`.

> Nothing in this document has been executed. Commands that change chain state are marked
> **(writes)**. Run them on devnet first, then on mainnet. Check every CLI's `--help` before use;
> CLI flags change between versions, and the values below are placeholders (`<…>`).

## 0. Today

- The devnet upgrade authority is the deployer key (`solana program show <PROGRAM_ID>` shows it).
- `PROTOCOL_ADMIN` (`programs/noxvault/src/state.rs:22`) is also the deployer key
  `BFwro7RnsG9GR2jV3yGXGwtGkRq8MDxH9LSoTAjMQf2x`; it can only run `init_protocol`. After that,
  `protocol.admin` holds the admin and `set_protocol_admin` moves it.

## 1. Prepare the multisig

1. Members: 3 to 5 independent hardware wallets, held by different people, in different places.
   Threshold: a majority (e.g. 3 of 5). No member key is used for anything else.
2. Create the multisig with the Squads app (app.squads.so) or the Squads v4 CLI
   (`cargo install squads-multisig-cli`). **(writes)**

   ```bash
   squads-multisig-cli multisig-create \
     --rpc-url https://api.devnet.solana.com \
     --keypair ~/.config/solana/creator.json \
     --members <MEMBER_1>,<MEMBER_2>,<MEMBER_3>,<MEMBER_4>,<MEMBER_5> \
     --threshold 3
   ```

   Settings, whatever tool you use:
   - **time lock = 604800** seconds (7 days) between a proposal's approval and its execution.
   - **config authority = none** (an "autonomous" multisig): the members, threshold and time lock
     can then only change through a proposal of the multisig itself, under the same 7-day time
     lock.
   - Rent collector: optional.
3. Write down the **multisig address** and its **vault (index 0) address**. The vault is the
   PDA `["multisig", <MULTISIG>, "vault", u8(0)]` of the Squads program. It is the vault, not
   the multisig account, that becomes the upgrade authority.
4. Dry run: from the vault, send 0.001 SOL to a member through a proposal. Confirm that it cannot
   execute before the time lock ends. **(writes)**

## 2. Move the program upgrade authority

The script `scripts/transfer-upgrade-authority.ts` checks and prints this step and runs it only
with `--execute`:

```bash
# Dry run: prints the current authority, the derived vault and the exact command. Reads only.
pnpm exec tsx scripts/transfer-upgrade-authority.ts --multisig <MULTISIG> --cluster devnet
# or, with the vault address directly:
pnpm exec tsx scripts/transfer-upgrade-authority.ts <SQUADS_VAULT> --cluster devnet

# The real thing (devnet first). Needs the current authority keypair.
pnpm exec tsx scripts/transfer-upgrade-authority.ts <SQUADS_VAULT> --cluster devnet \
  --keypair ~/.config/solana/id.json --execute
```

The command it runs is: **(writes)**

```bash
solana program set-upgrade-authority 8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4 \
  --new-upgrade-authority <SQUADS_VAULT> \
  --skip-new-upgrade-authority-signer-check \
  --keypair <CURRENT_AUTHORITY_KEYPAIR> \
  --url devnet
```

`--skip-new-upgrade-authority-signer-check` is needed because a Squads vault is a PDA and cannot
co-sign. Because the check is skipped, a typo here locks the program forever. The script
refuses addresses that are on the ed25519 curve. It also refuses the multisig account itself, and
it prints the vault derived from `--multisig` so you can compare.

Verify:

```bash
solana program show 8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4 --url devnet
# "Authority: <SQUADS_VAULT>"
```

## 3. Move the protocol admin

From the multisig vault, propose a transaction calling `set_protocol_admin(<SQUADS_VAULT>)` signed
by the current admin. Do this before the upgrade-authority step, while the deployer still holds
the admin. Or, for mainnet, set `PROTOCOL_ADMIN` in `state.rs` to the Squads vault before the
first deploy, and run `init_protocol` as a Squads proposal. Once tiers and fees are final,
`freeze_protocol` makes them permanent.

## 4. Every upgrade after that

1. **Build reproducibly** from a tagged commit, so anyone can check the bytes:

   ```bash
   git tag vX.Y.Z && git push --tags
   anchor build --verifiable            # or: solana-verify build
   sha256sum target/verifiable/noxvault.so
   ```

2. **Write a buffer and hand it to the multisig** (anyone can do this; it changes nothing yet). **(writes)**

   ```bash
   solana program write-buffer target/verifiable/noxvault.so --url <CLUSTER>
   # -> Buffer: <BUFFER>
   solana program set-buffer-authority <BUFFER> --new-buffer-authority <SQUADS_VAULT> --url <CLUSTER>
   ```

3. **Propose the upgrade** in the Squads app (Developers → Programs → add the program →
   "Upgrade", buffer `<BUFFER>`, spill account = a member). This creates a vault transaction
   calling `BPFLoaderUpgradeab1e11111111111111111111111 Upgrade`. **(writes)**
4. **Announce it the same day**: X (@noxvaultHQ), the site, the GitHub release. Include:
   - the commit;
   - the `.so` hash;
   - the buffer address;
   - the proposal link;
   - what changes;
   - the earliest execution time (approval + 7 days).
5. **Members review and approve** (threshold). The 7-day time lock starts at approval.
6. **After 7 days**, any member executes. Then check:

   ```bash
   solana program show 8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4 --url <CLUSTER>   # new slot / data length
   solana-verify verify-from-repo --program-id 8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4 <REPO_URL> --commit-hash <COMMIT>
   ```

Emergency fixes go through the same time lock. Users are protected by having time to leave,
not by speed. If the team ever wants a shorter path for emergencies, that must be a separate
multisig setting, announced in advance, never a hidden key.

## 5. Later: no upgrades at all

Once the program has been audited and has run unchanged for a long time, make it immutable
(proposal from the multisig, same time lock): **(writes)**

```bash
solana program set-upgrade-authority 8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4 --final
```

## Checklist

- [ ] Multisig created: members, threshold, time lock 604800, config authority none
- [ ] Dry-run proposal waited out its time lock
- [ ] Protocol admin moved (or `PROTOCOL_ADMIN` set for mainnet)
- [ ] Upgrade authority moved; `solana program show` confirms it
- [ ] `/risks` and `/security` say who holds the authority
- [ ] Upgrade runbook (§4) tested once on devnet end to end
