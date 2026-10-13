# Noxvault — Hash-based vaults for a post-quantum Solana

Whitepaper · draft v0.1 · 10 October 2026

![Noxvault: hash-based vaults for a post-quantum Solana](/whitepaper/cover.jpg)

## Abstract

Noxvault is a Solana vault whose funds move only with hash-based one-time signatures, so a quantum computer that breaks ed25519 cannot touch them. One fixed vault address serves 256 actions through a Merkle tree of WOTS+ keys, and the vault's rules — co-signers, a recovery key, a testament, a whitelist with delays, schedules and capped session budgets — are fixed in its address forever. An Escape Hatch extends protection to ordinary wallets: when an on-chain quantum canary trips, linked wallets are evacuated into their vaults. $NOX is the protocol's access and priority token: features unlock by $NOX held inside the vault itself, and holders stand first in line at Q-Day.

- **Security that does not depend on elliptic curves.** Only SHA-256 stands between an attacker and a vault's funds; Grover's algorithm gives a square-root speedup, not a break.
- **A vault people can actually live with.** A fixed address, gasless withdrawals, staking, schedules and a Phantom budget for daily use, for SOL and every SPL or Token-2022 token.
- **Protection beyond the vault.** The Escape Hatch, the canary and a timestamped wallet registry are, to our knowledge, not offered by any other Solana project.

## The problem

Every Solana account that has ever signed a transaction has its ed25519 public key on-chain, and a large enough quantum computer running Shor's algorithm can derive the private key from it. Nobody knows when such a machine will exist; the day it does is called Q-Day. From that day, any balance guarded only by an ed25519 signature can be taken by whoever runs the machine first.

Three properties make this urgent for Solana in particular:

- **Public keys are addresses.** On Solana the address is the public key itself, so every funded wallet is exposed from its first deposit, not only after it spends.
- **Migration is a race.** When Q-Day is near, honest users and attackers will try to move the same funds at the same time; moving early, under keys that do not rely on elliptic curves, is the only reliable defence.
- **Hash functions hold.** The best known quantum attack on SHA-256, Grover's algorithm, only halves its effective security, which is why NIST standardised a hash-based signature scheme (SLH-DSA, formerly SPHINCS+) for post-quantum use.

Noxvault does not try to change Solana's signature scheme. It gives users a place on today's Solana where funds move only under hash-based signatures, plus a way out for what is still in ordinary wallets.

## Prior art

Hash-based vaults exist, but each solves one piece and leaves daily use, recovery and ordinary wallets open; Noxvault combines them.

| Project | Approach | What it leaves open |
| --- | --- | --- |
| [Solana Winternitz Vault](https://getblock.io/blog/what-is-solana-winternitz-vault-full-guide/) | WOTS one-time keys, Keccak-256 | A new address for every transaction; no recovery, rules or tokens |
| [Anchor Wallet / PQ1](https://www.prnewswire.com/news-releases/freedom-factory-launches-the-worlds-first-hardware-wallet-that-solves-the-quantum-computing-threat-302836634.html) (Ethereum) | Lamport / SPHINCS+ smart accounts | Not on Solana |
| [Quip](https://unchainedcrypto.com/new-bitcoin-wallet-offers-post-quantum-protection-without-a-fork/) (Bitcoin) | Quantum-resistant layer 2 | Not on Solana |
| [Project Eleven Yellowpages](https://blog.projecteleven.com/posts/hello-yellowpages) (Bitcoin) | Registry linking old addresses to PQ keys | A registry, not a vault; not on Solana |

What Noxvault adds: one fixed address for 256 actions, tweaked WOTS+ with full 32-byte chains, rules committed in the address, an inheritance path that needs no keys, gasless use, and protection for ordinary wallets through the Escape Hatch, canary and registry.

## Design

![256 one-time keys merge into one root that opens the vault](/whitepaper/key-tree.jpg)

A vault is a program-derived address whose seed is the hash of its rules and of the Merkle roots of its key trees, so the address itself commits to who may act and how.

1. **24-word phrase** — stays in your browser.
2. **256 one-time keys** — WOTS+ leaves of a Merkle tree.
3. **Fixed vault address** — hash of the tree roots and the rules.
4. **Sign one action** — one key, one message, ever.
5. **Verify on-chain** — chains, leaf and root, usually in 2 transactions.
6. **Approve, then execute** — when the vault's rules are met.

**One-time keys.** Each key is a WOTS+ signature over SHA-256 with w = 256: 34 chains of 255 steps, every hash call tweaked by a per-tree seed and its exact position, so attacks on many keys at once gain nothing. A message digest picks one position per chain; two checksum chains stop anyone from pushing chains further to forge another message.

**Many keys, one address.** 256 keys are the leaves of a Merkle tree; a signature carries its leaf's authentication path, and the program rebuilds the root. The address stays the same for 256 actions, then a migration moves everything to a fresh vault.

**Approve, then execute.** A signature does not fit in one Solana transaction, so it is written to a buffer, verified chain by chain, and turned into an approval that burns its key. The action executes when the vault's rules are met: one approval for a simple vault, a threshold for a multi-signer vault, the recovery tree after inactivity.

**One message per key.** Clients refuse to sign with a key that ever published part of a signature for a different message, read from the vault's full on-chain history.

## Protocol features

Every feature below is enforced by the on-chain program, works for SOL and for SPL and Token-2022 tokens, and is covered by an end-to-end test on a local validator.

| Feature | What it does | Who can trigger it |
| --- | --- | --- |
| Multi-signer approvals | Up to 3 signer trees; an action executes once `threshold` of them approve the identical action | Each signer, one one-time key each |
| Recovery key | A separate tree held by someone else; may cancel anything at any time and act fully after the owner is inactive for a set period (default 180 days) | The recovery holder |
| Testament | Up to 4 heirs with percentages; after a set inactivity (default 365 days) anyone can distribute SOL, tokens and stakes to them | Anyone, once due |
| Whitelist, instant limit, delay | Up to 4 trusted addresses pay out at once; others pay out at once up to a daily limit, above it after a delay (default 24 h) during which it can be cancelled | Owner signs; anyone executes when due |
| Schedules | Recurring payments (amount, interval, count) from one signature | Anyone, only when due |
| Session budgets | An ordinary wallet (e.g. Phantom) may spend up to a limit per period until a date, only to allowed destinations | The session wallet |
| Migration | Moves all SOL and tokens to a new vault, e.g. when the 256 keys run low | Owner signs; anyone executes |
| Invoice addresses | Per-payer deposit addresses that sweep into the vault | Anyone |
| Staking | Native stake accounts owned by the vault: delegate, deactivate, collect | Owner signs |
| Gasless relayer | A relayer pays network fees and is repaid from the vault by a signed fee; it cannot change the action | The relayer |

A vault's rules are part of its address: changing any rule means a new vault, so nobody, including the owner, can quietly weaken them.

## Escape Hatch, canary and registry

![An ordinary wallet cracks; its funds stream into the vault](/whitepaper/escape-hatch.jpg)

The Escape Hatch protects what is still in an ordinary wallet: it is armed while ed25519 is safe, and fires the moment it is not.

**Arming.** The wallet signs, once: a link to its vault (also a timestamped registry entry proving ownership), a token delegate that can only move tokens into that vault, and a durable-nonce transaction that moves all its SOL into the vault. That transaction never expires and is stored on-chain; anyone may broadcast it, and it can only ever move the wallet's SOL into the wallet's own vault.

**The canary.** A bounty sits on an ed25519 address found by hashing to the curve (`6S396A19…j7w9`), so no one knows its private key. If the bounty ever moves, ed25519 is broken in practice; anyone can then trip the canary on-chain.

![The quantum canary: a bounty no one can move unless ed25519 breaks](/whitepaper/canary.jpg)

**Evacuation.** Keepers watch the canary and every link. On a trip, or when a user presses panic, they broadcast the stored SOL escapes and move delegated tokens, in order of $NOX tier.

**Honest limits.** An attacker who breaks one wallet's key can move it directly, so this is a race the defender usually but not always wins. The canary is a public alarm, not a guarantee: whoever first breaks ed25519 might leave it alone. Funds belong in the vault; the Escape Hatch is the fire exit for what is not there yet.

## Security model

A vault is as strong as SHA-256 and the program's code; nothing in it depends on elliptic curves, but the code is not yet independently audited.

**Assumptions.** SHA-256 is preimage- and second-preimage-resistant (about 128-bit security against a quantum attacker using Grover's algorithm); the Solana runtime executes the program as written; the user keeps their 24 words secret and signs each one-time key only once.

**Protected:** funds inside a vault, against a quantum computer and against anyone holding the owner's ordinary wallet keys.

**Not protected:**

- funds left in ordinary wallets, except what the Escape Hatch moves in time;
- a stolen phrase: whoever has the 24 words controls the vault, within its rules (whitelist, delay, limits and the recovery key are the mitigation);
- browser compromise at the moment of signing;
- the program's upgrade authority, an ed25519 key, until it is burned at mainnet launch.

**One message per key, enforced from the chain.** Before any signature, the client reads the vault's full transaction history and refuses to sign if that one-time key ever published part of a signature for a different message, from any device or payer, in any failed or cancelled attempt. Signing is deterministic, so retrying the same message reveals nothing new.

**One tree, one vault.** A key tree is used in exactly one vault, because the signed message names the vault.

**Status:** devnet only. Unaudited. 25 end-to-end program tests, plus an internal review that found and fixed one critical client issue before launch.

## $NOX utility

$NOX unlocks features and priority by the amount held **inside a vault**, checked by the program on-chain: holding it means locking it behind hash-based keys, where it is itself quantum-safe.

| Tier | $NOX held in the vault | Unlocks |
| --- | --- | --- |
| Free | 0 | Vault, withdrawals, staking, whitelist and delay, recovery key, Escape Hatch, standard relayer fee |
| Guardian | Threshold G (set by protocol parameters) | Free tier, plus testament, schedules, session budgets, waived vault-creation fee |
| Sentinel | Threshold S (set by protocol parameters) | Guardian tier, plus multi-signer vaults, free relayer, keeper every minute |

Safety never depends on the tier: recovery keys, the whitelist, delays and the Escape Hatch are free for everyone. A feature that was enabled stays executable even if the vault's $NOX later drops, so heirs and co-signers are never locked out.

**Q-Day priority.** When the canary trips, keepers evacuate linked wallets in order of tier, then of $NOX held. Transactions land in the order they are sent, so the front of the queue matters most in the first blocks after a break.

**Fees.** The protocol charges a small SOL fee on vault creation and relayed actions, paid to the treasury. Guardian and Sentinel waive the creation fee; Sentinel also relays free.

**Governance.** $NOX holders set the protocol parameters: tier thresholds, fees, the default validator for vault staking and treasury spending (see Governance and treasury).

## Tokenomics

$NOX launches as a **fair launch on pump.fun** on 13 October 2026 at 18:00 UTC: no presale, no private round. The contract address is published only on www.nox-vault.com and @noxvaultHQ. The decisions that remain open are listed below with a recommendation for each.

Principles:

- **Utility before speculation.** $NOX is bought to use the protocol (tiers, priority, fee waivers, governance), not as a claim on profits.
- **Locked by use.** Tier balances sit inside vaults, so active users hold rather than trade.
- **No hidden supply.** Mint and freeze authority are revoked at launch; every allocation is a public, time-locked account.

| Decision | Options | Recommendation |
| --- | --- | --- |
| Launch method | Fair launch (bonding curve) or presale | **Decided:** fair launch on pump.fun, no presale |
| Total supply | Fixed at launch | **Decided:** 1,000,000,000 $NOX, fixed; mint and freeze authority revoked by pump.fun |
| Team and treasury allocation | None, or a vested share | If any: a small share in a public vesting account, 12-month cliff |
| Tier thresholds G and S | Absolute amounts | Set as a share of supply at launch, adjustable by governance |
| Protocol fees | SOL creation fee and relay fee | 0.01 SOL creation, relay at cost plus a margin; both to treasury |
| Treasury use | Canary bounty, audits, keeper and relayer costs, development | In that order; buybacks only after legal review |

## Governance and treasury

The vault logic becomes immutable at mainnet; only a small set of protocol parameters stays adjustable, first by the team and then by $NOX governance.

- **Immutable:** signature verification, approvals, vault rules, testament, Escape Hatch and canary logic. The program's upgrade authority is burned once the audited version is deployed.
- **Adjustable parameters:** the $NOX mint, tier thresholds G and S, the creation and relay fees, the treasury address. They live in one protocol account; until governance launches, a multisig of the team controls it, and every change is public on-chain.
- **Governance:** $NOX holders vote on parameter changes and treasury spending through a standard Solana governance program (SPL Governance / Realms), with $NOX held in vaults counting as voting power.
- **Treasury:** receives protocol fees in SOL. Its first uses are the canary bounty (a larger bounty is a louder, more credible alarm), independent audits, and the running costs of the public relayer and keeper.

## Roadmap

Noxvault is on devnet today; mainnet follows an independent audit, and governance follows mainnet.

| Phase | Status | What it contains |
| --- | --- | --- |
| Build | Done | Protocol v1 to v3, 25 program tests |
| Devnet | Now | Public testing, test $NOX tiers |
| Audit | Next | External review, bug bounty |
| Mainnet | After the audit gate: report public, findings fixed | Upgrade authority burned, $NOX tiers live |
| Governance | Then | Parameters and treasury by vote |

No dates are committed until the audit is scheduled. Each phase starts only when the previous one's exit condition is met, published on-chain or in the repository.

## Risks

The largest risk today is unaudited code; the largest long-term risk is that the threat Noxvault guards against arrives late, or differently than expected.

| Risk | What could happen | Mitigation |
| --- | --- | --- |
| Smart-contract bug | Funds locked or lost | Independent audit before mainnet, bug bounty, small limits at launch |
| Lost phrase | Vault unrecoverable | Recovery key, testament, Shamir and encrypted backups |
| Stolen phrase | Funds moved within the vault's rules | Whitelist, delays, instant limit, recovery key can cancel |
| Browser compromise | Phrase read while signing | Offline signing on an air-gapped device |
| Escape Hatch race | An attacker who breaks a wallet key moves its funds first | Keep most funds in the vault; canary priority |
| Quantum timeline | Q-Day is decades away or never comes | Noxvault is useful today as a rules-based vault; it is a precaution, not a prediction |
| Upgrade authority | An ed25519 key could change the program until burned | Burned at mainnet after audit |
| Infrastructure | Relayer, keeper or RPC unavailable | All are optional and replaceable: anyone can run them |
| Market | $NOX price falls; tiers become cheap or expensive | Thresholds adjustable by governance |
| Regulatory | Token or service treated as regulated | Legal review, MiCA white paper before any public offer in the EU |

## Legal notice and MiCA

This document describes software and a proposed token; it is not an offer to sell or a solicitation to buy $NOX, and it is not investment advice.

- **No promise of returns.** $NOX gives access to protocol features, priority and governance. It carries no right to profits, dividends or repayment, and nothing here says its price will rise.
- **MiCA.** In the European Union, offering a crypto-asset to the public or seeking its admission to trading generally requires a crypto-asset white paper notified to the competent national authority, unless an exemption applies. This document is a project whitepaper, not that regulated white paper; one will be prepared with legal counsel before any public offer in the EU.
- **Jurisdictions.** The protocol, the website and $NOX may be restricted in some jurisdictions. Users are responsible for complying with the laws that apply to them.
- **Experimental software.** Noxvault is unaudited and runs on devnet. Use only funds you can afford to lose.

The summaries of regulation above are general and not legal advice.

## Appendix: parameters, costs, addresses

| Item | Value |
| --- | --- |
| Hash | SHA-256, 32-byte chain values |
| Winternitz parameter | w = 256, 34 chains (32 message + 2 checksum) |
| Keys per vault | 256 per signer tree (height 8), 16 for the recovery tree (height 4) |
| Signature | 1,088 B + 32 B seed + 256 B authentication path |
| On-chain verification | about 180 compute units per hash, 4,000 to 5,000 hashes per signature on average |
| Transactions per action | usually 2; worst case 3 |
| Key tree build | about 3 s in Node, longer in a browser; once per vault, public part cached |
| Vault state rent | about 0.003 SOL, paid once |
| Program (devnet) | 8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4 |
| Quantum canary | 6S396A19NFHWdABtBP17tjfFCZA9LJuuvuPK7hWzj7w9, the first i = 0 with SHA256("noxvault/canary/v1" ‖ u32le(i)) on the ed25519 curve |
| Test $NOX (devnet) | tNOX 9BGzxXGPpoQnFisTDGmEmaxy1hbzmd2yXSmivsfgbLA5; Guardian 10,000, Sentinel 100,000 |
| Website | https://www.nox-vault.com |
| X | https://x.com/noxvaultHQ |

Glossary: **WOTS+** — Winternitz one-time signature with per-hash tweaks; **Merkle tree** — a hash tree whose root commits to all its leaves; **leaf** — one one-time key; **approval** — a verified signature recorded on-chain; **keeper** — anyone who runs permissionless follow-up instructions; **relayer** — anyone who pays network fees for a signed action; **Q-Day** — the day ed25519 can be broken in practice.

## Sources

- [Solana is now quantum-resistant, Solana dev claims](https://cointelegraph.com/news/solana-is-now-quantum-resistant-solana-dev-claims) (Cointelegraph)
- [What is Solana Winternitz Vault?](https://getblock.io/blog/what-is-solana-winternitz-vault-full-guide/) (GetBlock)
- [hello yellowpages](https://blog.projecteleven.com/posts/hello-yellowpages) (Project Eleven)
- [Post-quantum cryptography on Ethereum](https://ethereum.org/roadmap/security/quantum-resistance/) (ethereum.org)
- [Freedom Factory PQ1 announcement](https://www.prnewswire.com/news-releases/freedom-factory-launches-the-worlds-first-hardware-wallet-that-solves-the-quantum-computing-threat-302836634.html) (PR Newswire)
- [New Bitcoin wallet offers post-quantum protection](https://unchainedcrypto.com/new-bitcoin-wallet-offers-post-quantum-protection-without-a-fork/) (Unchained)
- Noxvault protocol specification (docs/SPEC.md v3) and program tests
