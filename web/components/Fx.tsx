"use client";
import { useEffect, type ComponentPropsWithoutRef, type ElementType } from "react";

/**
 * Site-wide motion helpers, mounted once in the Shell:
 * - scroll reveals: an element with `data-reveal` that starts below the viewport is "armed"
 *   (hidden) and fades/slides in when it scrolls into view. Elements already on screen are never
 *   hidden, so server-rendered content paints at once and nothing shifts. Children of a
 *   `data-reveal-group` parent are staggered by index.
 * - pointer glow: elements with the `glow` class get --mx/--my set to the pointer position.
 * Both are skipped when the visitor prefers reduced motion.
 */
export default function Fx() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cleanupReveal: (() => void) | undefined;

    if (!reduced && "IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        },
        { rootMargin: "0px 0px -6% 0px", threshold: 0.06 }
      );
      const seen = new WeakSet<Element>();
      const scan = () => {
        const vh = window.innerHeight;
        document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => {
          if (seen.has(el)) return;
          seen.add(el);
          if (el.getBoundingClientRect().top < vh * 0.94) return; // already visible: leave it alone
          const group = el.parentElement;
          if (group?.hasAttribute("data-reveal-group")) {
            const sibs = Array.from(group.children).filter((c) => c.hasAttribute("data-reveal"));
            el.style.setProperty("--rv-i", String(Math.min(sibs.indexOf(el), 8)));
          }
          el.classList.add("rv-armed");
          io.observe(el);
        });
      };
      scan();
      let queued = false;
      const mo = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          scan();
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
      cleanupReveal = () => {
        io.disconnect();
        mo.disconnect();
      };
    }

    // pointer glow: one delegated listener for the whole page
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = (e.target as Element | null)?.closest?.<HTMLElement>(".glow");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    if (!reduced) document.addEventListener("pointermove", move, { passive: true });
    return () => {
      document.removeEventListener("pointermove", move);
      cleanupReveal?.();
    };
  }, []);
  return null;
}

/** Convenience wrapper: a block that reveals on scroll. */
export function Reveal<T extends ElementType = "div">({ as, ...rest }: { as?: T } & ComponentPropsWithoutRef<T>) {
  const Tag = (as ?? "div") as ElementType;
  return <Tag data-reveal="" {...rest} />;
}
