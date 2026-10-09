import Link from "next/link";
import KeygenConsole from "@/components/KeygenConsole";
import { Panel } from "@/components/ui";
import { NETWORK } from "@/lib/config";

const STATS = [
  { k: "scheme", v: "WOTS+", s: "tweaked Winternitz one-time signature" },
  { k: "hash", v: "SHA-256", s: "full 32-byte chain values" },
  { k: "rule", v: "1 KEY = 1 USE", s: "spent keys are marked on-chain" },
  { k: "network", v: NETWORK.toUpperCase(), s: "test SOL only, for now" },
];

const STEPS = [
  { n: "01", t: "Make a secret", d: "Your browser draws 32 random bytes and shows them as 24 words. Nothing is sent anywhere. From those words come vault #0, #1, #2…" },
  { n: "02", t: "Fill the vault", d: "The vault is an address derived from a hash root. Any wallet can send SOL or tokens to it. No elliptic-curve key can take them out." },
  { n: "03", t: "Sign once", d: "To withdraw, the browser signs the exact payout (asset, amount, destination, next vault) with the one-time key. A couple of transactions verify it on-chain." },
  { n: "04", t: "Move to dawn", d: "The program pays out, sends the rest to your next fresh vault and marks the old key as spent. It can never sign again." },
];

const ROWS: [string, string, string][] = [
  ["what guards the funds", "one ed25519 key (elliptic curve)", "a WOTS+ one-time signature over SHA-256"],
  ["large quantum computer", "Shor's algorithm recovers the key", "no known shortcut; hash security only weakened, not broken"],
  ["signature", "64 bytes", "1,088 bytes (34 chains × 32 B) + 32-byte pk_seed"],
  ["parameters", "—", "w = 256, n = 32, 32 message + 2 checksum chains"],
  ["hash tweaks", "—", "every hash call keyed by pk_seed, chain and step"],
  ["key reuse", "unlimited", "never; a Spent marker blocks a second use"],
  ["assets", "SOL, SPL", "SOL, SPL and Token-2022"],
  ["a withdrawal", "1 transaction", "usually 2 transactions (sign + write, then verify + pay out)"],
  ["your wallet's role", "holds the key", "only pays fees and deposits; cannot open a vault"],
  ["audited", "depends", "no, not yet"],
];

const ROADMAP = [
  { t: "Build", s: "program, SDK, web app", state: "done" },
  { t: "Devnet", s: "public test with free SOL", state: "now" },
  { t: "Review / audit", s: "external review of program + SDK. Not started.", state: "next" },
  { t: "Mainnet", s: "only after review; upgrade authority burned", state: "later" },
];

const CARDS = [
  { href: "/keylab", k: "try", t: "Key lab", d: "Generate a key, watch the 34 chains, sign, tamper, and see why a second signature leaks the key." },
  { href: "/docs", k: "read", t: "How it works", d: "The whole protocol in plain words: keys, chains, the message, and the on-chain flow." },
  { href: "/risks", k: "know", t: "Risks", d: "Unaudited code, you hold the only secret, browser signing. Read this before you lock anything." },
];

export default function Home() {
  return (
    <div className="flex flex-col gap-16 md:gap-24">
      {/* hero */}
      <section className="grid [&>*]:min-w-0 items-start gap-10 xl:grid-cols-[1.05fr_1fr]">
        <div>
          <div className="label mb-5 flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 bg-moon" />
            post-quantum vault // solana {NETWORK}
          </div>
          <h1 className="font-display text-[40px] leading-[1.14] sm:text-[64px] md:text-[76px]">
            Keys that
            <br />
            survive <span className="inv">the</span>
            <br />
            <span className="inv">night.</span>
          </h1>
          <p className="mt-7 max-w-xl text-[14.5px] text-mute">
            Quantum-proof vaults for Solana. Lock SOL and tokens behind a hash-based one-time
            signature that your browser makes from 24 words. Your wallet sends deposits and pays
            fees. It cannot open the vault. Nothing can, except that signature.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/create" className="btn">
              create a vault →
            </Link>
            <Link href="/keylab" className="btn ghost">
              open the key lab
            </Link>
          </div>
        </div>
        <KeygenConsole />
      </section>

      {/* stats */}
      <section className="grid [&>*]:min-w-0 grid-cols-2 gap-3 md:grid-cols-4">
        {STATS.map((s) => (
          <Panel key={s.k} className="p-4">
            <div className="label">{s.k}</div>
            <div className="font-display mt-3 text-[19px] sm:text-[22px]">{s.v}</div>
            <div className="mt-2 text-[11.5px] text-dim">{s.s}</div>
          </Panel>
        ))}
      </section>

      {/* how */}
      <section>
        <SectionHead kicker="how a vault works" title={<>Four steps, <span className="inv">one</span> key.</>} />
        <div className="grid [&>*]:min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((s) => (
            <Panel key={s.n} className="p-5">
              <div className="font-display text-[28px] text-moon">{s.n}</div>
              <div className="font-display mt-4 text-[16px]">{s.t}</div>
              <p className="mt-3 text-[12.5px] text-mute">{s.d}</p>
            </Panel>
          ))}
        </div>
      </section>

      {/* compare */}
      <section>
        <SectionHead kicker="side by side" title={<>A normal wallet <span className="inv">vs</span> Noxvault</>} />
        <Panel className="overflow-x-auto">
          <table className="tbl min-w-[560px]">
            <thead>
              <tr>
                <th className="w-[26%]"></th>
                <th>normal wallet</th>
                <th className="!text-moon">noxvault</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([k, a, b]) => (
                <tr key={k}>
                  <td className="text-dim">{k}</td>
                  <td className="text-mute">{a}</td>
                  <td>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>

      {/* roadmap */}
      <section>
        <SectionHead kicker="roadmap" title={<>Where we <span className="inv">are</span></>} />
        <div className="grid [&>*]:min-w-0 gap-3 md:grid-cols-4">
          {ROADMAP.map((r, i) => (
            <Panel key={r.t} lit={r.state === "now"} className="p-5">
              <div className="flex items-center justify-between">
                <span className="label">phase {i + 1}</span>
                <span
                  className={`text-[10px] uppercase tracking-[0.18em] ${
                    r.state === "now" ? "bg-moon px-1.5 text-ink" : r.state === "done" ? "text-bone" : "text-dim"
                  }`}
                >
                  {r.state}
                </span>
              </div>
              <div className={`font-display mt-4 text-[18px] ${r.state === "later" || r.state === "next" ? "text-mute" : ""}`}>
                {r.t}
              </div>
              <p className="mt-2 text-[12px] text-dim">{r.s}</p>
            </Panel>
          ))}
        </div>
        <p className="mt-4 text-[12px] text-dim">
          Nothing here has been audited. Use devnet SOL you do not care about.
        </p>
      </section>

      {/* cards */}
      <section className="grid [&>*]:min-w-0 gap-3 md:grid-cols-3">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className="group">
            <Panel className="h-full p-5 transition-colors group-hover:border-moon-dim">
              <div className="label">{c.k}</div>
              <div className="font-display mt-4 flex items-center justify-between text-[20px]">
                {c.t}
                <span className="text-dim transition-transform group-hover:translate-x-1 group-hover:text-moon">→</span>
              </div>
              <p className="mt-3 text-[12.5px] text-mute">{c.d}</p>
            </Panel>
          </Link>
        ))}
      </section>
    </div>
  );
}

function SectionHead({ kicker, title }: { kicker: string; title: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="label mb-3">{`// ${kicker}`}</div>
      <h2 className="font-display text-[28px] leading-[1.08] sm:text-[38px]">{title}</h2>
    </div>
  );
}
