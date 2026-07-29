/** Soften vivid crew/block hex colors for Gantt bars. */

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Mix toward slate and pull saturation down so zakres bars stay colored
 * but less neon on the board (works for light + dark chrome).
 */
export function softenScheduleColor(hex: string, amount = 0.38): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  // Desaturate toward luminance, then nudge toward soft slate.
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const satPull = 0.45;
  let nr = r + (lum - r) * satPull;
  let ng = g + (lum - g) * satPull;
  let nb = b + (lum - b) * satPull;
  const tr = 110;
  const tg = 118;
  const tb = 138;
  nr = nr + (tr - nr) * amount;
  ng = ng + (tg - ng) * amount;
  nb = nb + (tb - nb) * amount;
  return toHex(nr, ng, nb);
}
