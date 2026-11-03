# Noxvault v4 — draft extensions

Status: draft, 2026-11-03. Builds on SPEC.md v3. Devnet only. v4 changes the `Config` and
`VaultState` layouts, so v3 devnet vaults are not readable by the v4 program; mainnet has no v3
vaults, so no migration is needed there.

## A. Duress mode

**Problem.** Physical coercion ("wrench attacks"). Today the whitelist and slow delay stop an
attacker from receiving funds quickly, but that can keep the victim in danger for as long as the
delay. Duress mode hands the attacker something that works *now*, while the rest locks.

**Config.**

```
duress: Tree            // 5th tree, own phrase. ALWAYS filled: a random root when unused,
                        // so no vault reveals whether it has a duress phrase
duress_limit: u64       // lamports a duress withdrawal pays out instantly
duress_lock: i64        // lockdown length after a duress withdrawal (min 24 h)
```

Clients fill all three for every vault (random root, default limit and lock when the owner does
not set one). Every v4 vault therefore looks the same.

**Tree index 4 (`DURESS_TREE`).** Signed exactly like any other tree (WOTS+ in a Merkle tree,
`used` bitmap row 4). A duress approval may only authorize `Withdraw` of SOL.

**Executing a duress withdrawal.**
- pays `min(amount, duress_limit, vault lamports − rent)` to `dest` at once, ignoring the
  whitelist, instant limit and slow delay;
- sets `lockdown_until = max(lockdown_until, now + duress_lock)`;
- updates `last_active` like any signature (nothing looks different in activity).

**Lockdown.** While `now < lockdown_until`:
- signer approvals execute only `Ping`, `Cancel`, `CancelSchedule`, `CancelBudget`;
  withdrawals, stakes, schedules, budgets and migrations are refused;
- `execute_pending`, `spend_budget*` are refused;
- running existing schedules, the testament and inbox sweeps continue;
- a recovery-tree `Cancel` also ends the lockdown (the recovery holder, not the coerced owner,
  decides when it is safe).

**Alarm.** The bot watches `lockdown_until` and alerts the recovery contacts and any chat the
owner registered. Off-chain and silent towards the attacker.

**Limits (stated in the app).**
- An attacker who reads the vault's state account can see a lockdown. The design caps the loss
  and ends the encounter; it does not make the lockdown invisible.
- The duress phrase must open a believable view: the app in duress mode shows the duress limit
  as the available balance.
- SOL only in v4; tokens stay locked.

## B. Sealed letters (timelock encryption)

**Problem.** The testament moves funds, but heirs also need information: other wallets,
instructions, passwords. Today that means trusting someone with it.

**Design.** Letters are encrypted client-side with tlock to a future drand round (quicknet).
Nobody can read them before that round, not Noxvault, not the heirs. After it, anyone with the
ciphertext can decrypt, so the letter also names who it is for and can be additionally encrypted
to an heir's key.

- `Kind::LetterKey { key }` authorizes an ed25519 letter key (like a budget session key) that may
  write the vault's `PDA(["letter", vault, id])` accounts. Content is ciphertext only; a leaked
  letter key can overwrite letters but never read them.
- **Rolling deadline.** The app re-encrypts every letter to round(now + testament_delay + margin)
  whenever the owner is active (ping or any signature), signed with the letter key. When the
  owner stops, the last ciphertext opens at about the time the testament runs.
- No on-chain drand verification is needed: decryption happens off-chain with tlock.

**Limits.** A letter opens at its round even if the owner is alive but forgot to refresh; the
app refreshes automatically and the bot reminds weekly.

## C. Project treasuries (for other tokens)

**Problem.** Token teams ask holders to trust that the treasury, team tokens and LP will not be
dumped. Locks exist (Streamflow, Jupiter Lock), but treasuries themselves are ordinary wallets.

**Design.** A Noxvault configured as a treasury is already verifiable: multi-signer threshold,
whitelist, slow delay, schedules (vesting), recovery. v4 adds the public side:
- `/t/<vault>`: a public page per treasury: rules in plain words, balances per token, schedules
  with next payout, pending withdrawals with countdown, signer count and activity.
- An SVG badge and a JSON endpoint (`/api/treasury/<vault>`) for project sites, DEX listings and
  bots ("treasury rules enforced on-chain, quantum-safe").
- A treasury creation flow with presets: *team multisig 2-of-3*, *slow treasury (72 h delay)*,
  *vesting* (schedules to team members).
- Sentinel tier for treasuries; projects hold $NOX in the vault.
