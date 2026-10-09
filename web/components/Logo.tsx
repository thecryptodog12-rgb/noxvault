// Pixel mark: a crescent moon inside a vault frame, drawn as SVG squares.
const MOON = [
  "....###.......",
  "..###.........",
  ".###..........",
  ".###..........",
  "###...........",
  "###...........",
  "####..........",
  "####..........",
  "#####.......#.",
  ".#####.....##.",
  ".############.",
  "..##########..",
  "...########...",
  ".....####.....",
];
const STAR: [number, number][] = [
  [10, 2], [9, 3], [10, 3], [11, 3], [10, 4],
];
const SIZE = 20; // frame 20×20, moon at offset 3

function frame(): [number, number][] {
  const px: [number, number][] = [];
  for (let i = 1; i < SIZE - 1; i++) {
    px.push([i, 0], [i, SIZE - 1], [0, i], [SIZE - 1, i]);
  }
  // bolts
  px.push([2, 2], [SIZE - 3, 2], [2, SIZE - 3], [SIZE - 3, SIZE - 3]);
  return px;
}

const MOON_PX: [number, number][] = MOON.flatMap((row, y) =>
  [...row].flatMap((c, x) => (c === "#" ? [[x + 3, y + 3] as [number, number]] : []))
);
const FRAME_PX = frame();

export function Mark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      shapeRendering="crispEdges"
      className={className}
      aria-hidden
    >
      {FRAME_PX.map(([x, y]) => (
        <rect key={`f${x}-${y}`} x={x} y={y} width={1} height={1} fill="#3a3a44" />
      ))}
      {MOON_PX.map(([x, y]) => (
        <rect key={`m${x}-${y}`} x={x} y={y} width={1} height={1} fill="#e9e6df" />
      ))}
      {STAR.map(([x, y]) => (
        <rect key={`s${x}-${y}`} x={x + 3} y={y + 3} width={1} height={1} fill="#b8a6ff" />
      ))}
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display text-[18px] tracking-wide ${className}`}>
      NOX<span className="text-moon">/</span>VAULT
    </span>
  );
}
