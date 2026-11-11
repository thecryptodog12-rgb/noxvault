// Property tests that need no validator: WOTS+ and the rules model (tests/model.ts).
// IDs (P-xx) refer to docs/audit/INVARIANTS.md. Runs in `anchor test` and alone with
// `pnpm test:props` (a few seconds). Seed a failing run with FC_SEED=<seed>.
import fc from "fast-check";
import { expect } from "chai";
import { sha256 } from "@noble/hashes/sha256";
import * as wots from "../sdk/wots";
import * as M from "./model";
import { canExecute, type VaultStateView } from "../sdk/client";

const seed = process.env.FC_SEED ? Number(process.env.FC_SEED) : undefined;
const runs = (n: number) => ({ numRuns: n, ...(seed !== undefined ? { seed } : {}) });

const bytes32 = fc.uint8Array({ minLength: 32, maxLength: 32 });
const enc = new TextEncoder();
const DAY = 86_400n;

/** Small trees keep each run fast; the maths is the same at height 8. */
function smallTree(master: Uint8Array, height: number) {
  const seeds = wots.treeSeeds(master, 0);
  return { seeds, pub: wots.buildTree(seeds, height) };
}

describe("properties (pure SDK)", () => {
  // One tree for the WOTS+ properties; built once (4 leaves).
  const T = smallTree(sha256(enc.encode("noxvault/property-tests")), 2);

  describe("WOTS+ (P-01..P-06)", () => {
    it("P-01 sign then verify rebuilds the root, for any digest and leaf", () => {
      fc.assert(
        fc.property(bytes32, fc.integer({ min: 0, max: 3 }), (d, leaf) => {
          const sig = wots.sign(T.seeds, leaf, d);
          const root = wots.recoverRoot(T.seeds.pkSeed, leaf, d, sig, wots.authPath(T.pub, leaf));
          return wots.equal(root, T.pub.root);
        }),
        runs(40)
      );
    });

    it("P-02 the checksum: raising any message digits always lowers a checksum digit", () => {
      // An attacker holding sig(d) can hash any chain forward, i.e. sign any d' with d'[i] >= d[i].
      // The two checksum digits must then go *down* somewhere, which needs a pre-image.
      fc.assert(
        fc.property(bytes32, fc.array(fc.nat({ max: 255 }), { minLength: 32, maxLength: 32 }), (d, bump) => {
          const d2 = d.map((x, i) => Math.min(255, x + bump[i]));
          fc.pre(!wots.equal(d, d2));
          const a = wots.digits(d);
          const b = wots.digits(d2);
          const csumA = a[32] * 256 + a[33];
          const csumB = b[32] * 256 + b[33];
          return csumB < csumA && (b[32] < a[32] || (b[32] === a[32] && b[33] < a[33]));
        }),
        runs(500)
      );
    });

    it("P-02b forging by hashing chains forward never verifies", () => {
      fc.assert(
        fc.property(bytes32, fc.integer({ min: 0, max: 31 }), fc.integer({ min: 1, max: 40 }), fc.integer({ min: 0, max: 3 }), (d, pos, step, leaf) => {
          fc.pre(d[pos] + step <= 255);
          const sig = wots.sign(T.seeds, leaf, d);
          const d2 = d.slice();
          d2[pos] += step;
          // Move every chain that d2 needs further along; the checksum chains cannot go back.
          const dig = wots.digits(d);
          const dig2 = wots.digits(d2);
          const forged = sig.map((s, j) => (dig2[j] >= dig[j] ? wots.chain(T.seeds.pkSeed, leaf, j, s, dig[j], dig2[j] - dig[j]) : s));
          const root = wots.recoverRoot(T.seeds.pkSeed, leaf, d2, forged, wots.authPath(T.pub, leaf));
          return !wots.equal(root, T.pub.root);
        }),
        runs(25)
      );
    });

    it("P-03 a leaf's signature verifies only its own message (one leaf, one message)", () => {
      fc.assert(
        fc.property(bytes32, bytes32, fc.integer({ min: 0, max: 3 }), (d1, d2, leaf) => {
          fc.pre(!wots.equal(d1, d2));
          const sig = wots.sign(T.seeds, leaf, d1);
          return !wots.equal(wots.recoverRoot(T.seeds.pkSeed, leaf, d2, sig, wots.authPath(T.pub, leaf)), T.pub.root);
        }),
        runs(25)
      );
    });

    it("P-04 a signature is bound to its leaf index and auth path", () => {
      fc.assert(
        fc.property(bytes32, fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 3 }), (d, leaf, other) => {
          fc.pre(leaf !== other);
          const sig = wots.sign(T.seeds, leaf, d);
          const asOther = wots.recoverRoot(T.seeds.pkSeed, other, d, sig, wots.authPath(T.pub, other));
          const wrongPath = wots.recoverRoot(T.seeds.pkSeed, leaf, d, sig, wots.authPath(T.pub, other));
          return !wots.equal(asOther, T.pub.root) && !wots.equal(wrongPath, T.pub.root);
        }),
        runs(20)
      );
    });

    it("P-05 digits are 32 message bytes + a big-endian checksum that never overflows two digits", () => {
      fc.assert(
        fc.property(bytes32, (d) => {
          const a = wots.digits(d);
          const csum = d.reduce((s, x) => s + (255 - x), 0);
          return a.length === 34 && a.slice(0, 32).every((x, i) => x === d[i]) && a[32] * 256 + a[33] === csum && csum <= 32 * 255;
        }),
        runs(300)
      );
    });

    it("P-06 seed ranges for signer, recovery and duress trees never collide", () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 0x3fff_ffff }), fc.integer({ min: 0, max: 0x3fff_ffff }), (v1, v2) => {
          const idx = [0, 1, 2].map((t) => wots.seedIndex(v1, t as 0 | 1 | 2));
          const idx2 = [0, 1, 2].map((t) => wots.seedIndex(v2, t as 0 | 1 | 2));
          // Different roles of any two vault numbers give different seed indices.
          for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (a !== b && idx[a] === idx2[b]) return false;
          return new Set(idx).size === 3;
        }),
        runs(300)
      );
    });
  });

  describe("domain separation (P-07..P-09)", () => {
    const pid = fc.uint8Array({ minLength: 32, maxLength: 32 });
    const action = fc.uint8Array({ minLength: 1, maxLength: 160 });
    const tuple = fc.record({ pid, vault: bytes32, tree: fc.integer({ min: 0, max: 4 }), leaf: fc.integer({ min: 0, max: 255 }), action });
    const digest = (t: { pid: Uint8Array; vault: Uint8Array; tree: number; leaf: number; action: Uint8Array }) =>
      wots.messageDigest(t.pid, t.vault, t.tree, t.leaf, t.action);

    it("P-07 the message digest changes when any of programId, vault, tree, leaf or action changes", () => {
      fc.assert(
        fc.property(tuple, tuple, fc.constantFrom("pid", "vault", "tree", "leaf", "action"), (a, b, field) => {
          const c = { ...a, [field]: (b as never)[field] };
          const same = field === "tree" || field === "leaf" ? a[field] === c[field] : wots.equal(a[field] as Uint8Array, c[field] as Uint8Array);
          fc.pre(!same);
          return !wots.equal(digest(a), digest(c));
        }),
        runs(400)
      );
    });

    it("P-08 the digest encoding is injective: fixed-width fields first, the variable action last", () => {
      // Two different tuples never serialize to the same pre-image (so no collision by framing).
      const preimage = (t: { pid: Uint8Array; vault: Uint8Array; tree: number; leaf: number; action: Uint8Array }) =>
        wots.concat(enc.encode("nox3/msg"), t.pid, t.vault, wots.u8(t.tree), wots.u16le(t.leaf), t.action);
      fc.assert(
        fc.property(tuple, tuple, (a, b) => {
          const same = wots.equal(a.pid, b.pid) && wots.equal(a.vault, b.vault) && a.tree === b.tree && a.leaf === b.leaf && wots.equal(a.action, b.action);
          return same === wots.equal(preimage(a), preimage(b));
        }),
        runs(400)
      );
    });

    it("P-09 every hash in the scheme has its own domain (tag or input length)", () => {
      // F has no tag: its input is 68 bytes; every tagged pre-image starts with "nox".
      const fLen = 32 + 2 + 2 + 32;
      const tagged = ["nox2/leaf", "nox2/node", "nox3/msg", "nox3/config", "nox3/action", "nox2/sk", "nox2/pk", "nox2/chain"];
      expect(new Set(tagged).size).to.eq(tagged.length);
      // No tag is a prefix of another tag, so tagged pre-images of different kinds never coincide.
      for (const a of tagged) for (const b of tagged) if (a !== b) expect(b.startsWith(a)).to.eq(false, `${a} prefixes ${b}`);
      const leafLen = 9 + 32 + 2 + 34 * 32;
      const nodeLen = 9 + 32 + 1 + 2 + 64;
      expect(new Set([fLen, leafLen, nodeLen]).size).to.eq(3);
      // An action hash is never a config hash of the same bytes.
      fc.assert(
        fc.property(fc.uint8Array({ maxLength: 200 }), (b) => !wots.equal(sha256(wots.concat(enc.encode("nox3/action"), b)), sha256(wots.concat(enc.encode("nox3/config"), b)))),
        runs(100)
      );
    });

    it("P-09b action encoding is injective across kinds and fields", () => {
      const key = bytes32;
      const u64 = fc.bigInt({ min: 0n, max: (1n << 64n) - 1n });
      const i64 = fc.bigInt({ min: -(1n << 63n), max: (1n << 63n) - 1n });
      const fee = { fee: u64, feePayee: key };
      const act = fc.oneof(
        fc.record({ kind: fc.constant("withdraw" as const), mint: key, dest: key, amount: u64, ...fee }),
        fc.record({ kind: fc.constant("stake" as const), seed: fc.nat(255), vote: key, amount: u64, ...fee }),
        fc.record({ kind: fc.constantFrom("unstake" as const, "collectStake" as const), seed: fc.nat(255), ...fee }),
        fc.record({ kind: fc.constantFrom("cancel" as const, "ping" as const), ...fee }),
        fc.record({ kind: fc.constant("schedule" as const), id: fc.nat(255), mint: key, dest: key, amount: u64, interval: i64, count: fc.nat(65535), start: i64, ...fee }),
        fc.record({ kind: fc.constantFrom("cancelSchedule" as const, "cancelBudget" as const), id: fc.nat(255), ...fee }),
        fc.record({ kind: fc.constant("budget" as const), id: fc.nat(255), session: key, mint: key, limit: u64, period: i64, expires: i64, ...fee }),
        fc.record({ kind: fc.constant("migrate" as const), newVault: key, ...fee }),
        fc.record({ kind: fc.constant("letterKey" as const), key, ...fee }),
        fc.record({ kind: fc.constant("cancelLock" as const), secs: i64, ...fee })
      ) as fc.Arbitrary<wots.Action>;
      const canon = (a: wots.Action) => JSON.stringify(a, (_, v) => (typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? Array.from(v) : v));
      fc.assert(
        fc.property(act, act, (a, b) => {
          const ea = wots.encodeAction(a);
          // Every action fits the on-chain buffer (MAX_ACTION = 160).
          if (ea.length > 160) return false;
          return (canon(a) === canon(b)) === wots.equal(ea, wots.encodeAction(b));
        }),
        runs(500)
      );
    });
  });

  describe("rules model (P-10..P-19)", () => {
    const K = (i: number) => `key${i}`;
    const DEST = fc.integer({ min: 0, max: 5 }).map(K);
    const lamports = fc.bigInt({ min: 1n, max: 5_000_000_000n });
    const cfgArb = fc.record({
      whitelist: fc.subarray([K(0), K(1), K(2)], { maxLength: 3 }),
      slowDelay: fc.constantFrom(0n, 60n, 3600n),
      instantLimit: fc.constantFrom(0n, 100_000_000n, 1_000_000_000n),
      threshold: fc.integer({ min: 1, max: 3 }),
      recoveryDelay: fc.constantFrom(60n, 86_400n),
      duressLimit: fc.bigInt({ min: 0n, max: 2_000_000_000n }),
      duressLock: fc.bigInt({ min: 86_400n, max: 30n * 86_400n }),
    }) as fc.Arbitrary<M.RuleConfig>;
    const fresh = (now = 1_000_000n): M.RuleState => ({ windowStart: now, windowSpent: 0n, pending: null, lockdownUntil: 0n, lastActive: now });
    const step = fc.record({ dt: fc.bigInt({ min: 0n, max: 2n * 86_400n }), dest: DEST, amount: lamports, sol: fc.boolean() });

    /** Runs a sequence through gate; returns what was paid at once, per step. */
    function runGate(c: M.RuleConfig, steps: { dt: bigint; dest: string; amount: bigint; sol: boolean }[]) {
      const st = fresh();
      let now = st.windowStart;
      const out: { now: bigint; paid: bigint; restricted: boolean; sol: boolean; result: string }[] = [];
      for (const s of steps) {
        now += s.dt;
        const mint = s.sol ? M.SOL_MINT : "mint";
        const r = M.restricted(c, s.dest);
        try {
          const pay = M.gate(st, c, 0, mint, s.dest, s.amount, false, now);
          out.push({ now, paid: pay ? s.amount : 0n, restricted: r, sol: s.sol, result: pay ? "paid" : "queued" });
        } catch (e) {
          out.push({ now, paid: 0n, restricted: r, sol: s.sol, result: (e as M.RuleError).code });
        }
      }
      return { st, out };
    }

    it("P-10 unrestricted destinations (whitelisted, or no rules) always pay at once", () => {
      fc.assert(
        fc.property(cfgArb, fc.array(step, { maxLength: 12 }), (c, steps) => runGate(c, steps).out.every((o) => o.restricted || o.result === "paid")),
        runs(300)
      );
    });

    it("P-11 restricted SOL paid at once stays within instant_limit per window, and 2x within any sliding 24 h", () => {
      fc.assert(
        fc.property(cfgArb, fc.array(step, { maxLength: 15 }), (c, steps) => {
          const { out } = runGate(c, steps);
          const instant = out.filter((o) => o.restricted && o.result === "paid");
          if (instant.some((o) => !o.sol)) return false; // restricted tokens never pay at once
          // Sliding 24 h: the window is fixed (reset at window_start + DAY), so up to 2x the limit
          // can leave within 24 h around a reset (docs/audit/INVARIANTS.md, G-07).
          for (const a of instant) {
            const inDay = instant.filter((b) => b.now >= a.now && b.now < a.now + M.DAY).reduce((s, b) => s + b.paid, 0n);
            if (inDay > 2n * c.instantLimit) return false;
          }
          return true;
        }),
        runs(400)
      );
    });

    it("P-11b the fixed window can pay 2x instant_limit within 24 h (known limitation G-07, SPEC §3: kept by design)", () => {
      const c: M.RuleConfig = { whitelist: [], slowDelay: 60n, instantLimit: 100n, threshold: 1, recoveryDelay: 60n, duressLimit: 0n, duressLock: DAY };
      const { out } = runGate(c, [
        { dt: M.DAY - 1n, dest: K(5), amount: 100n, sol: true },
        { dt: 2n, dest: K(5), amount: 100n, sol: true },
      ]);
      expect(out.map((o) => o.result)).to.deep.eq(["paid", "paid"]);
    });

    it("P-12 at most one pending withdrawal; slow_delay = 0 refuses instead of queueing", () => {
      fc.assert(
        fc.property(cfgArb, fc.array(step, { maxLength: 12 }), (c, steps) => {
          const { out } = runGate(c, steps);
          const queued = out.filter((o) => o.result === "queued").length;
          if (queued > 1) return false;
          if (c.slowDelay === 0n && queued > 0) return false;
          return out.every((o) => ["paid", "queued", "NotWhitelisted", "PendingExists"].includes(o.result));
        }),
        runs(300)
      );
    });

    it("P-13 a queued withdrawal is due exactly slow_delay later", () => {
      fc.assert(
        fc.property(cfgArb, step, (c, s) => {
          const st = fresh();
          const now = st.windowStart + s.dt;
          try {
            const pay = M.gate(st, c, 0, s.sol ? M.SOL_MINT : "mint", s.dest, s.amount, false, now);
            return pay ? st.pending === null : st.pending!.executableAt === now + c.slowDelay && c.slowDelay > 0n;
          } catch {
            return st.pending === null || c.slowDelay > 0n;
          }
        }),
        runs(300)
      );
    });

    it("P-14 a duress withdrawal never pays out more than duress_limit (fee included), nor below rent", () => {
      fc.assert(
        fc.property(cfgArb, lamports, lamports, fc.bigInt({ min: 0n, max: 3_000_000_000n }), fc.bigInt({ min: 0n, max: 3n * 86_400n }), (c, vault, amount, fee, lockLeft) => {
          const st = fresh();
          const now = 2_000_000n;
          st.lockdownUntil = lockLeft > 0n ? now + lockLeft : 0n;
          const before = st.lockdownUntil;
          const rent = 890_880n;
          const r = M.duressPayout(st, c, vault, rent, amount, fee, now);
          const out = r.fee + r.paid;
          if (out > c.duressLimit) return false;
          if (r.paid > amount || r.fee > fee) return false;
          if (vault > rent && r.vaultAfter < rent) return false; // never dips into the rent minimum
          if (before > now && out !== 0n) return false; // nothing more during a running lockdown
          return st.lockdownUntil >= before && st.lockdownUntil >= now + c.duressLock;
        }),
        runs(500)
      );
    });

    it("P-15 repeated duress withdrawals pay at most duress_limit per lockdown", () => {
      fc.assert(
        fc.property(cfgArb, fc.array(fc.record({ dt: fc.bigInt({ min: 0n, max: 4n * 86_400n }), amount: lamports, fee: fc.bigInt({ min: 0n, max: 1_000_000_000n }) }), { minLength: 1, maxLength: 10 }), (c, steps) => {
          const st = fresh();
          let now = 2_000_000n;
          let vault = 50_000_000_000n;
          // Payments group by lockdown: a new one starts only after the previous ended.
          let periodOut = 0n;
          for (const s of steps) {
            now += s.dt;
            if (now >= st.lockdownUntil) periodOut = 0n;
            const r = M.duressPayout(st, c, vault, 890_880n, s.amount, s.fee, now);
            vault = r.vaultAfter;
            periodOut += r.fee + r.paid;
            if (periodOut > c.duressLimit) return false;
          }
          return true;
        }),
        runs(300)
      );
    });

    it("P-16 the duress tree never counts toward the threshold and alone only withdraws SOL", () => {
      const kinds: M.KindName[] = ["withdraw", "stake", "unstake", "collectStake", "cancel", "ping", "schedule", "cancelSchedule", "budget", "cancelBudget", "migrate", "letterKey", "cancelLock"];
      fc.assert(
        fc.property(cfgArb, fc.integer({ min: 0, max: 31 }), fc.constantFrom(...kinds), fc.boolean(), fc.boolean(), (c, trees, kind, sol, locked) => {
          const st = fresh();
          const now = st.lastActive + 10n; // owner active: recovery may only cancel
          if (locked) st.lockdownUntil = now + 100n;
          const res = (t: number) => {
            try {
              return M.authorize(t, c, st, kind, sol, now);
            } catch (e) {
              return (e as M.RuleError).code;
            }
          };
          const withDuress = res(trees | (1 << M.DURESS_TREE));
          const without = res(trees & ~(1 << M.DURESS_TREE));
          if (trees & ~(1 << M.DURESS_TREE)) {
            // Adding the duress bit to any other approval set changes nothing.
            if (withDuress !== without) return false;
          } else {
            // Duress alone: a SOL withdrawal or nothing.
            if (withDuress === "Duress" && !(kind === "withdraw" && sol)) return false;
            if (withDuress !== "Duress" && kind === "withdraw" && sol) return false;
          }
          return true;
        }),
        runs(500)
      );
    });

    it("P-17 during a lockdown signer approvals execute only Ping and cancels", () => {
      fc.assert(
        fc.property(cfgArb, fc.constantFrom<M.KindName>("withdraw", "stake", "schedule", "budget", "migrate", "letterKey", "ping", "cancel", "cancelSchedule", "cancelBudget"), (c, kind) => {
          const st = fresh();
          st.lockdownUntil = st.lastActive + 1000n;
          try {
            M.authorize(0b111, c, st, kind, true, st.lastActive + 1n);
            return ["ping", "cancel", "cancelSchedule", "cancelBudget"].includes(kind);
          } catch (e) {
            return (e as M.RuleError).code === "Lockdown";
          }
        }),
        runs(200)
      );
    });

    it("P-18 the testament split pays out exactly the total, each heir its share or more", () => {
      const bpsArb = fc
        .array(fc.integer({ min: 1, max: 10_000 }), { minLength: 1, maxLength: 4 })
        .map((xs) => {
          // Scale to sum exactly 10 000, as init_vault requires (lib.rs:43-45).
          const s = xs.reduce((a, b) => a + b, 0);
          const out = xs.map((x) => Math.floor((x * 10_000) / s));
          out[out.length - 1] += 10_000 - out.reduce((a, b) => a + b, 0);
          return out;
        });
      fc.assert(
        fc.property(fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }), bpsArb, (total, bps) => {
          const shares = M.split(total, bps);
          if (shares.reduce((a, b) => a + b, 0n) !== total) return false;
          return shares.every((s, i) => s >= (total * BigInt(bps[i])) / 10_000n && s >= 0n);
        }),
        runs(500)
      );
    });

    it("P-19 a session budget never spends more than its limit per period, and nothing after expiry", () => {
      fc.assert(
        fc.property(
          cfgArb,
          fc.bigInt({ min: 1n, max: 1_000_000_000n }),
          fc.bigInt({ min: 1n, max: 86_400n }),
          fc.array(fc.record({ dt: fc.bigInt({ min: 0n, max: 50_000n }), amount: lamports, dest: DEST }), { maxLength: 15 }),
          (c, limit, period, steps) => {
            let now = 1_000_000n;
            const b: M.BudgetState = { limit, period, expires: now + 5n * 86_400n, windowStart: now, spent: 0n };
            const spends: { now: bigint; amount: bigint; dest: string; window: bigint }[] = [];
            for (const s of steps) {
              now += s.dt;
              try {
                M.budgetSpend(b, c, s.dest, s.amount, now);
                spends.push({ now, amount: s.amount, dest: s.dest, window: b.windowStart });
              } catch {
                /* refused */
              }
            }
            if (spends.some((s) => s.now >= 1_000_000n + 5n * 86_400n)) return false;
            // v4.1 (G-03): only non-restricted destinations, instant limit included.
            if (spends.some((s) => M.restricted(c, s.dest))) return false;
            // Per window (fixed, like the instant limit): at most `limit`.
            const perWindow = new Map<bigint, bigint>();
            for (const s of spends) perWindow.set(s.window, (perWindow.get(s.window) ?? 0n) + s.amount);
            return [...perWindow.values()].every((v) => v <= limit);
          }
        ),
        runs(300)
      );
    });

    it("P-19b G-03 fixed: with no whitelist and an instant limit, a budget pays nobody (and cannot be created)", () => {
      // Spec §4: a budget spends "only to non-restricted destinations". With an empty whitelist and
      // instant_limit > 0 every destination is restricted (§3): budget_spend refuses each one, and
      // execute_create_budget refuses the budget (Config::has_unrestricted).
      const c: M.RuleConfig = { whitelist: [], slowDelay: 3600n, instantLimit: 100n, threshold: 1, recoveryDelay: 60n, duressLimit: 0n, duressLock: DAY };
      expect(M.restricted(c, K(5))).to.eq(true);
      expect(M.hasUnrestricted(c)).to.eq(false);
      const b: M.BudgetState = { limit: 10_000n, period: 60n, expires: 2_000_000n, windowStart: 1_000_000n, spent: 0n };
      expect(() => M.budgetSpend(b, c, K(5), 50n, 1_000_001n)).to.throw("BudgetDestRestricted");
      expect(b.spent).to.eq(0n);
      // Whitelisted destinations still spend; others are refused even within the limit.
      const w: M.RuleConfig = { ...c, whitelist: [K(1)] };
      M.budgetSpend(b, w, K(1), 10_000n, 1_000_001n);
      expect(b.spent).to.eq(10_000n);
      expect(() => M.budgetSpend(b, w, K(2), 1n, 1_000_100n)).to.throw("BudgetDestRestricted");
    });

    it("P-26 G-01 fixed: no fee above MAX_ACTION_FEE executes, and signer-only approvals pay no fee during a lockdown", () => {
      const kinds: M.KindName[] = ["withdraw", "stake", "unstake", "collectStake", "cancel", "ping", "schedule", "cancelSchedule", "budget", "cancelBudget", "migrate", "letterKey"];
      fc.assert(
        fc.property(
          cfgArb,
          fc.integer({ min: 0, max: 31 }),
          fc.constantFrom(...kinds),
          fc.boolean(),
          fc.bigInt({ min: 0n, max: 3n * M.MAX_ACTION_FEE }),
          (c, trees, kind, locked, fee) => {
            const st = fresh();
            const now = st.lastActive + 10n;
            if (locked) st.lockdownUntil = now + 100n;
            let mode: string;
            try {
              mode = M.authorize(trees, c, st, kind, true, now, fee);
            } catch (e) {
              mode = (e as M.RuleError).code;
            }
            if (fee > M.MAX_ACTION_FEE) return mode === "FeeTooHigh";
            // v4.2: CancelLock always carries the recovery tree, so it may pay the capped fee.
            if (kind === "cancelLock") return mode === ((trees & (1 << M.RECOVERY_TREE)) !== 0 ? "Normal" : "CancelLockNeedsRecovery");
            let signers = 0;
            for (let t = 0; t < M.SIGNER_SLOTS; t++) if (trees & (1 << t)) signers++;
            const signerOnlyInLockdown = locked && signers >= c.threshold && !(trees & (1 << M.RECOVERY_TREE));
            const lockdownKind = ["ping", "cancel", "cancelSchedule", "cancelBudget"].includes(kind);
            if (signerOnlyInLockdown && lockdownKind) return fee === 0n ? mode === "Normal" : mode === "FeeInLockdown";
            if (signerOnlyInLockdown) return mode === "Lockdown";
            // Everywhere else the fee rule never decides: the same outcome as with fee 0.
            let mode0: string;
            try {
              mode0 = M.authorize(trees, c, st, kind, true, now, 0n);
            } catch (e) {
              mode0 = (e as M.RuleError).code;
            }
            return mode === mode0;
          }
        ),
        runs(800)
      );
    });

    it("P-15b with v4.1 fees: everything out of the vault during one lockdown (duress payouts + Ping/cancel fees) stays within duress_limit", () => {
      // A coercer holds both the duress phrase and a signer phrase; recovery stays silent.
      const op = fc.oneof(
        fc.record({ op: fc.constant("duress" as const), dt: fc.bigInt({ min: 0n, max: 86_400n }), amount: lamports, fee: fc.bigInt({ min: 0n, max: M.MAX_ACTION_FEE }) }),
        fc.record({ op: fc.constantFrom("ping" as const, "cancel" as const), dt: fc.bigInt({ min: 0n, max: 86_400n }), fee: fc.bigInt({ min: 0n, max: 2n * M.MAX_ACTION_FEE }) })
      );
      fc.assert(
        fc.property(cfgArb, fc.array(op, { minLength: 1, maxLength: 12 }), (c0, ops) => {
          const c = { ...c0, threshold: 1 };
          const st = fresh();
          let now = 2_000_000n;
          let vault = 50_000_000_000n;
          let periodOut = 0n;
          for (const o of ops) {
            now += o.dt;
            if (now >= st.lockdownUntil) periodOut = 0n;
            if (o.op === "duress") {
              try {
                M.authorize(1 << M.DURESS_TREE, c, st, "withdraw", true, now, o.fee);
              } catch {
                continue;
              }
              const r = M.duressPayout(st, c, vault, 890_880n, o.amount, o.fee, now);
              vault = r.vaultAfter;
              periodOut += r.fee + r.paid;
            } else {
              const locked = now < st.lockdownUntil;
              try {
                M.authorize(0b001, c, st, o.op, false, now, o.fee);
              } catch {
                continue;
              }
              if (!M.feeAllowed(o.fee, vault, locked, 0b001)) return false; // authorize and pay_fee agree
              vault -= o.fee;
              if (locked) periodOut += o.fee;
            }
            if (now < st.lockdownUntil && periodOut > c.duressLimit) return false;
          }
          return true;
        }),
        runs(400)
      );
    });

    it("P-27 G-02 fixed: Migrate follows the withdrawal restriction rule (instant limit included) and Cancel stops it", () => {
      fc.assert(
        fc.property(cfgArb, DEST, fc.boolean(), fc.boolean(), (c, target, unrestricted, byRecovery) => {
          const st = fresh();
          const now = st.windowStart + 5n;
          let r: string;
          try {
            r = M.migrate(st, c, target, unrestricted, now);
          } catch (e) {
            r = (e as M.RuleError).code;
          }
          const restricted = !unrestricted && M.restricted(c, target);
          if (!restricted && r !== "started") return false;
          if (restricted && c.slowDelay === 0n && r !== "NotWhitelisted") return false;
          if (restricted && c.slowDelay > 0n && (r !== "queued" || st.migrateTo || st.pending?.executableAt !== now + c.slowDelay)) return false;
          // Any Cancel (signer or recovery) clears both the queued and the started migration.
          M.cancel(st, byRecovery);
          return st.pending === null && !st.migrateTo;
        }),
        runs(400)
      );
    });

    // ---------- v4.2: recovery CancelLock (docs/audit/INVARIANTS.md A-11..A-13) ----------

    const ALL_KINDS: M.KindName[] = ["withdraw", "stake", "unstake", "collectStake", "cancel", "ping", "schedule", "cancelSchedule", "budget", "cancelBudget", "migrate", "letterKey", "cancelLock"];
    const code = (f: () => unknown) => {
      try {
        return String(f());
      } catch (e) {
        return (e as M.RuleError).code;
      }
    };

    it("P-29 a CancelLock executes only with the recovery tree, only for 1 to 90 days, and never shortens a lockdown", () => {
      fc.assert(
        fc.property(
          cfgArb,
          fc.integer({ min: 0, max: 31 }),
          fc.boolean(),
          fc.bigInt({ min: -DAY, max: 100n * DAY }),
          fc.bigInt({ min: 0n, max: 200n * DAY }),
          (c, trees, inactive, secs, lockLeft) => {
            const st = fresh();
            const now = st.lastActive + (inactive ? c.recoveryDelay : 1n);
            st.lockdownUntil = lockLeft ? now + lockLeft : 0n;
            const mode = code(() => M.authorize(trees, c, st, "cancelLock", false, now, 0n, secs));
            const recovery = (trees & (1 << M.RECOVERY_TREE)) !== 0;
            const bounded = secs >= DAY && secs <= 90n * DAY;
            if (!recovery) return mode === "CancelLockNeedsRecovery";
            if (!bounded) return mode === "LockOutOfRange";
            if (mode !== "Normal") return false;
            const before = st.lockdownUntil;
            st.pending = { kind: 0, mint: M.SOL_MINT, dest: "thief", amount: 1n, executableAt: now };
            st.migrateTo = "thief-vault";
            M.cancelLock(st, now, secs);
            return st.pending === null && !st.migrateTo && st.lockdownUntil >= before && st.lockdownUntil >= now + secs;
          }
        ),
        runs(800)
      );
    });

    it("P-30 a thief with only signer phrases moves nothing during a freeze, never keeps the vault active, and the recovery takeover opens", () => {
      // The thief holds every signer phrase; the recovery holder answers his payout with CancelLock.
      const thiefOp = fc.record({ dt: fc.bigInt({ min: 0n, max: 3_600n }), kind: fc.constantFrom(...ALL_KINDS), fee: fc.bigInt({ min: 0n, max: M.MAX_ACTION_FEE }) });
      fc.assert(
        fc.property(cfgArb, fc.bigInt({ min: DAY, max: 90n * DAY }), fc.array(thiefOp, { maxLength: 30 }), (c, secs, ops) => {
          const st = fresh();
          let now = st.lastActive + 10n;
          M.approveActivity(st, 0, now); // the thief's last action before the freeze
          st.pending = { kind: 0, mint: M.SOL_MINT, dest: "thief", amount: 5n, executableAt: now + c.slowDelay };
          M.authorize(1 << M.RECOVERY_TREE, c, st, "cancelLock", false, now, 0n, secs);
          M.cancelLock(st, now, secs);
          const frozenActive = st.lastActive;
          for (const op of ops) {
            now += op.dt;
            if (now >= st.lockdownUntil) break;
            M.approveActivity(st, 0, now);
            const mode = code(() => M.authorize(0b111, c, st, op.kind, true, now, op.fee));
            const moved = ["withdraw", "stake", "unstake", "collectStake", "schedule", "budget", "migrate", "letterKey"].includes(op.kind);
            if (mode === "Normal" && (moved || op.fee > 0n || op.kind === "cancelLock")) return false;
            if (mode === "Normal" && op.kind === "cancel") M.cancel(st, false, now);
            if (st.lastActive !== frozenActive) return false;
          }
          // Recovery-after-inactivity depends only on the frozen clock.
          const at = frozenActive + c.recoveryDelay;
          return code(() => M.authorize(1 << M.RECOVERY_TREE, c, st, "withdraw", true, at)) === "Unrestricted";
        }),
        runs(500)
      );
    });

    it("P-31 during a freeze, signers + recovery together act under the normal rules and migrate at once; a signer-only Cancel cannot stop that migration", () => {
      fc.assert(
        fc.property(cfgArb, fc.constantFrom(...ALL_KINDS), DEST, (c, kind, target) => {
          const st = fresh();
          const now = st.lastActive + 5n;
          st.lockdownUntil = now + 14n * DAY;
          const trees = 0b111 | (1 << M.RECOVERY_TREE);
          if (code(() => M.authorize(trees, c, st, kind, true, now, M.MAX_ACTION_FEE)) !== "Normal") return false;
          if (M.migrate(st, c, target, false, now, true) !== "started" || st.migrateTo !== target) return false;
          M.cancel(st, false, now); // the thief's pre-staged Cancel
          if (st.migrateTo !== target) return false;
          M.cancel(st, true, now); // the recovery holder can still stop it
          return st.migrateTo === null && st.lockdownUntil === 0n;
        }),
        runs(400)
      );
    });

    it("P-32 the SDK's canExecute agrees with the model for every tree set, kind, fee and lockdown", () => {
      const kinds = ALL_KINDS.filter((k) => k !== "withdraw");
      fc.assert(
        fc.property(
          cfgArb,
          fc.integer({ min: 0, max: 31 }),
          fc.constantFrom(...kinds),
          fc.boolean(),
          fc.boolean(),
          fc.constantFrom(0n, 1n, M.MAX_ACTION_FEE, M.MAX_ACTION_FEE + 1n),
          fc.constantFrom(0n, 3600n, DAY, 14n * DAY, 90n * DAY, 91n * DAY),
          (c, trees, kind, locked, inactive, fee, secs) => {
            const st = fresh();
            const now = st.lastActive + (inactive ? c.recoveryDelay : 1n);
            if (locked) st.lockdownUntil = now + 100n;
            const model = code(() => M.authorize(trees, c, st, kind, false, now, fee, secs));
            const view = {
              config: { threshold: c.threshold, recoveryDelay: c.recoveryDelay },
              lockdownUntil: Number(st.lockdownUntil),
              lastActive: Number(st.lastActive),
            } as unknown as VaultStateView;
            const action = { kind, secs, id: 0, seed: 0, fee, feePayee: new Uint8Array(32) } as unknown as wots.Action;
            let signers = 0;
            for (let t = 0; t < M.SIGNER_SLOTS; t++) if (trees & (1 << t)) signers++;
            // execute_letter_key also needs the signer threshold (docs/SPEC.md §12).
            const executes = ["Normal", "Unrestricted", "Duress"].includes(model) && (kind !== "letterKey" || signers >= c.threshold);
            return canExecute(view, trees, action, Number(now)) === executes;
          }
        ),
        runs(1000)
      );
    });

    it("P-28 G-05 fixed: a config is valid only if no used root appears in two slots", () => {
      const root = fc.constantFrom("00", "aa", "bb", "cc", "dd", "ee");
      fc.assert(
        fc.property(fc.array(root, { minLength: 5, maxLength: 5 }), (roots) => {
          const used = roots.filter((r) => r !== "00");
          return M.rootsDistinct(roots) === (new Set(used).size === used.length);
        }),
        runs(200)
      );
      expect(M.rootsDistinct(["aa", "aa", "00", "00", "bb"])).to.eq(false);
      expect(M.rootsDistinct(["aa", "00", "00", "bb", "aa"])).to.eq(false);
      expect(M.rootsDistinct(["aa", "00", "00", "00", "bb"])).to.eq(true);
    });

    it("P-20 the leaf bitmap marks exactly one bit: no leaf or tree aliases another", () => {
      fc.assert(
        fc.property(fc.array(fc.record({ tree: fc.integer({ min: 0, max: 4 }), leaf: fc.integer({ min: 0, max: 255 }) }), { maxLength: 40 }), (marks) => {
          const bm = M.newBitmap();
          const set = new Set<string>();
          for (const m of marks) {
            M.markUsed(bm, m.tree, m.leaf);
            set.add(`${m.tree}/${m.leaf}`);
          }
          for (let t = 0; t < 5; t++) for (let l = 0; l < 256; l++) if (M.isUsed(bm, t, l) !== set.has(`${t}/${l}`)) return false;
          return true;
        }),
        runs(200)
      );
    });
  });
});
