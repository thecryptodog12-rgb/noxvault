"use client";
// Sign one vault action (an approval) with a one-time key and send it (docs/SPEC.md §4–5, §9).
// Safety rules, per leaf: the vault's whole history decides which leaf may sign what
// (findSignedMessages + pickLeaf); an unfinished signed message is resumed, never replaced;
// preflightAction runs before signing; "attempted" is persisted before anything is sent.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  DURESS_TREE,
  RECOVERY_TREE,
  SOL_MINT,
  actionDigest,
  buildSteps,
  completesApproval,
  explainError,
  fetchState,
  inLockdown,
  findSignedMessages,
  keysLeft,
  leafUsed,
  mintTokenProgram,
  packSteps,
  pickLeaf,
  preflightAction,
  remainingSteps,
  supportsCancelLock,
  DEFAULT_CANCEL_LOCK_DAYS,
  type BudgetView,
  type ScheduleView,
  type SignedAction,
  type SignedMessage,
  type Signer,
  type TierView,
  type VaultStateView,
} from "@nox/sdk/client";
import { authPath, equal, sign, type Action, type Kind } from "@nox/sdk/wots";
import { freeEmergencyAction } from "@nox/sdk/relayer";
import { Label, Note } from "@/components/ui";
import TierHint from "./TierHint";
import { useNox } from "@/lib/hooks";
import { TIER_GUARDIAN, TIER_SENTINEL, tierNeedText, useProtocol } from "@/lib/nox";
import { errMsg, fromBaseUnits, hex, short, sol, toBaseUnits } from "@/lib/format";
import { explorerUrl } from "@/lib/config";
import {
  actionFromJson,
  actionToJson,
  clearAttempted,
  clearPending,
  describeAction,
  fetchRelayerInfo,
  isSol,
  loadPending,
  markAttempted,
  relayAction,
  savePending,
  sendIxs,
  wasAttempted,
  type PendingAction,
  type RelayerInfo,
  type VaultAssets,
} from "@/lib/unlock";

type KindName = Action["kind"];
type Mode = "wallet" | "relayer";
type StepState = "todo" | "sending" | "done" | "failed";

interface Frozen {
  leaf: number;
  action: Action;
  mode: Mode;
  source: "chain" | "local";
}

type History =
  | { kind: "loading" }
  | { kind: "error"; msg: string }
  | { kind: "ready"; signed: SignedMessage[]; leaf: number; resume?: SignedMessage }
  | { kind: "exhausted"; msg: string };

export interface StakeSlot {
  seed: number;
  address: PublicKey;
  lamports: number;
}

const KINDS: { k: KindName; label: string }[] = [
  { k: "withdraw", label: "Withdraw" },
  { k: "schedule", label: "Schedule" },
  { k: "budget", label: "Budget" },
  { k: "stake", label: "Stake" },
  { k: "unstake", label: "Unstake" },
  { k: "collectStake", label: "Collect" },
  { k: "cancelSchedule", label: "Stop schedule" },
  { k: "cancelBudget", label: "Stop budget" },
  { k: "migrate", label: "Migrate" },
  { k: "ping", label: "Ping" },
  { k: "cancel", label: "Cancel pending" },
  { k: "cancelLock", label: "Cancel + freeze" },
];

/** v4.2: the recovery phrase's cancel and freeze comes first: it is the recommended answer to a payout you did not start. */
const RECOVERY_CANCELS: KindName[] = ["cancelLock", "cancel", "cancelSchedule", "cancelBudget"];

const unitSecs = { h: 3600, d: 86400 } as const;

export default function ActionPanel({
  vault,
  state,
  signer,
  assets,
  stakes,
  schedules,
  budgets,
  preset,
  tier,
  onPresetDone,
  onChanged,
}: {
  vault: PublicKey;
  state: VaultStateView;
  signer: Signer;
  assets: VaultAssets | null;
  stakes: (StakeSlot | null)[];
  schedules: ScheduleView[];
  budgets: BudgetView[];
  /** Co-sign an existing approval: sign exactly this action. */
  preset?: Action | null;
  /** The vault's $NOX tier (schedules / budgets need Guardian; Sentinel relays free). */
  tier?: TierView | null;
  onPresetDone?: () => void;
  onChanged: () => void;
}) {
  const { connection, program, wallet } = useNox();
  const { setVisible } = useWalletModal();
  const vaultStr = vault.toBase58();
  const tree = signer.tree;
  const isRecovery = tree === RECOVERY_TREE;
  const recoveryOpen = Math.floor(Date.now() / 1000) >= state.lastActive + Number(state.config.recoveryDelay);
  const isDuress = tree === DURESS_TREE;
  // v4.1 (docs/SPEC.md §11): during a lockdown the signers' Ping and cancels carry fee 0, and the
  // relayer sends them for free.
  // v4.2: the recovery phrase's Cancel and CancelLock are relayed free as well (emergencies).
  const lockdownFree = (a: { kind: KindName }) =>
    (tree < RECOVERY_TREE && inLockdown(state) && ["ping", "cancel", "cancelSchedule", "cancelBudget"].includes(a.kind)) || freeEmergencyAction(tree, a.kind);
  const vaultLocked = inLockdown(state);
  // v4.2: the escape. During a lockdown the owner's main phrase and the recovery phrase together
  // may migrate at once: either side signs "Migrate" first, the other co-signs it (open approvals).
  const escapeKind = { k: "migrate" as KindName, label: "Escape (with main phrase)" };
  const kinds = isDuress
    ? KINDS.filter((x) => x.k === "withdraw")
    : isRecovery && !recoveryOpen
      ? [...RECOVERY_CANCELS.map((k) => KINDS.find((x) => x.k === k)!), ...(vaultLocked ? [escapeKind] : [])]
      : isRecovery
        ? [KINDS.find((x) => x.k === "cancelLock")!, ...KINDS.filter((x) => x.k !== "cancelLock")]
        : KINDS.filter((x) => x.k !== "cancelLock");

  const protocol = useProtocol();
  const needsGuardian = (k: KindName) => k === "schedule" || k === "budget";
  const locked = (k: KindName) => !!tier && tier.tiersOn && needsGuardian(k) && tier.tier < TIER_GUARDIAN;
  const [history, setHistory] = useState<History>({ kind: "loading" });
  const [frozen, setFrozen] = useState<Frozen | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lastDone, setLastDone] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // form
  const [kind, setKind] = useState<KindName>(kinds[0]?.k ?? "withdraw");
  const [mode, setMode] = useState<Mode>("wallet");
  const [asset, setAsset] = useState(SOL_MINT.toBase58());
  const [amount, setAmount] = useState("");
  const [dest, setDest] = useState("");
  const [vote, setVote] = useState("");
  const [seed, setSeed] = useState<number | null>(null);
  const [everyN, setEveryN] = useState("30");
  const [everyU, setEveryU] = useState<"h" | "d">("d");
  const [count, setCount] = useState("12");
  const [start, setStart] = useState(() => localInput(Date.now() + 10 * 60_000));
  const [session, setSession] = useState("");
  const [expiresDays, setExpiresDays] = useState("30");
  const [newVault, setNewVault] = useState("");
  const [freezeDays, setFreezeDays] = useState(String(DEFAULT_CANCEL_LOCK_DAYS));
  const [validators, setValidators] = useState<{ vote: string; stake: number }[] | null>(null);
  const [relayer, setRelayer] = useState<RelayerInfo | null>(null);
  const [relayerErr, setRelayerErr] = useState<string | null>(null);

  const [pre, setPre] = useState<{ errors: string[]; warnings: string[]; key: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);

  // sending
  const [steps, setSteps] = useState<{ label: string; st: StepState; sig?: string }[]>([]);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const sentinelFree = !!tier && tier.tier === TIER_SENTINEL && !!relayer?.sentinelFree;
  const tokens = isDuress ? [] : assets?.tokens.filter((t) => t.amount > 0n) ?? [];
  const holding = isSol(asset) ? null : tokens.find((t) => t.mint.toBase58() === asset) ?? null;
  const usedStakes = stakes.filter((s): s is StakeSlot => !!s);
  const freeSeed = stakes.findIndex((s) => !s);
  const freeId = (taken: number[]) => {
    for (let i = 0; i < 256; i++) if (!taken.includes(i)) return i;
    return -1;
  };
  const scheduleId = freeId(schedules.map((s) => s.id));
  const budgetId = freeId(budgets.map((b) => b.id));

  useEffect(() => {
    if (wallet.publicKey) {
      if (!dest) setDest(wallet.publicKey.toBase58());
      if (!session) setSession(wallet.publicKey.toBase58());
    }
  }, [wallet.publicKey, dest, session]);

  useEffect(() => {
    setPre(null);
    setConsent(false);
  }, [kind, mode, asset, amount, dest, vote, seed, everyN, everyU, count, start, session, expiresDays, newVault, preset]);

  useEffect(() => {
    if (relayer) return;
    if (mode !== "relayer" && !(frozen && frozen.action.fee > 0n) && !(preset && preset.fee > 0n)) return;
    fetchRelayerInfo()
      .then((r) => {
        setRelayer(r);
        setRelayerErr(null);
      })
      .catch((e) => setRelayerErr(errMsg(e)));
  }, [mode, relayer, frozen, preset]);

  useEffect(() => {
    if (kind !== "stake" || validators) return;
    connection
      .getVoteAccounts("confirmed")
      .then((v) => {
        const list = v.current
          .sort((a, b) => b.activatedStake - a.activatedStake)
          .slice(0, 25)
          .map((x) => ({ vote: x.votePubkey, stake: x.activatedStake }));
        setValidators(list);
        if (!vote && list[0]) setVote(list[0].vote);
      })
      .catch(() => setValidators([]));
  }, [kind, validators, connection, vote]);

  // ---- the vault's history decides which leaf signs, and whether a message is already fixed ----
  const loadHistory = useCallback(async () => {
    setHistory({ kind: "loading" });
    setNote(null);
    let signed: SignedMessage[];
    try {
      signed = await findSignedMessages(program, vault, signer);
    } catch (e) {
      setHistory({ kind: "error", msg: errMsg(e) });
      setFrozen(null);
      return;
    }
    const fresh = (await fetchState(program, vault).catch(() => null)) ?? stateRef.current;
    let pick: { leaf: number; resume?: SignedMessage };
    try {
      pick = pickLeaf(fresh, signer, signed);
    } catch (e) {
      setHistory({ kind: "exhausted", msg: errMsg(e) });
      setFrozen(null);
      return;
    }
    setHistory({ kind: "ready", signed, leaf: pick.leaf, resume: pick.resume });

    const local = loadPending(vaultStr, tree);
    if (pick.resume) {
      // Chain wins: this leaf published part of a signature for exactly this message.
      const a = pick.resume.action;
      if (local && !(local.leaf === pick.resume.leaf && local.digest === hex(pick.resume.digest)))
        setNote("This browser remembered a different action, but the chain shows a one-time key already published part of a signature for the one below. Only that one can be completed with it.");
      const m: Mode = a.fee > 0n ? "relayer" : "wallet";
      savePending({ v: 2, vault: vaultStr, tree, leaf: pick.resume.leaf, action: actionToJson(a), digest: hex(pick.resume.digest), mode: m, createdAt: local?.createdAt ?? Date.now() });
      setFrozen({ leaf: pick.resume.leaf, action: a, mode: m, source: "chain" });
      return;
    }
    if (local && !leafUsed(fresh, tree, local.leaf) && (local.leaf === pick.leaf || wasAttempted(vaultStr, tree, local.leaf))) {
      // A send for it may still be in flight: keep it locked to the same message.
      setFrozen({ leaf: local.leaf, action: actionFromJson(local.action), mode: local.mode, source: "local" });
      return;
    }
    if (local && leafUsed(fresh, tree, local.leaf)) {
      clearPending(vaultStr, tree);
      clearAttempted(vaultStr, tree, local.leaf);
    }
    setFrozen(null);
  }, [program, vault, signer, vaultStr, tree]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const leaf = history.kind === "ready" ? history.leaf : null;
  const payerFor = (m: Mode) => (m === "relayer" ? (relayer ? new PublicKey(relayer.relayer) : null) : wallet.publicKey);

  // ---- build the action from the form ----
  const parseKey = (v: string, what: string) => {
    try {
      return new PublicKey(v.trim());
    } catch {
      throw new Error(`${what} is not a valid address`);
    }
  };

  const buildKind = async (): Promise<{ kind: Kind; tokenProgram?: PublicKey }> => {
    const mint = isSol(asset) ? SOL_MINT : new PublicKey(asset);
    const decimals = holding ? holding.decimals : 9;
    switch (kind) {
      case "withdraw": {
        const units = toBaseUnits(amount, decimals);
        const tokenProgram = isSol(asset) ? undefined : await mintTokenProgram(connection, mint);
        return { kind: { kind, mint: mint.toBytes(), dest: parseKey(dest, "Destination").toBytes(), amount: units }, tokenProgram };
      }
      case "schedule": {
        if (scheduleId < 0) throw new Error("All schedule slots are in use");
        const n = Number(everyN);
        const c = Number(count);
        if (!(n > 0) || !Number.isInteger(c) || c < 1 || c > 65535) throw new Error("Interval and count must be positive");
        const startAt = Math.floor(new Date(start).getTime() / 1000);
        if (!Number.isFinite(startAt)) throw new Error("Pick a start time");
        return {
          kind: {
            kind,
            id: scheduleId,
            mint: mint.toBytes(),
            dest: parseKey(dest, "Destination").toBytes(),
            amount: toBaseUnits(amount, decimals),
            interval: BigInt(Math.round(n * unitSecs[everyU])),
            count: c,
            start: BigInt(startAt),
          },
        };
      }
      case "budget": {
        if (budgetId < 0) throw new Error("All budget slots are in use");
        const n = Number(everyN);
        const days = Number(expiresDays);
        if (!(n > 0) || !(days > 0)) throw new Error("Period and expiry must be positive");
        return {
          kind: {
            kind,
            id: budgetId,
            session: parseKey(session, "Session key").toBytes(),
            mint: mint.toBytes(),
            limit: toBaseUnits(amount, decimals),
            period: BigInt(Math.round(n * unitSecs[everyU])),
            expires: BigInt(Math.floor(Date.now() / 1000 + days * 86400)),
          },
        };
      }
      case "stake": {
        if (freeSeed < 0) throw new Error("All stake slots are in use");
        return { kind: { kind, seed: freeSeed, vote: parseKey(vote, "Validator").toBytes(), amount: toBaseUnits(amount, 9) } };
      }
      case "unstake":
      case "collectStake":
        if (seed === null) throw new Error("Pick a stake slot");
        return { kind: { kind, seed } };
      case "cancelSchedule":
      case "cancelBudget":
        if (seed === null) throw new Error(`Pick a ${kind === "cancelSchedule" ? "schedule" : "budget"}`);
        return { kind: { kind, id: seed } };
      case "migrate":
        return { kind: { kind, newVault: parseKey(newVault, "New vault").toBytes() } };
      case "cancel":
      case "ping":
        return { kind: { kind } };
      case "cancelLock": {
        const days = Number(freezeDays);
        if (!Number.isFinite(days) || days < 1 || days > 90) throw new Error("Freeze for 1 to 90 days");
        return { kind: { kind, secs: BigInt(Math.round(days * 86400)) } };
      }
      case "letterKey":
        throw new Error("Set the letter key on the Sealed letters page (/letters).");
    }
  };

  const feeFor = (m: Mode, k: KindName): { fee: bigint; feePayee: Uint8Array } => {
    if (m === "relayer") {
      if (!relayer) throw new Error(relayerErr || "Relayer info not loaded yet");
      // Sentinel vaults relay for free, and so do the signers' Ping and cancels in a lockdown
      // (the program refuses any fee there): fee 0, the relayer is still named as payee.
      return { fee: sentinelFree || lockdownFree({ kind: k }) ? 0n : BigInt(relayer.minFee), feePayee: new PublicKey(relayer.relayer).toBytes() };
    }
    if (!wallet.publicKey) throw new Error("Connect a wallet: it pays the network fees");
    return { fee: 0n, feePayee: wallet.publicKey.toBytes() };
  };

  // ---- check, then freeze the message for this leaf ----
  const prepare = async () => {
    setFormErr(null);
    if (leaf === null) return;
    setBusy("check");
    try {
      let action: Action;
      let tokenProgram: PublicKey | undefined;
      let useMode = mode;
      if (preset) {
        // Co-signing: the action (including its fee) is fixed by whoever opened the approval.
        action = preset;
        if (action.kind === "withdraw" && !isSol(action.mint)) tokenProgram = await mintTokenProgram(connection, new PublicKey(action.mint));
        useMode = relayer && equal(action.feePayee, new PublicKey(relayer.relayer).toBytes()) && (action.fee > 0n || sentinelFree || lockdownFree(action)) ? "relayer" : "wallet";
      } else {
        const b = await buildKind();
        action = { ...b.kind, ...feeFor(mode, b.kind.kind) } as Action;
        tokenProgram = b.tokenProgram;
      }
      const payer = payerFor(useMode) ?? wallet.publicKey;
      if (!payer) throw new Error(useMode === "relayer" ? "Relayer unavailable" : "Connect a wallet");
      const digest = actionDigest(program.programId, vault, tree, leaf, action);
      const preKey = `${leaf}:${hex(digest)}`;
      let res: { errors: string[]; warnings: string[] };
      try {
        // v4.2: during a lockdown a migration is the escape, signed by the main phrase and the
        // recovery phrase together: preflight it as such (it executes once both have approved).
        const together = vaultLocked && action.kind === "migrate" && tree <= RECOVERY_TREE;
        res = await preflightAction({ program, payer, vault, signer, leaf, action, tokenProgram, together });
        if (together)
          res.warnings.unshift(
            isRecovery
              ? "Escape: this only executes once the vault's main phrase approves the same migration too (open the vault with it and co-sign under open approvals). Then everything can move to the new vault at once."
              : "Escape: during the lockdown this migration only executes once the recovery phrase approves it too (open /recovery with it and co-sign under open approvals). Then everything can move to the new vault at once."
          );
        // v4.2: the program on this network may predate CancelLock (devnet before the upgrade).
        if (action.kind === "cancelLock" && !(await supportsCancelLock(program, payer, vault)))
          res.errors.push("The Noxvault program on this network does not support cancel and freeze yet (it arrives with the v4.2 upgrade). Use plain Cancel for now.");
        // Re-read the history right before freezing: nothing may have been signed meanwhile.
        const signed = await findSignedMessages(program, vault, signer);
        const fresh = await fetchState(program, vault);
        const other = signed.find((m) => fresh && !leafUsed(fresh, tree, m.leaf) && !(m.leaf === leaf && equal(m.digest, digest)));
        if (other) res.errors.push(`One-time key #${other.leaf} already signed "${describeAction(other.action)}". Finish that first.`);
      } catch (e) {
        res = { errors: [`Could not read this vault's history, so it is not safe to sign (${errMsg(e)}).`], warnings: [] };
      }
      const same = pre?.key === preKey;
      setPre({ ...res, key: preKey });
      if (!same) setConsent(false);
      if (res.errors.length) {
        if (res.errors.some((e) => /already signed/.test(e))) loadHistory();
        return;
      }
      if (res.warnings.length && !(same && consent)) return;
      const p: PendingAction = { v: 2, vault: vaultStr, tree, leaf, action: actionToJson(action), digest: hex(digest), mode: useMode, createdAt: Date.now() };
      savePending(p); // persisted BEFORE anything is signed or sent
      setFrozen({ leaf, action, mode: useMode, source: "local" });
      setSteps([]);
      setSendErr(null);
      onPresetDone?.();
    } catch (e) {
      setFormErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    if (!frozen || frozen.source !== "local" || wasAttempted(vaultStr, tree, frozen.leaf)) return;
    try {
      const signed = await findSignedMessages(program, vault, signer);
      if (signed.some((m) => m.leaf === frozen.leaf)) {
        setNote("Cannot discard: this one-time key already published part of a signature.");
        loadHistory();
        return;
      }
    } catch (e) {
      setNote(`Cannot discard: the vault's history could not be read (${errMsg(e)}).`);
      return;
    }
    if (!window.confirm("Discard this action? Nothing was sent for it, so you can choose a different one.")) return;
    clearPending(vaultStr, tree);
    setFrozen(null);
    setSteps([]);
  };

  // ---- send the frozen message ----
  const signedFor = (f: Frozen): SignedAction => {
    const digest = actionDigest(program.programId, vault, tree, f.leaf, f.action);
    return { vault, tree, leaf: f.leaf, pkSeed: signer.seeds.pkSeed, authPath: authPath(signer.pub, f.leaf), signature: sign(signer.seeds, f.leaf, digest), action: f.action };
  };

  const finish = async (f: Frozen, executed: boolean) => {
    setLastDone(
      executed
        ? `Done: ${describeAction(f.action)}. One-time key #${f.leaf} is used and can never sign again.`
        : `Approval recorded with one-time key #${f.leaf}. It executes once enough signers approve the same action (see open approvals).`
    );
    clearPending(vaultStr, tree);
    onChanged();
    setSteps([]);
    await loadHistory();
  };

  const sendWallet = async (f: Frozen) => {
    const payer = wallet.publicKey;
    if (!payer) {
      setVisible(true);
      return;
    }
    const s = signedFor(f);
    const a = f.action;
    const tokenProgram = a.kind === "withdraw" && !isSol(a.mint) ? await mintTokenProgram(connection, new PublicKey(a.mint)) : undefined;
    const status = await completesApproval(program, vault, tree, a);
    const all = await buildSteps(program, payer, s, { tokenProgram, execute: status.willExecute, creator: status.creator ?? payer });
    const todo = await remainingSteps(program, payer, s, all);
    if (!todo.length) return finish(f, status.willExecute);
    const txs = packSteps(payer, todo);
    const list = txs.map((t) => ({ label: t.label, st: "todo" as StepState, sig: undefined as string | undefined }));
    setSteps(list);
    for (let i = 0; i < txs.length; i++) {
      list[i].st = "sending";
      setSteps([...list]);
      markAttempted(vaultStr, tree, f.leaf); // before anything can reach the network
      try {
        list[i].sig = await sendIxs(connection, payer, wallet.sendTransaction, txs[i].instructions);
        list[i].st = "done";
        setSteps([...list]);
      } catch (e) {
        list[i].st = "failed";
        setSteps([...list]);
        throw e;
      }
    }
    await finish(f, status.willExecute);
  };

  const sendRelayer = async (f: Frozen) => {
    const s = signedFor(f);
    setSteps([{ label: "relayer sends open + write + verify + approve (+ execute)", st: "sending" }]);
    markAttempted(vaultStr, tree, f.leaf);
    const status = await completesApproval(program, vault, tree, f.action).catch(() => ({ willExecute: true }));
    try {
      const sigs = await relayAction(s);
      setSteps(sigs.length ? sigs.map((sig, i) => ({ label: `transaction ${i + 1}`, st: "done", sig })) : [{ label: "already done", st: "done" }]);
    } catch (e) {
      setSteps([{ label: "relayer", st: "failed" }]);
      throw e;
    }
    await finish(f, status.willExecute);
  };

  const send = async (m: Mode) => {
    if (!frozen) return;
    setRunning(true);
    setSendErr(null);
    try {
      if (m === "relayer") await sendRelayer(frozen);
      else await sendWallet(frozen);
    } catch (e) {
      setSendErr(explainError(e));
    } finally {
      setRunning(false);
    }
  };

  const relayerOk = useMemo(
    () =>
      !!frozen &&
      !!relayer &&
      equal(frozen.action.feePayee, new PublicKey(relayer.relayer).toBytes()) &&
      (frozen.action.fee >= BigInt(relayer.minFee) || sentinelFree || lockdownFree(frozen.action)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frozen, relayer, sentinelFree, state.lockdownUntil]
  );

  // ---- max for SOL: everything minus the fee leaves exactly 0 (allowed) ----
  const maxAmount = () => {
    const fee = mode === "relayer" && relayer ? BigInt(relayer.minFee) : 0n;
    if (holding) return fromBaseUnits(holding.amount, holding.decimals).replace(/,/g, "");
    let lamports = BigInt(assets?.lamports ?? 0) - fee;
    if (isDuress) {
      const cap = state.config.duressLimit - fee;
      const free = BigInt(assets?.lamports ?? 0) - 890_880n - fee;
      lamports = cap < free ? cap : free;
    }
    return lamports > 0n ? fromBaseUnits(lamports, 9).replace(/,/g, "") : "0";
  };

  // ---------- render ----------

  if (history.kind === "loading")
    return (
      <div className="text-[13px] text-mute">
        reading this vault&apos;s full history<span className="blink">…</span>
      </div>
    );
  if (history.kind === "error")
    return (
      <div className="flex flex-col items-start gap-3">
        <Note kind="bad">
          Could not read this vault&apos;s transaction history ({history.msg}). Signing is blocked: without it the app cannot prove a
          one-time key never signed something else.
        </Note>
        <button className="btn ghost sm" onClick={loadHistory}>
          try again
        </button>
      </div>
    );
  if (history.kind === "exhausted") return <Note kind="bad">{history.msg}</Note>;

  const left = keysLeft(state, tree);
  const total = 1 << signer.pub.height;

  const assetSelect = (
    <label className="flex flex-col gap-1.5">
      <Label>asset</Label>
      <select className="field" value={asset} onChange={(e) => (setAsset(e.target.value), setAmount(""))}>
        <option value={SOL_MINT.toBase58()}>
          SOL — {sol(isDuress ? Math.max(0, Math.min((assets?.lamports ?? 0) - 890_880, Number(state.config.duressLimit))) : assets?.lamports ?? 0)} in vault
        </option>
        {tokens.map((t) => (
          <option key={t.mint.toBase58()} value={t.mint.toBase58()}>
            {short(t.mint.toBase58(), 4)} — {fromBaseUnits(t.amount, t.decimals)}
          </option>
        ))}
      </select>
    </label>
  );
  const destInput = (label = "destination wallet") => (
    <label className="flex flex-col gap-1.5 sm:col-span-2">
      <Label>
        {label} {holding ? "(its token account is created if needed)" : ""}
      </Label>
      <input className="field" value={dest} onChange={(e) => setDest(e.target.value)} spellCheck={false} placeholder="wallet address" />
      {state.config.whitelist.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          <span className="text-[11px] text-dim">whitelist:</span>
          {state.config.whitelist.map((k) => {
            const a = new PublicKey(k).toBase58();
            return (
              <button key={a} type="button" className="rounded border border-line-2 px-2 py-0.5 text-[11px] text-mute hover:text-teal" onClick={() => setDest(a)}>
                {short(a, 4)}
              </button>
            );
          })}
        </div>
      )}
    </label>
  );
  const periodInput = (label: string) => (
    <label className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <input className="field flex-1" inputMode="decimal" value={everyN} onChange={(e) => setEveryN(e.target.value)} />
        <select className="field !w-24" value={everyU} onChange={(e) => setEveryU(e.target.value as "h" | "d")}>
          <option value="h">hours</option>
          <option value="d">days</option>
        </select>
      </div>
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      {note && <Note kind="warn">{note}</Note>}
      {lastDone && <Note kind="ok">{lastDone}</Note>}
      {left < (isRecovery ? 4 : 20) && (
        <Note kind="warn">
          Only {left} one-time keys left in this tree. Plan a <strong>migrate</strong> to a new vault before they run out.
        </Note>
      )}

      {frozen ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>signed approval // one-time key #{frozen.leaf}</Label>
            <span className="text-[10.5px] uppercase tracking-[0.14em] text-teal">{frozen.source === "chain" ? "from chain" : "frozen in this browser"}</span>
          </div>
          <div className="rounded-md border border-teal/40 bg-teal/[0.04] px-4 py-3 text-[13px]">{describeAction(frozen.action)}</div>
          <Note>
            A one-time key signs <strong>one</strong> message, ever. Before signing, the app reads the vault&apos;s whole history; if a
            key ever published part of a signature, only that same action can be completed with it. Re-sending it is harmless.
          </Note>
          {steps.length > 0 && (
            <ol className="flex flex-col">
              {steps.map((s, i) => (
                <li key={i} className="flex items-center gap-3 border-b border-line py-2 text-[12.5px] last:border-b-0">
                  <span
                    className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                      s.st === "done" ? "bg-teal" : s.st === "sending" ? "animate-pulse bg-warn" : s.st === "failed" ? "bg-bad" : "border border-line-2"
                    }`}
                  />
                  <span className={s.st === "failed" ? "text-bad" : s.st === "done" ? "text-mute" : ""}>{s.label}</span>
                  {s.sig && (
                    <a className="ml-auto text-[10.5px] text-dim hover:text-teal" href={explorerUrl(s.sig, "tx")} target="_blank" rel="noreferrer">
                      tx ↗
                    </a>
                  )}
                </li>
              ))}
            </ol>
          )}
          {sendErr && <Note kind="bad">{sendErr}</Note>}
          <div className="flex flex-wrap items-center gap-3">
            {(frozen.mode === "relayer" || relayerOk) && (
              <button className="btn" disabled={running || !relayerOk} onClick={() => send("relayer")}>
                {running ? "sending…" : sendErr ? "retry via relayer" : "send via relayer (gasless)"}
              </button>
            )}
            <button className={`btn ${frozen.mode === "relayer" ? "ghost" : ""}`} disabled={running} onClick={() => send("wallet")}>
              {!wallet.publicKey ? "connect wallet to send" : running ? "sending…" : sendErr ? "retry with my wallet" : "send with my wallet"}
            </button>
            {frozen.source === "local" && !wasAttempted(vaultStr, tree, frozen.leaf) && !running && (
              <button className="text-[11px] uppercase tracking-[0.14em] text-dim hover:text-bad" onClick={discard}>
                [discard — nothing sent yet]
              </button>
            )}
          </div>
          {frozen.mode === "relayer" && relayerErr && <Note kind="warn">Relayer: {relayerErr}</Note>}
        </div>
      ) : preset ? (
        <div className="flex flex-col gap-4">
          <Label>co-sign // next one-time key #{leaf}</Label>
          <div className="rounded-md border border-teal/40 bg-teal/[0.04] px-4 py-3 text-[13px]">{describeAction(preset)}</div>
          <p className="text-[12px] text-mute">You approve exactly this action, fee included. Check it before signing.</p>
          <PreflightNotes pre={pre} consent={consent} setConsent={setConsent} />
          {formErr && <div className="text-[12px] text-bad">✕ {formErr}</div>}
          <div className="flex flex-wrap gap-3">
            {!wallet.publicKey && !(preset.fee > 0n) ? (
              <button className="btn" onClick={() => setVisible(true)}>
                connect wallet
              </button>
            ) : (
              <button className="btn" onClick={prepare} disabled={!!busy || (!!pre?.warnings.length && !pre.errors.length && !consent)}>
                {busy ? "checking…" : "check & approve →"}
              </button>
            )}
            <button className="btn ghost" onClick={onPresetDone}>
              back
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Label>
            new action // next one-time key #{leaf} · {left}/{total} left
            {state.config.threshold > 1 && !isRecovery && ` · needs ${state.config.threshold} signers`}
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {kinds.map((k) => (
              <button
                key={k.k}
                onClick={() => (setKind(k.k), setSeed(null))}
                title={locked(k.k) ? tierNeedText(TIER_GUARDIAN, tier ?? null, protocol) : undefined}
                className={`rounded border px-3 py-1.5 text-[12px] ${kind === k.k ? "border-teal bg-teal/[0.08] text-teal" : "border-line-2 text-mute hover:text-bone"} ${
                  locked(k.k) ? "opacity-60" : ""
                }`}
              >
                {locked(k.k) && <Lock size={11} className="mr-1 inline -mt-0.5" />}
                {k.label}
              </button>
            ))}
          </div>
          {locked(kind) && <TierHint need={TIER_GUARDIAN} tier={tier} protocol={protocol} feature={kind === "schedule" ? "Schedules" : "Session budgets"} />}

          {kind === "withdraw" && (
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              {assetSelect}
              <label className="flex flex-col gap-1.5">
                <Label>amount</Label>
                <div className="flex gap-2">
                  <input className="field flex-1" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  <button className="btn ghost sm" type="button" onClick={() => setAmount(maxAmount())}>
                    max
                  </button>
                </div>
              </label>
              {destInput()}
            </div>
          )}

          {kind === "schedule" && (
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              {assetSelect}
              <label className="flex flex-col gap-1.5">
                <Label>amount per payment</Label>
                <input className="field" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              {destInput("pay to")}
              {periodInput("every")}
              <label className="flex flex-col gap-1.5">
                <Label>number of payments</Label>
                <input className="field" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1.5">
                <Label>first payment · slot #{scheduleId}</Label>
                <input className="field" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <p className="text-[11.5px] text-dim sm:col-span-2">Anyone (a keeper, or you below) can run a due payment. It never pays more or earlier than signed.</p>
            </div>
          )}

          {kind === "budget" && (
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <Label>session key (an ordinary wallet; default: the connected one)</Label>
                <input className="field" value={session} onChange={(e) => setSession(e.target.value)} spellCheck={false} placeholder="wallet address" />
              </label>
              {assetSelect}
              <label className="flex flex-col gap-1.5">
                <Label>limit per period</Label>
                <input className="field" inputMode="decimal" placeholder="0.5" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              {periodInput("period")}
              <label className="flex flex-col gap-1.5">
                <Label>expires in (days) · slot #{budgetId}</Label>
                <input className="field" inputMode="numeric" value={expiresDays} onChange={(e) => setExpiresDays(e.target.value)} />
              </label>
              <p className="text-[11.5px] text-dim sm:col-span-2">
                The daily-use path: that wallet can then spend up to the limit per period to unrestricted destinations, without using
                one-time keys. Losing it loses at most the budget.
              </p>
            </div>
          )}

          {kind === "stake" && (
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <label className="flex flex-col gap-1.5">
                <Label>validator (top by active stake)</Label>
                <select className="field" value={vote} onChange={(e) => setVote(e.target.value)}>
                  {!validators && <option>loading…</option>}
                  {validators?.map((v) => (
                    <option key={v.vote} value={v.vote}>
                      {short(v.vote, 5)} — {sol(v.stake, 0)} SOL staked
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <Label>amount (SOL) · slot #{freeSeed < 0 ? "–" : freeSeed}</Label>
                <input className="field" inputMode="decimal" placeholder="1.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
            </div>
          )}

          {(kind === "unstake" || kind === "collectStake") && (
            <SlotPicker
              label="stake slot"
              empty="This vault has no stake accounts."
              value={seed}
              onChange={setSeed}
              options={usedStakes.map((s) => ({ v: s.seed, t: `#${s.seed} — ${sol(s.lamports)} SOL (${short(s.address.toBase58(), 4)})` }))}
            />
          )}
          {kind === "cancelSchedule" && (
            <SlotPicker
              label="schedule"
              empty="No schedules."
              value={seed}
              onChange={setSeed}
              options={schedules.map((s) => ({ v: s.id, t: `#${s.id} — ${s.remaining} left to ${short(s.dest.toBase58(), 4)}` }))}
            />
          )}
          {kind === "cancelBudget" && (
            <SlotPicker
              label="budget"
              empty="No budgets."
              value={seed}
              onChange={setSeed}
              options={budgets.map((b) => ({ v: b.id, t: `#${b.id} — session ${short(b.session.toBase58(), 4)}` }))}
            />
          )}
          {kind === "migrate" && (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1.5">
                <Label>new vault address</Label>
                <input className="field" value={newVault} onChange={(e) => setNewVault(e.target.value)} spellCheck={false} placeholder="an initialized Noxvault" />
              </label>
              <p className="text-[11.5px] text-dim">
                No new vault yet? <Link href="/create" className="underline">Create one</Link> with the same phrase: it uses the next vault
                number, so fresh keys. Co-signers and the recovery holder must give you new codes for it (a tree must never serve two
                vaults). After approval, anyone can move all SOL and tokens across.
              </p>
            </div>
          )}
          {kind === "ping" && (
            <p className="text-[12.5px] text-mute">
              Proves the owner is active: resets the recovery and testament clocks. Uses one key.
              {vaultLocked && " During a lockdown a Ping signed by the main phrase alone does not reset them."}
            </p>
          )}
          {kind === "cancelLock" && (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1.5">
                <Label>freeze for (days, 1 to 90)</Label>
                <input className="field w-32" inputMode="numeric" value={freezeDays} onChange={(e) => setFreezeDays(e.target.value)} />
              </label>
              <p className="text-[12.5px] text-mute">
                Cancel and freeze for {Number(freezeDays) || DEFAULT_CANCEL_LOCK_DAYS} days: recommended if the main phrase may be stolen. It drops the pending
                payout or migration, then freezes the vault: the main phrase alone can only Ping or cancel until then, and its Pings stop counting as
                activity, so a thief cannot hold off your recovery takeover. The owner can still escape: the main phrase and this recovery phrase together
                move everything to a new vault at once. Uses one recovery key; a running lockdown is only ever extended.
              </p>
            </div>
          )}
          {kind === "cancel" && (
            <p className="text-[12.5px] text-mute">
              {state.pending || state.migrateTo
                ? "Drops the pending withdrawal or migration, and stops a started migration from moving what is still in the vault."
                : "Nothing is pending right now."}
              {isRecovery &&
                " Plain cancel: whoever holds the main phrase can queue a new payout right after. If that phrase may be stolen, use Cancel + freeze instead. A plain recovery Cancel also ends any lockdown."}
            </p>
          )}

          <div className="flex flex-col gap-2">
            <Label>who pays the network fees</Label>
            <div className="grid gap-2 sm:grid-cols-2 [&>*]:min-w-0">
              {(
                [
                  ["wallet", "My wallet pays", "fee 0 · your wallet signs the transactions"],
                  [
                    "relayer",
                    "Gasless via relayer",
                    relayer
                      ? sentinelFree
                        ? "free for Sentinel vaults"
                        : lockdownFree({ kind })
                          ? "free during a lockdown (no fee allowed)"
                          : `vault pays ${sol(BigInt(relayer.minFee), 6)} SOL to the relayer`
                      : "no wallet needed",
                  ],
                ] as const
              ).map(([m, t, d]) => (
                <button key={m} onClick={() => setMode(m)} className={`rounded-md border px-3 py-2.5 text-left ${mode === m ? "border-teal bg-teal/[0.06]" : "border-line-2"}`}>
                  <div className={`text-[12.5px] ${mode === m ? "text-teal" : ""}`}>{t}</div>
                  <div className="mt-0.5 text-[11px] text-dim">{d}</div>
                </button>
              ))}
            </div>
            {mode === "relayer" && relayerErr && <Note kind="warn">Relayer unavailable: {relayerErr}</Note>}
            {mode === "relayer" && relayer?.sentinelFree && <TierHint kind="perk" need={TIER_SENTINEL} tier={tier} protocol={protocol} feature="The relayer is free" />}
          </div>

          {formErr && <div className="text-[12px] text-bad">✕ {formErr}</div>}
          <PreflightNotes pre={pre} consent={consent} setConsent={setConsent} />
          <div className="flex flex-wrap gap-3">
            {mode === "wallet" && !wallet.publicKey ? (
              <button className="btn" onClick={() => setVisible(true)}>
                connect wallet
              </button>
            ) : (
              <button className="btn" onClick={prepare} disabled={!!busy || locked(kind) || (mode === "relayer" && !relayer) || (!!pre?.warnings.length && !pre.errors.length && !consent)}>
                {busy ? "checking…" : "check & sign →"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PreflightNotes({
  pre,
  consent,
  setConsent,
}: {
  pre: { errors: string[]; warnings: string[] } | null;
  consent: boolean;
  setConsent: (v: boolean) => void;
}) {
  if (!pre) return null;
  if (pre.errors.length)
    return (
      <Note kind="bad">
        Not signed:
        <ul className="mt-1 list-inside list-disc">
          {pre.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </Note>
    );
  if (!pre.warnings.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <Note kind="warn">
        Check before signing:
        <ul className="mt-1 list-inside list-disc">
          {pre.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </Note>
      <label className="flex cursor-pointer items-start gap-2 text-[12px] text-mute">
        <input type="checkbox" className="mt-1 accent-[#2ee6d6]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I understand and want to
        sign this exact action.
      </label>
    </div>
  );
}

function SlotPicker({
  label,
  empty,
  value,
  onChange,
  options,
}: {
  label: string;
  empty: string;
  value: number | null;
  onChange: (v: number | null) => void;
  options: { v: number; t: string }[];
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {options.length === 0 ? (
        <div className="text-[12.5px] text-dim">{empty}</div>
      ) : (
        <select className="field" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
          <option value="">pick one</option>
          {options.map((o) => (
            <option key={o.v} value={o.v}>
              {o.t}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}

function localInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
