"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { Copy, Label, Note, PageHead, Panel } from "@/components/ui";
import TierBadge from "@/components/vault/TierBadge";
import { NETWORK, NOX_CA, NOX_CA_LABEL, explorerUrl, FAUCET_AMOUNT, NOX_TOKEN, PUMP_URL, CHART_URL, SOLSCAN_TOKEN_URL } from "@/lib/config";
import { Countdown, launchClock } from "@/components/Launch";
import { noxAmount, useProtocol, useVaultTier } from "@/lib/nox";
import { errMsg, sol } from "@/lib/format";

const ROWS = [
  { t: "Free", need: "0", unlocks: "Vault, withdrawals, staking, whitelist and delays, recovery key, Escape Hatch, relayer at the standard fee", fee: "one-time creation fee" },
  { t: "Guardian", need: "G", unlocks: "Free + testament, recurring schedules, session budgets", fee: "no creation fee" },
  { t: "Sentinel", need: "S", unlocks: "Guardian + multi-signer vaults (co-signers), free relayer", fee: "no creation fee, relays free" },
];

export default function Token() {
  const protocol = useProtocol();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("vault") ?? "");
  const [vault, setVault] = useState<PublicKey | null>(() => {
    try {
      return params.get("vault") ? new PublicKey(params.get("vault")!) : null;
    } catch {
      return null;
    }
  });
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const { tier } = useVaultTier(vault, nonce);
  const [faucetMsg, setFaucetMsg] = useState<{ kind: "ok" | "bad"; text: string; sig?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setFaucetMsg(null);
    try {
      setVault(new PublicKey(q.trim()));
    } catch {
      setErr("Not a valid address");
    }
  };

  const faucet = async () => {
    if (!vault) return;
    setBusy(true);
    setFaucetMsg(null);
    try {
      const r = await fetch("/api/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vault: vault.toBase58() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Faucet failed (${r.status})`);
      setFaucetMsg({ kind: "ok", text: `Sent ${Number(j.amount).toLocaleString("en-US")} test $NOX to the vault.`, sig: j.signature });
      setNonce((n) => n + 1);
    } catch (e) {
      setFaucetMsg({ kind: "bad", text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  const d = protocol?.decimals ?? 0;
  const amount = (k: string) => (!protocol ? "…" : k === "G" ? noxAmount(protocol.guardian, d) : k === "S" ? noxAmount(protocol.sentinel, d) : "0");
  const mint = protocol?.noxMint.toBase58() ?? NOX_CA;

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        kicker="$NOX"
        title={
          <>
            The <span className="inv">$NOX</span> token
          </>
        }
        sub="$NOX unlocks features and priority by the amount held inside your vault — where it is itself behind hash-based keys. The program checks it on-chain; safety features never depend on it."
      />

      <Panel title="$NOX on solana // fair launch on pump.fun">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          {NOX_TOKEN ? (
            <div className="min-w-0">
              <Label>contract address</Label>
              <div className="mt-2 flex items-center gap-3 break-all text-[14px] text-bone">
                {NOX_TOKEN} <Copy value={NOX_TOKEN} />
              </div>
              <p className="mt-2 text-[12px] text-mute">Always check this address. Anything else calling itself $NOX is not ours.</p>
            </div>
          ) : (
            <div className="min-w-0">
              <Label>launching on pump.fun · {launchClock()}</Label>
              <div className="mt-2 text-[28px] font-bold text-teal sm:text-[34px]">
                <Countdown />
              </div>
              <p className="mt-1 text-[12px] text-mute">
                Fair launch: no presale. The contract address appears here and on{" "}
                <a href="https://x.com/noxvaultHQ" target="_blank" rel="noreferrer" className="underline">
                  @noxvaultHQ
                </a>{" "}
                at launch, nowhere else.
              </p>
            </div>
          )}
          <div className="flex shrink-0 flex-wrap gap-3">
            <a href={PUMP_URL} target="_blank" rel="noreferrer" className={`btn ${NOX_TOKEN ? "" : "pointer-events-none opacity-40"}`} aria-disabled={!NOX_TOKEN}>
              buy on pump.fun
            </a>
            {CHART_URL && (
              <a href={CHART_URL} target="_blank" rel="noreferrer" className="btn ghost">
                chart
              </a>
            )}
            {SOLSCAN_TOKEN_URL && (
              <a href={SOLSCAN_TOKEN_URL} target="_blank" rel="noreferrer" className="btn ghost">
                solscan
              </a>
            )}
          </div>
        </div>
        {NETWORK !== "mainnet-beta" && (
          <p className="border-t border-line px-4 py-3 text-[11.5px] text-dim sm:px-5">
            The vaults run on {NETWORK} for now, so tiers there use the free test token tNOX below. Real $NOX tiers start when Noxvault goes to
            mainnet.
          </p>
        )}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr] [&>*]:min-w-0">
        <Panel title={`tiers // live from the protocol account${protocol === null ? " (not set on this network)" : ""}`}>
          <div className="overflow-x-auto">
            <table className="tbl min-w-[560px]">
              <thead>
                <tr>
                  <th>tier</th>
                  <th>$NOX in the vault</th>
                  <th>unlocks</th>
                  <th>fees</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r, i) => (
                  <tr key={r.t}>
                    <td className={["text-mute", "text-teal", "text-warn"][i] + " font-bold"}>{r.t}</td>
                    <td className="whitespace-nowrap">{amount(r.need)}</td>
                    <td className="text-mute">{r.unlocks}</td>
                    <td className="text-mute">{i === 0 && protocol ? `${sol(protocol.createFee)} SOL at creation` : r.fee}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-3 text-[11.5px] text-dim">
            A feature that was enabled stays executable if the vault&apos;s $NOX later drops, so heirs and co-signers are never locked out.
          </p>
        </Panel>

        <Panel title="mint">
          <div className="flex flex-col gap-3 p-4 sm:p-5 text-[12.5px]">
            <div className="flex items-center justify-between">
              <Label>{NOX_CA_LABEL}</Label>
              {mint && <Copy value={mint} />}
            </div>
            {mint ? (
              <a className="break-all rounded-md border border-line-2 bg-ink px-3 py-2.5 hover:border-teal/50" href={explorerUrl(mint)} target="_blank" rel="noreferrer">
                {mint}
              </a>
            ) : (
              <div className="text-mute">Not launched yet.</div>
            )}
            {NETWORK === "devnet" && <Note kind="warn">Devnet test token: it has no value and exists only to try the tiers.</Note>}
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 md:grid-cols-3 [&>*]:min-w-0">
        <Panel className="p-5">
          <Label>q-day priority</Label>
          <p className="mt-3 text-[12.5px] text-mute">
            When the quantum canary trips, keepers evacuate linked wallets in order of tier, then of $NOX held. In the first blocks after a
            break, the front of the queue matters most. See the <Link href="/escape" className="underline">Escape Hatch</Link>.
          </p>
        </Panel>
        <Panel className="p-5">
          <Label>fee waivers</Label>
          <p className="mt-3 text-[12.5px] text-mute">
            Free vaults pay a one-time creation fee{protocol ? ` (${sol(protocol.createFee)} SOL)` : ""} to the treasury. Guardian and Sentinel pay
            none; Sentinel vaults also use the gasless relayer for free.
          </p>
        </Panel>
        <Panel className="p-5">
          <Label>governance</Label>
          <p className="mt-3 text-[12.5px] text-mute">
            $NOX holders will set the protocol parameters — tier thresholds, fees, treasury — after mainnet, with $NOX held in vaults counting as
            voting power. Until then a team multisig controls them, in public.
          </p>
        </Panel>
      </div>

      <Panel title="check a vault's tier">
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <form onSubmit={lookup} className="flex flex-col gap-2 sm:flex-row">
            <input className="field flex-1" placeholder="vault address" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
            <button className="btn" type="submit">
              check
            </button>
          </form>
          {err && <div className="text-[12px] text-bad">✕ {err}</div>}
          {vault && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
                <span className="text-mute">{vault.toBase58()}</span>
                <TierBadge tier={tier} protocol={protocol} />
              </div>
              {NETWORK === "devnet" && (
                <div className="flex flex-wrap items-center gap-3">
                  <button className="btn outline" onClick={faucet} disabled={busy}>
                    {busy ? "sending…" : `get ${FAUCET_AMOUNT.toLocaleString("en-US")} test $NOX`}
                  </button>
                  <span className="text-[11.5px] text-dim">devnet only · once per vault per 24 h · enough for Sentinel</span>
                </div>
              )}
              {faucetMsg && (
                <Note kind={faucetMsg.kind}>
                  {faucetMsg.text}{" "}
                  {faucetMsg.sig && (
                    <a className="underline" href={explorerUrl(faucetMsg.sig, "tx")} target="_blank" rel="noreferrer">
                      view tx
                    </a>
                  )}
                </Note>
              )}
            </div>
          )}
          <p className="text-[11.5px] text-dim">
            $NOX counts only when it sits in the vault&apos;s own token account. You can send it before the vault is initialized. Read the{" "}
            <Link href="/whitepaper#nox-utility" className="underline">
              whitepaper
            </Link>{" "}
            for tokenomics. Not investment advice: $NOX gives access, priority and governance, no claim on profits.
          </p>
        </div>
      </Panel>
    </div>
  );
}
