"use client";
import { useEffect, useState } from "react";

/** Counts from 0 to `value` once, when first shown. Reduced motion: shows the value at once. */
export default function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const dur = 1100;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      setShown(value * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}
