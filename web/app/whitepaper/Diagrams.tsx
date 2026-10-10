// The whitepaper's three diagrams, drawn as SVG in the site style (teal on near-black).
// Each scales to its container width; text stays legible on a phone via a horizontal scroller.

const C = { line: "#213a40", text: "#e6f0ef", mute: "#93a5a9", teal: "#2ee6d6", warn: "#ffb547", bg: "#060c0f" };

function Box({ x, y, w, h, title, sub, accent = false, n }: { x: number; y: number; w: number; h: number; title: string; sub?: string; accent?: boolean; n?: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill={C.bg} stroke={accent ? C.teal : C.line} strokeWidth={accent ? 1.5 : 1} />
      {n && (
        <text x={x + 12} y={y + 18} fill={C.teal} fontSize={11} fontFamily="var(--font-mono)">
          {n}
        </text>
      )}
      <text x={x + w / 2} y={y + h / 2 + (n ? 8 : sub ? -2 : 4)} textAnchor="middle" fill={C.text} fontSize={14} fontWeight={700} fontFamily="var(--font-mono)">
        {title}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + (n ? 26 : 16)} textAnchor="middle" fill={C.mute} fontSize={11} fontFamily="var(--font-mono)">
          {sub}
        </text>
      )}
    </g>
  );
}

function Arrow({ x1, y1, x2, y2, color = C.teal, dashed = false }: { x1: number; y1: number; x2: number; y2: number; color?: string; dashed?: boolean }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1.5} strokeDasharray={dashed ? "4 4" : undefined} markerEnd="url(#nox-arrow)" />;
}

function Defs() {
  return (
    <defs>
      <marker id="nox-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill={C.teal} />
      </marker>
    </defs>
  );
}

function Frame({ title, children, w, h, caption }: { title: string; children: React.ReactNode; w: number; h: number; caption: string }) {
  return (
    <figure className="not-prose my-8">
      <div className="panel overflow-x-auto p-4">
        <div className="label mb-3">{title}</div>
        <svg viewBox={`0 0 ${w} ${h}`} className="block h-auto w-full min-w-[600px]" role="img" aria-label={caption}>
          <Defs />
          {children}
        </svg>
      </div>
      <figcaption className="mt-2 text-center text-[11.5px] text-dim">{caption}</figcaption>
    </figure>
  );
}

/** phrase → 256 keys → fixed address → sign → verify → approve / execute (two rows, snake order) */
export function DesignFlow() {
  const steps = [
    ["24-word phrase", "stays in your browser"],
    ["256 one-time keys", "WOTS+ Merkle leaves"],
    ["fixed address", "hash of roots + rules"],
    ["sign one action", "one key, one message"],
    ["verify on-chain", "chains → leaf → root"],
    ["approve / execute", "when the rules are met"],
  ];
  const w = 230;
  const h = 84;
  const gap = 46;
  const pos = (i: number) => {
    const row = i < 3 ? 0 : 1;
    const col = row === 0 ? i : 5 - i; // second row runs right to left
    return { x: 10 + col * (w + gap), y: 14 + row * (h + 54) };
  };
  return (
    <Frame title="design // how a vault works" w={3 * w + 2 * gap + 20} h={2 * h + 54 + 28} caption="From a phrase to an executed action: every step after the first happens in public, none needs an ed25519 key.">
      {steps.map(([t, sub], i) => {
        const { x, y } = pos(i);
        const next = i < steps.length - 1 ? pos(i + 1) : null;
        return (
          <g key={t}>
            <Box x={x} y={y} w={w} h={h} title={t} sub={sub} n={String(i + 1).padStart(2, "0")} accent={i === 2 || i === 5} />
            {next && next.y === y && next.x > x && <Arrow x1={x + w + 2} y1={y + h / 2} x2={next.x - 4} y2={y + h / 2} />}
            {next && next.y === y && next.x < x && <Arrow x1={x - 2} y1={y + h / 2} x2={next.x + w + 4} y2={y + h / 2} />}
            {next && next.y !== y && <Arrow x1={x + w / 2} y1={y + h + 2} x2={next.x + w / 2} y2={next.y - 4} />}
          </g>
        );
      })}
    </Frame>
  );
}

/** wallet → armed → trigger (canary / panic) → keepers ($NOX tier first) → vault */
export function EscapeFlow() {
  return (
    <Frame title="escape hatch // the fire exit" w={830} h={210} caption="Armed once while ed25519 is safe; fired by the canary or by the owner; executed by keepers, highest $NOX tier first, into the wallet's own vault.">
      <Box x={6} y={72} w={124} h={66} title="wallet" sub="ed25519, at risk" />
      <Arrow x1={132} y1={105} x2={152} y2={105} />
      <Box x={156} y={72} w={140} h={66} title="armed" sub="link·delegate·tx" accent />
      <Arrow x1={298} y1={105} x2={318} y2={105} />
      <Box x={322} y={14} w={150} h={62} title="canary trips" sub="ed25519 broken" />
      <Box x={322} y={134} w={150} h={62} title="panic" sub="owner's alarm" />
      <Arrow x1={474} y1={46} x2={500} y2={94} />
      <Arrow x1={474} y1={164} x2={500} y2={116} />
      <Box x={504} y={72} w={176} h={66} title="keepers evacuate" sub="Sentinel→Guardian→Free" accent />
      <Arrow x1={682} y1={105} x2={702} y2={105} />
      <Box x={706} y={72} w={118} h={66} title="your vault" sub="hash keys only" accent />
      <text x={592} y={160} textAnchor="middle" fill={C.warn} fontSize={11} fontFamily="var(--font-mono)">
        then by $NOX held
      </text>
    </Frame>
  );
}

/** Build done / Devnet now / Audit next / Mainnet after audit gate / Governance */
export function RoadmapDiagram() {
  const phases = [
    { t: "Build", s: "done", st: "done" },
    { t: "Devnet", s: "now", st: "now" },
    { t: "Audit", s: "next", st: "next" },
    { t: "Mainnet", s: "after the audit gate", st: "later" },
    { t: "Governance", s: "then", st: "later" },
  ];
  const step = 170;
  return (
    <Frame title="roadmap // gates, not dates" w={800} h={150} caption="Each phase starts only when the previous one's exit condition is met and published.">
      <line x1={60} y1={56} x2={60 + step * 4} y2={56} stroke={C.line} strokeWidth={1.5} strokeDasharray="5 5" />
      <line x1={60} y1={56} x2={60 + step} y2={56} stroke={C.teal} strokeWidth={2} />
      {phases.map((p, i) => {
        const cx = 60 + i * step;
        const fill = p.st === "now" ? C.teal : C.bg;
        const stroke = p.st === "done" || p.st === "now" ? C.teal : C.line;
        return (
          <g key={p.t}>
            <circle cx={cx} cy={56} r={14} fill={fill} stroke={stroke} strokeWidth={1.5} />
            <text x={cx} y={60} textAnchor="middle" fontSize={11} fontWeight={700} fill={p.st === "now" ? C.bg : p.st === "done" ? C.teal : C.mute} fontFamily="var(--font-mono)">
              {p.st === "done" ? "✓" : String(i + 1).padStart(2, "0")}
            </text>
            <text x={cx} y={100} textAnchor="middle" fontSize={13} fontWeight={700} fill={p.st === "later" || p.st === "next" ? C.mute : C.text} fontFamily="var(--font-mono)">
              {p.t}
            </text>
            <text x={cx} y={120} textAnchor="middle" fontSize={10.5} fill={p.st === "now" ? C.teal : C.mute} fontFamily="var(--font-mono)">
              {p.s}
            </text>
          </g>
        );
      })}
    </Frame>
  );
}
