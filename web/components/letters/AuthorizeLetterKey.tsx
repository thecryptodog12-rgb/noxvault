"use client";
// Signs Kind::LetterKey with the owner's one-time key and sends it (wallet or relayer). Same
// safety rules as the main action form: the vault's history picks the leaf, a half-published
// message is resumed and never replaced, preflight runs first, "attempted" is saved before sending.
import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  actionDigest,
  buildSteps,
  completesApproval,
  fetchState,
  findSignedMessages,
  leafUsed,
  letterKeyPda,
  packSteps,
  pickLeaf,
  preflightAction,
  remainingSteps,
  type SignedAction,
  type Signer,
} from "@nox/sdk/client";
import { authPath, equal, sign, type Action } from "@nox/sdk/wots";
import { Note } from "@/components/ui";
import { useNox } from "@/lib/hooks";
import { errMsg, hex, sol } from "@/lib/format";
import {
  actionFromJson,
  actionToJson,
  clearAttempted,
  clearPending,
  describeAction,
  fetchRelayerInfo,
  loadPending,
  markAttempted,
  relayAction,
  savePending,
  sendIxs,
  wasAttempted,
  type RelayerInfo,
} from "@/lib/unlock";

type Mode = "wallet" | "relayer";

export default function AuthorizeLetterKey({ vault, signer, letterKey, onDone }: { vault: PublicKey; signer: Signer; letterKey: PublicKey; onDone: () => void }) {
  const { connection, program, wallet } = useNox();
  const { setVisible } = useWalletModal();
  const [mode, setMode] = useState<Mode>("relayer");
  const [relayer, setRelayer] = useState<RelayerInfo | null>(null);
  const [relayerErr, setRelayerErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string[]>([]);
  const vaultStr = vault.toBase58();
  const tree = signer.tree;

  useEffect(() => {
    fetchRelayerInfo()
      .then(setRelayer)
      .catch((e) => setRelayerErr(errMsg(e)));
  }, []);

  /** The leaf and exact action to send: a half-sent letter-key message is resumed as is. */
  const choose = async (): Promise<{ leaf: number; action: Action; mode: Mode }> => {
    const [signed, state] = await Promise.all([findSignedMessages(program, vault, signer), fetchState(program, vault)]);
    if (!state) throw new Error("This vault is not initialized.");
    const pick = pickLeaf(state, signer, signed);
    const isOurs = (a: Action) => a.kind === "letterKey" && equal(a.key, letterKey.toBytes());
    if (pick.resume) {
      if (!isOurs(pick.resume.action))
        throw new Error(`One-time key #${pick.resume.leaf} already started "${describeAction(pick.resume.action)}". Finish that on My Vaults first.`);
      return { leaf: pick.resume.leaf, action: pick.resume.action, mode: pick.resume.action.fee > 0n ? "relayer" : "wallet" };
    }
    const local = loadPending(vaultStr, tree);
    if (local && !leafUsed(state, tree, local.leaf)) {
      const a = actionFromJson(local.action);
      if (isOurs(a)) return { leaf: local.leaf, action: a, mode: local.mode };
      if (wasAttempted(vaultStr, tree, local.leaf)) throw new Error(`This browser is still sending "${describeAction(a)}". Finish that on My Vaults first.`);
    }
    let fee = 0n;
    let feePayee: Uint8Array = new Uint8Array(32);
    if (mode === "relayer") {
      if (!relayer) throw new Error(relayerErr ?? "Relayer unavailable");
      fee = BigInt(relayer.minFee);
      // The first letter key creates an account; the relayer pays its rent, so the fee covers it.
      if (!(await connection.getAccountInfo(letterKeyPda(vault, program.programId), "confirmed"))) fee += BigInt(await connection.getMinimumBalanceForRentExemption(8 + 72));
      feePayee = new PublicKey(relayer.relayer).toBytes();
    }
    return { leaf: pick.leaf, action: { kind: "letterKey", key: letterKey.toBytes(), fee, feePayee }, mode };
  };

  const run = async () => {
    setErr(null);
    setWarn([]);
    try {
      setBusy("reading the vault's history");
      const c = await choose();
      const payer = c.mode === "relayer" ? new PublicKey(relayer?.relayer ?? PublicKey.default) : wallet.publicKey;
      if (!payer) {
        setVisible(true);
        throw new Error("Connect a wallet, or use the relayer.");
      }
      setBusy("checking");
      const pre = await preflightAction({ program, payer, vault, signer, leaf: c.leaf, action: c.action });
      if (pre.errors.length) throw new Error(pre.errors.join(" "));
      setWarn(pre.warnings);
      const digest = actionDigest(program.programId, vault, tree, c.leaf, c.action);
      savePending({ v: 2, vault: vaultStr, tree, leaf: c.leaf, action: actionToJson(c.action), digest: hex(digest), mode: c.mode, createdAt: Date.now() });
      const s: SignedAction = { vault, tree, leaf: c.leaf, pkSeed: signer.seeds.pkSeed, authPath: authPath(signer.pub, c.leaf), signature: sign(signer.seeds, c.leaf, digest), action: c.action };
      markAttempted(vaultStr, tree, c.leaf); // before anything can reach the network
      if (c.mode === "relayer") {
        setBusy("the relayer sends open + write + verify + approve + execute");
        await relayAction(s);
      } else {
        const status = await completesApproval(program, vault, tree, c.action);
        const all = await buildSteps(program, payer, s, { execute: status.willExecute, creator: status.creator ?? payer });
        const txs = packSteps(payer, await remainingSteps(program, payer, s, all));
        for (const [i, t] of txs.entries()) {
          setBusy(`sending ${i + 1}/${txs.length}: ${t.label}`);
          await sendIxs(connection, payer, wallet.sendTransaction, t.instructions);
        }
        if (!status.willExecute) setWarn((w) => [...w, "Approval recorded. The letter key is set once enough signers approve the same action (see open approvals on My Vaults)."]);
      }
      clearPending(vaultStr, tree);
      clearAttempted(vaultStr, tree, c.leaf);
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const feeText = relayer ? `vault pays about ${sol(BigInt(relayer.minFee), 6)} SOL + the key account's rent to the relayer` : relayerErr ? "relayer unavailable" : "checking relayer…";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 text-[12px]">
        {(
          [
            ["relayer", "Gasless via relayer", feeText],
            ["wallet", "Your wallet pays", "network fees + key account rent"],
          ] as const
        ).map(([m, t, d]) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={`rounded border px-3 py-2 text-left ${mode === m ? "border-teal text-bone" : "border-line-2 text-mute"}`}>
            <span className="block font-bold">{t}</span>
            <span className="block text-[11px] text-dim">{d}</span>
          </button>
        ))}
      </div>
      <button className="btn self-start" disabled={!!busy} onClick={run}>
        {busy ? `${busy}…` : "sign with a one-time key & authorize"}
      </button>
      {warn.map((w) => (
        <Note key={w}>{w}</Note>
      ))}
      {err && <Note kind="bad">{err}</Note>}
    </div>
  );
}
