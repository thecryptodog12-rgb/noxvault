"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Renders `fallback` until the box comes within `margin` of the viewport, then `children`.
 * Pair it with next/dynamic so a heavy component's code is only fetched when it is about to be
 * seen. Give the fallback the same size as the real thing to avoid layout shift.
 */
export default function LazyOnView({ children, fallback, margin = "300px", className }: { children: ReactNode; fallback: ReactNode; margin?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) return setOn(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setOn(true);
          io.disconnect();
        }
      },
      { rootMargin: margin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return (
    <div ref={ref} className={className}>
      {on ? children : fallback}
    </div>
  );
}
