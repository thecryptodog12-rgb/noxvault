"use client";

export default function TreeProgress({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between text-[12px] text-mute">
        <span>{label}</span>
        <span>
          {done}/{total} keys · {pct}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-teal transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-dim">Building the one-time key tree in your browser (runs once; the public part is cached on this device).</p>
    </div>
  );
}
