// The whitepaper (docs/WHITEPAPER.md, copied to content/ by predev/prebuild) in the site design:
// cover hero, sticky contents, styled tables, figures with captions and the three diagrams as SVG.
import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { Marked, type Tokens } from "marked";
import { DesignFlow, EscapeFlow, RoadmapDiagram, FlywheelDiagram } from "./Diagrams";
import PrintButton from "./PrintButton";

export const metadata: Metadata = {
  title: "Whitepaper — Noxvault",
  description: "Noxvault: hash-based vaults for a post-quantum Solana. Design, Escape Hatch, $NOX, tokenomics, roadmap and risks.",
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function readMarkdown(): string {
  for (const p of [path.join(process.cwd(), "content/WHITEPAPER.md"), path.join(process.cwd(), "../docs/WHITEPAPER.md")]) {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {}
  }
  return "# Whitepaper\n\nThe whitepaper could not be loaded.";
}

interface Section {
  id: string;
  title: string;
  html: string;
}

function parse(md: string): { title: string; cover: { src: string; alt: string } | null; intro: string; sections: Section[] } {
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      image({ href, text }: Tokens.Image) {
        return `<figure class="wp-figure"><img src="${href}" alt="${text}" loading="lazy" /><figcaption>${text}</figcaption></figure>`;
      },
      table(token: Tokens.Table) {
        const head = token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join("");
        const rows = token.rows.map((r) => `<tr>${r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`).join("");
        return `<div class="wp-table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
      },
    },
  });
  const lines = md.split("\n");
  const title = (lines.find((l) => l.startsWith("# ")) ?? "# Noxvault").slice(2).trim();
  const body = lines.filter((l) => !l.startsWith("# ")).join("\n");
  const coverMatch = /!\[([^\]]*)\]\((\/whitepaper\/cover\.jpg)\)/.exec(body);
  const withoutCover = coverMatch ? body.replace(coverMatch[0], "") : body;
  const parts = withoutCover.split(/^## /m);
  const intro = marked.parse(parts[0]) as string;
  const sections = parts.slice(1).map((p) => {
    const nl = p.indexOf("\n");
    const t = p.slice(0, nl).trim();
    return { id: slug(t), title: t, html: marked.parse(p.slice(nl + 1)) as string };
  });
  return { title, cover: coverMatch ? { alt: coverMatch[1], src: coverMatch[2] } : null, intro, sections };
}

const DIAGRAMS: Record<string, React.ReactNode> = {
  design: <DesignFlow />,
  "escape-hatch-canary-and-registry": <EscapeFlow />,
  roadmap: <RoadmapDiagram />,
  "the-flywheel": <FlywheelDiagram />,
};

export default function WhitepaperPage() {
  const { title, cover, intro, sections } = parse(readMarkdown());
  return (
    <div className="wp">
      {cover && (
        <div className="relative -mx-4 -mt-6 mb-10 overflow-hidden border-b border-line md:-mx-10 md:-mt-8 xl:-mx-16">
          {/* the cover carries the title itself; the h1 is for screen readers and search */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover.src} alt={cover.alt} className="block w-full object-cover" />
          <h1 className="sr-only">{title}</h1>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-ink to-transparent" />
        </div>
      )}
      <div className="grid gap-10 lg:grid-cols-[230px_1fr] [&>*]:min-w-0">
        <nav className="hidden lg:block print:hidden" aria-label="Contents">
          <div className="sticky top-24 flex flex-col gap-1 text-[12px]">
            <div className="label mb-2">contents</div>
            {sections.map((s, i) => (
              <a key={s.id} href={`#${s.id}`} className="text-mute hover:text-teal">
                <span className="text-dim">{String(i + 1).padStart(2, "0")}</span> {s.title}
              </a>
            ))}
            <div className="mt-4">
              <PrintButton />
            </div>
          </div>
        </nav>
        <article className="wp-body max-w-[820px]">
          {!cover && <h1 className="mb-6 text-[32px] font-bold">{title}</h1>}
          <div dangerouslySetInnerHTML={{ __html: intro }} />
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <h2>{s.title}</h2>
              {s.id === "design" ? (
                <>
                  <div dangerouslySetInnerHTML={{ __html: s.html }} />
                  {DIAGRAMS[s.id]}
                </>
              ) : DIAGRAMS[s.id] ? (
                <>
                  {DIAGRAMS[s.id]}
                  <div dangerouslySetInnerHTML={{ __html: s.html }} />
                </>
              ) : (
                <div dangerouslySetInnerHTML={{ __html: s.html }} />
              )}
            </section>
          ))}
          <div className="mt-10 lg:hidden print:hidden">
            <PrintButton />
          </div>
        </article>
      </div>
    </div>
  );
}
