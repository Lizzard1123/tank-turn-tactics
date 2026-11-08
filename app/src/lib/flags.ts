// Deterministic, emoji-free world flags generated from a player id.
// Each flag is an inline SVG string (no external assets, no npm dependency).
// Suitable for use as an <image href="data:image/svg+xml;utf8,…"> source.
// The same id always yields the same flag, so opponents see a consistent marker.

const PALETTE = [
  '#c8471f', // signal
  '#a07a1e', // brass
  '#3f6b3a', // radio
  '#a03024', // rust
  '#6b6a4f', // olive
  '#26251d', // ink
  '#b44a2c', // burnt orange
  '#7a5a14', // dark brass
  '#2e4a27', // dark radio
  '#e9e2cf', // paper
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return h;
}

function pick(h: number, arr: string[]): string {
  return arr[Math.abs(h) % arr.length];
}

function rect(x: number, y: number, w: number, h: number, fill: string): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" />`;
}

function circle(cx: number, cy: number, r: number, fill: string): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" />`;
}

export function flagSvg(playerId: string, size = 120): string {
  const h = hashId(playerId);
  const c1 = pick(h, PALETTE);
  const c2 = pick(h >>> 7, PALETTE);
  const c3 = pick(h >>> 14, PALETTE);
  const w = size;
  const hh = size;
  const third = hh / 3;
  const half = w / 2;

  const stripeH = `
    ${rect(0, 0, w, third, c1)}
    ${rect(0, third, w, third, c2)}
    ${rect(0, 2 * third, w, third, c3)}
  `;

  const stripeV = `
    ${rect(0, 0, w / 3, hh, c1)}
    ${rect(w / 3, 0, w / 3, hh, c2)}
    ${rect((2 * w) / 3, 0, w / 3, hh, c3)}
  `;

  const crossW = w / 6;
  const cross = `
    ${rect(0, (hh - crossW) / 2, w, crossW, c1)}
    ${rect((w - crossW) / 2, 0, crossW, hh, c2)}
  `;

  const circleFlag = `
    ${rect(0, 0, w, hh, c1)}
    ${circle(half, half, w / 4, c2)}
  `;

  const diag = `
    ${rect(0, 0, w, hh, c1)}
    <polygon points="0,0 ${w},0 ${w},${hh}" fill="${c2}" />
  `;

  const layouts = [stripeH, stripeV, cross, circleFlag, diag];
  const body = layouts[Math.abs(h) % layouts.length];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}">${body}</svg>`;
}

// Profile-page alias (E6 call sites): same deterministic flag at 96px.
export function flagForPlayerId(playerId: string): string {
  return flagSvg(playerId, 96);
}
