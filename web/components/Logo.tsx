// Noxvault mark: a hexagon outline with an inner facet, drawn as a teal line icon.
export function Mark({ size = 30, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path d="M16 2.5 27.7 9.25v13.5L16 29.5 4.3 22.75V9.25L16 2.5Z" stroke="#2ee6d6" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M16 8.5 22.5 16 16 23.5 9.5 16 16 8.5Z" stroke="#e6f0ef" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9.5 16h13" stroke="#2ee6d6" strokeOpacity=".5" strokeWidth="1" />
    </svg>
  );
}

export function Wordmark({ className = "", meta = true }: { className?: string; meta?: boolean }) {
  return (
    <span className={`flex items-baseline gap-3 ${className}`}>
      <span className="text-[19px] font-bold tracking-[0.22em] text-bone">NOXVAULT</span>
      {meta && <span className="hidden text-[12px] tracking-[0.08em] text-dim 2xl:inline">{"// v2.0 // SOLANA"}</span>}
    </span>
  );
}
