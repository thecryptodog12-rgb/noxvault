import { describe, expect, it } from "vitest";
import { roundTime, defaultChainInfo } from "tlock-js";
import {
  DAY,
  MAX_WATCH,
  SOL_MINT,
  STORAGE_MISSING,
  alertsFor,
  deadlineStep,
  formatStatus,
  handleCommand,
  looksLikePhrase,
  parseCommand,
  quicknetRoundTime,
  type CommandDeps,
  type VaultSnapshot,
  type WatchStore,
} from "./logic";

const NOW = 1_800_000_000;
const V = "CGiG5w5aiiMSNq2bJfjQ1rJuxcHGrTGDXs3wrR4FLc2V";
const DEST = "9BGzxXGPpoQnFisTDGmEmaxy1hbzmd2yXSmivsfgbLA5";

function snap(over: Partial<VaultSnapshot> = {}): VaultSnapshot {
  return { vault: V, takenAt: NOW, lamports: 2_500_000_000, pending: null, lockdownUntil: 0, recoveryAt: null, testamentAt: null, schedules: [], letters: [], ...over };
}
const keys = (prev: VaultSnapshot | null, cur: VaultSnapshot, now = NOW) => alertsFor(prev, cur, now).map((a) => a.key);

describe("quicknet rounds", () => {
  it("matches tlock-js", () => {
    for (const r of [1, 1000, 25_000_000, 40_123_456]) expect(quicknetRoundTime(r) * 1000).toBe(roundTime(defaultChainInfo, r));
  });
});

describe("alertsFor", () => {
  it("says nothing for a quiet vault", () => {
    expect(alertsFor(null, snap(), NOW)).toEqual([]);
    expect(alertsFor(snap(), snap(), NOW)).toEqual([]);
  });

  it("warns about a pending withdrawal with amount, destination, time and the recovery hint", () => {
    const cur = snap({ pending: { kind: "withdraw", mint: SOL_MINT, dest: DEST, amount: "1500000000", executableAt: NOW + 2 * DAY } });
    const [a] = alertsFor(null, cur, NOW, "https://site");
    expect(a.key).toBe(`pending:${NOW + 2 * DAY}:${DEST}:1500000000:${SOL_MINT}`);
    expect(a.text).toContain("1.5 SOL");
    expect(a.text).toContain(DEST);
    expect(a.text).toContain("in 2 days");
    expect(a.text).toContain("cancel it with your recovery key");
    expect(a.text).toContain(`https://site/t/${V}`);
  });

  it("gives a different pending withdrawal a different key", () => {
    const p = { kind: "withdraw" as const, mint: SOL_MINT, dest: DEST, amount: "1", executableAt: NOW + 100 };
    const k1 = keys(null, snap({ pending: p }));
    const k2 = keys(null, snap({ pending: { ...p, executableAt: NOW + 200 } }));
    expect(k1).not.toEqual(k2);
  });

  it("reports a migration as such", () => {
    const [a] = alertsFor(null, snap({ pending: { kind: "migrate", mint: SOL_MINT, dest: DEST, amount: "0", executableAt: NOW + 10 } }), NOW);
    expect(a.key.startsWith("migrate:")).toBe(true);
    expect(a.text).toContain("migration");
  });

  it("alerts on lockdown only while it runs, keyed by its end", () => {
    expect(keys(null, snap({ lockdownUntil: NOW + 3 * DAY }))).toEqual([`lockdown:${NOW + 3 * DAY}`]);
    expect(keys(null, snap({ lockdownUntil: NOW - 1 }))).toEqual([]);
    expect(alertsFor(null, snap({ lockdownUntil: NOW + DAY }), NOW)[0].text).toContain("duress phrase was used");
    // v4.2: a recovery "cancel and freeze" (the pending payout vanished as the lockdown began).
    const pending = { kind: "withdraw" as const, mint: SOL_MINT, dest: DEST, amount: "2000000000", executableAt: NOW + 3 * DAY };
    const frozen = alertsFor(snap({ pending, takenAt: NOW - 60 }), snap({ lockdownUntil: NOW + 14 * DAY }), NOW)[0].text;
    expect(frozen).toContain("frozen until");
    expect(frozen).toContain("new vault");
    expect(frozen).not.toContain("duress");
    // During a lockdown the clock alerts no longer tell the owner to ping.
    const clock = alertsFor(null, snap({ lockdownUntil: NOW + 14 * DAY, recoveryAt: NOW + 2 * DAY }), NOW).find((a) => a.key.startsWith("recovery:"))!.text;
    expect(clock).toContain("do not reset");
  });

  it("steps recovery and testament warnings at 14, 3 and 1 day", () => {
    expect(deadlineStep(NOW + 20 * DAY, NOW)).toBeNull();
    expect(deadlineStep(NOW + 14 * DAY, NOW)).toBe(14);
    expect(deadlineStep(NOW + 10 * DAY, NOW)).toBe(14);
    expect(deadlineStep(NOW + 2.5 * DAY, NOW)).toBe(3);
    expect(deadlineStep(NOW + 3600, NOW)).toBe(1);
    expect(deadlineStep(NOW - 1, NOW)).toBeNull();

    const at = NOW + 10 * DAY;
    const s = snap({ recoveryAt: at, testamentAt: NOW + 30 * DAY });
    expect(keys(null, s)).toEqual([`recovery:${at}:14`]);
    // same clock, two days later: same step, same key (deduped by the caller)
    expect(keys(null, s, NOW + 2 * DAY)).toEqual([`recovery:${at}:14`]);
    // crossing 3 days: a new key
    expect(keys(null, s, at - 2 * DAY)).toEqual([`recovery:${at}:3`]);
    // the owner pinged: a new deadline, a fresh set of keys
    expect(keys(null, snap({ recoveryAt: at + 30 * DAY }), at - 2 * DAY)).toEqual([]);
    expect(alertsFor(null, s, NOW)[0].text).toContain("ping to reset");
  });

  it("says when the inactivity period has passed", () => {
    const k = keys(null, snap({ testamentAt: NOW - 10 }));
    expect(k).toEqual([`testament:${NOW - 10}:open`]);
  });

  it("warns about a sealed letter opening within 7 days", () => {
    const letters = [
      { id: 0, label: "for Ana", unlockRound: "100", opensAt: NOW + 6 * DAY },
      { id: 1, label: "", unlockRound: "200", opensAt: NOW + 30 * DAY },
      { id: 2, label: "old", unlockRound: "50", opensAt: NOW - DAY },
    ];
    const a = alertsFor(null, snap({ letters }), NOW);
    expect(a.map((x) => x.key)).toEqual(["letter:0:100"]);
    expect(a[0].text).toContain('"for Ana"');
  });

  it("reports schedule payouts that ran since the last snapshot", () => {
    const s0 = { id: 3, mint: SOL_MINT, dest: DEST, amount: "100000000", remaining: 5, nextAt: NOW - 10 };
    const prev = snap({ schedules: [s0] });
    expect(keys(null, snap({ schedules: [s0] }))).toEqual([]); // no history, nothing to compare
    expect(keys(prev, snap({ schedules: [s0] }))).toEqual([]);
    const ran = alertsFor(prev, snap({ schedules: [{ ...s0, remaining: 3, nextAt: NOW + DAY }] }), NOW);
    expect(ran.map((x) => x.key)).toEqual(["schedule:3:3"]);
    expect(ran[0].text).toContain("ran 2 times");
    expect(ran[0].text).toContain("0.1 SOL");
    const gone = alertsFor(prev, snap(), NOW);
    expect(gone.map((x) => x.key)).toEqual(["schedule:3:gone:5"]);
    expect(gone[0].text).toContain("or it was cancelled");
  });
});

describe("formatStatus", () => {
  it("covers balance, pending, lockdown, clocks and letters", () => {
    const t = formatStatus(
      snap({
        pending: { kind: "withdraw", mint: SOL_MINT, dest: DEST, amount: "1000000000", executableAt: NOW + 3600 },
        lockdownUntil: NOW + DAY,
        recoveryAt: NOW + 5 * DAY,
        letters: [{ id: 1, label: "Bo", unlockRound: "9", opensAt: NOW + 9 * DAY }],
      }),
      NOW
    );
    expect(t).toContain("Balance: 2.5 SOL");
    expect(t).toContain("Pending withdrawal: 1 SOL");
    expect(t).toContain("Lockdown: ACTIVE");
    expect(t).toContain("Recovery takeover:");
    expect(t).toContain("Testament: not set");
    expect(t).toContain('"Bo": opens');
  });
});

describe("commands", () => {
  function memStore(): WatchStore & { m: Map<string, Set<string>> } {
    const m = new Map<string, Set<string>>();
    return {
      m,
      list: async (c) => [...(m.get(c) ?? [])].sort(),
      add: async (c, v) => void (m.get(c) ?? m.set(c, new Set()).get(c)!).add(v),
      remove: async (c, v) => m.get(c)?.delete(v) ?? false,
    };
  }
  function deps(over: Partial<CommandDeps> = {}): CommandDeps {
    return {
      store: memStore(),
      parseAddress: (s) => (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) ? s : null),
      snapshot: async (v) => (v === V || v.startsWith("Vxyz") ? snap({ vault: v }) : null),
      now: () => NOW,
      siteUrl: "",
      ...over,
    };
  }

  it("parses commands with a bot suffix", () => {
    expect(parseCommand("/watch@NoxBot   abc ")).toEqual({ cmd: "watch", arg: "abc" });
    expect(parseCommand("/LIST")).toEqual({ cmd: "list", arg: "" });
    expect(parseCommand("hello")).toBeNull();
  });

  it("/start explains and never asks for a phrase", async () => {
    const t = (await handleCommand("/start", "1", deps()))!;
    expect(t).toContain("/watch");
    expect(t).toContain("never need your phrase");
    expect(t.toLowerCase()).not.toMatch(/send (me )?your (phrase|seed)/);
  });

  it("watch validates, lists, caps at 5 and unwatches", async () => {
    const d = deps();
    expect(await handleCommand("/watch", "1", d)).toContain("Usage");
    expect(await handleCommand("/watch not-an-address!", "1", d)).toContain("not a Solana address");
    expect(await handleCommand(`/watch ${DEST}`, "1", d)).toBe("No Noxvault at that address.");
    expect(await handleCommand(`/watch ${V}`, "1", d)).toContain("Watching");
    expect(await handleCommand(`/watch ${V}`, "1", d)).toContain("Already watching");
    expect(await handleCommand("/list", "1", d)).toContain(V);
    expect(await handleCommand("/list", "2", d)).toContain("no vaults yet");

    const extra = Array.from({ length: MAX_WATCH }, (_, i) => `Vxyz${"x".repeat(30)}${"abcdefgh"[i]}`);
    for (const v of extra.slice(0, MAX_WATCH - 1)) expect(await handleCommand(`/watch ${v}`, "1", d)).toContain("Watching");
    expect(await handleCommand(`/watch ${extra[MAX_WATCH - 1]}`, "1", d)).toContain("maximum");

    expect(await handleCommand(`/unwatch ${V}`, "1", d)).toContain("Stopped");
    expect(await handleCommand(`/unwatch ${V}`, "1", d)).toContain("was not watching");
  });

  it("/status works without storage; watch commands explain missing storage", async () => {
    const d = deps({ store: null });
    expect(await handleCommand(`/status ${V}`, "1", d)).toContain("Balance");
    expect(await handleCommand(`/watch ${V}`, "1", d)).toBe(STORAGE_MISSING);
    expect(await handleCommand("/list", "1", d)).toBe(STORAGE_MISSING);
  });

  it("ignores plain text but warns about a pasted phrase", async () => {
    expect(await handleCommand("hi there", "1", deps())).toBeNull();
    const phrase = "abandon ability able about above absent absorb abstract absurd abuse access accident";
    expect(looksLikePhrase(phrase)).toBe(true);
    expect(await handleCommand(phrase, "1", deps())).toContain("Delete that message");
  });
});
