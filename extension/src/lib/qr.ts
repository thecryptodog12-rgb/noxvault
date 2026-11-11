// QR code for the deposit address, generated locally (no network). Returns an SVG string with dark
// modules on a light quiet zone, which every phone scanner reads.
import qrcode from "qrcode-generator";

export function qrSvg(text: string, opts: { dark?: string; light?: string } = {}): string {
  const dark = opts.dark ?? "#03070a";
  const light = opts.light ?? "#e6f0ef";
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const margin = 3;
  const size = n + margin * 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${size}" height="${size}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
