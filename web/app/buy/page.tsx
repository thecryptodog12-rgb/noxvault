import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Copy, Label, PageHead, Panel } from "@/components/ui";
import { Countdown } from "@/components/Launch";
import { NETWORK, NOX_LAUNCH_AT, NOX_TOKEN, PUMP_URL, X_URL } from "@/lib/config";

export const metadata: Metadata = {
  title: "Buy $NOX — Noxvault",
  description: "How to buy $NOX on pump.fun in four steps: a Solana wallet, some SOL, the right contract address, one swap.",
};

const launchCest = new Date(NOX_LAUNCH_AT).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <Panel className="p-5">
      <div className="flex items-baseline gap-3">
        <span className="font-bold tabular-nums text-teal">{n}</span>
        <Label>{title}</Label>
      </div>
      <div className="mt-3 flex flex-col gap-2 text-[13px] leading-relaxed text-mute">{children}</div>
    </Panel>
  );
}

function Ca() {
  if (!NOX_TOKEN) {
    return (
      <div className="rounded-md border border-line-2 bg-ink px-3 py-2.5">
        <Label>contract address · launching on pump.fun at {launchCest} UTC</Label>
        <div className="mt-1.5 text-[22px] font-bold text-teal">
          <Countdown />
        </div>
        <p className="mt-1 text-[12px] text-mute">The address appears here and on @noxvaultHQ at launch. Nothing posted before that is real.</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-line-2 bg-ink px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <Label>$NOX contract address (CA)</Label>
        <Copy value={NOX_TOKEN} />
      </div>
      <div className="mt-1.5 break-all text-[14px] text-bone">{NOX_TOKEN}</div>
    </div>
  );
}

export default function Page() {
  const ext = { target: "_blank", rel: "noreferrer", className: "underline" } as const;
  return (
    <div className="flex flex-col gap-6">
      <PageHead
        kicker="buy $NOX"
        title={
          <>
            How to buy <span className="inv">$NOX</span>
          </>
        }
        sub="New to Solana? Four steps, about ten minutes. $NOX is a fair launch on pump.fun: no presale."
      />

      <div className="rounded-md border-2 border-warn/70 bg-warn/[0.06] p-4 sm:p-5">
        <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-warn">⚠ only trust this contract address</div>
        <ul className="mt-3 flex flex-col gap-1.5 text-[13px] leading-relaxed text-bone/90">
          <li>
            The real $NOX address is the one shown on <strong>nox-vault.com</strong> and posted by{" "}
            <a href={X_URL} {...ext}>
              @noxvaultHQ
            </a>{" "}
            on X. Anything else calling itself $NOX is a copy.
          </li>
          <li>Nobody from Noxvault will DM you. Not on X, not on Telegram, not anywhere. Anyone who does is a scammer.</li>
          <li>Never share your wallet&apos;s recovery phrase or a vault&apos;s 24 words. No real support needs them.</li>
        </ul>
        <div className="mt-4">
          <Ca />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 [&>*]:min-w-0">
        <Step n="01" title="get a solana wallet">
          <p>
            Install a Solana wallet app or browser extension:{" "}
            <a href="https://phantom.com" {...ext}>
              Phantom
            </a>
            ,{" "}
            <a href="https://solflare.com" {...ext}>
              Solflare
            </a>{" "}
            or{" "}
            <a href="https://backpack.app" {...ext}>
              Backpack
            </a>
            . Only download it from the official site or app store.
          </p>
          <p>Create a new wallet and write the recovery phrase down on paper. Whoever has those words has the wallet.</p>
        </Step>
        <Step n="02" title="buy some sol">
          <p>
            You pay for $NOX with SOL. Buy SOL on an exchange (Coinbase, Kraken, Binance, Bitvavo…) and withdraw it to your wallet&apos;s
            Solana address, or buy it right inside the wallet app with a card.
          </p>
          <p>Keep a little extra (about 0.01 SOL) for network fees.</p>
        </Step>
        <Step n="03" title="open pump.fun via our link">
          <p>
            {NOX_TOKEN ? (
              <>
                Open{" "}
                <a href={PUMP_URL} {...ext}>
                  $NOX on pump.fun
                </a>{" "}
                from this page, not from a search result or a reply under a post.
              </>
            ) : (
              <>The pump.fun link appears on this page at launch. Use it, not a search result or a reply under a post.</>
            )}
          </p>
          <p>
            Before you buy, check that the contract address on pump.fun is <strong className="text-bone">exactly</strong> the one above. Compare
            the whole thing, not only the first and last characters.
          </p>
        </Step>
        <Step n="04" title="swap sol for $nox">
          <p>Connect your wallet on pump.fun, enter how much SOL you want to spend and confirm the trade in your wallet.</p>
          <p>The $NOX shows up in your wallet a few seconds later. Prices move fast at launch: only spend what you can afford to lose.</p>
        </Step>
      </div>

      <Panel className="p-5">
        <div className="flex items-baseline gap-3">
          <span className="font-bold tabular-nums text-dim">05</span>
          <Label>optional · hold it in your vault for tiers</Label>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-mute">
          $NOX held inside a Noxvault vault unlocks the Guardian and Sentinel tiers: no creation fee, testaments, schedules, co-signers, a free
          relayer and a place near the front of the queue on Q-Day. See the <Link href="/token" className="underline">$NOX page</Link> for the
          thresholds.
          {NETWORK !== "mainnet-beta" && <> The vaults run on {NETWORK} for now; real $NOX tiers start when Noxvault goes to mainnet.</>}
        </p>
      </Panel>

      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap [&>*]:justify-center">
        <a href={PUMP_URL} target="_blank" rel="noreferrer" className={`btn col-span-2 ${NOX_TOKEN ? "" : "pointer-events-none opacity-40"}`} aria-disabled={!NOX_TOKEN}>
          buy on pump.fun
        </a>
        <Link href="/token" className="btn ghost">
          $NOX token
        </Link>
        <Link href="/risks" className="btn ghost">
          risks
        </Link>
      </div>
    </div>
  );
}
