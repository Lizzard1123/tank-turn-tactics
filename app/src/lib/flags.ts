// Deterministic "world flag" for a player, derived from the player id.
// Pure geometry — no emoji, no letter — returned as an inline SVG string.
// The same id always yields the same flag, so opponents see a consistent marker.

const PALETTE: readonly string[] = [
  '#c8471f', // signal red-orange
  '#1f4e79', // deep blue
  '#d4af37', // gold
  '#2d5a27', // forest green
  '#b22222', // firebrick
  '#4b0082', // indigo
  '#ffd700', // yellow
  '#ffffff', // white
  '#000000', // black
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return hash;
}

function pick(seed: number, options: readonly string[]): string {
  return options[Math.abs(seed) % options.length];
}

// Layouts: 0 = horizontal tricolor, 1 = vertical tricolor, 2 = nordic cross.
export function flagForPlayerId(playerId: string): string {
  const h = hashString(playerId);
  const c1 = pick(h, PALETTE);
  const c2 = pick(h >> 7, PALETTE);
  const c3 = pick(h >> 14, PALETTE);
  const layout = Math.abs(h) % 3;

  const W = 96;
  const H = 96;

  let body: string;
  if (layout === 0) {
    const third = H / 3;
    body = [
      `<rect x="0" y="0" width="${W}" height="${third}" fill="${c1}" />`,
      `<rect x="0" y="${third}" width="${W}" height="${third}" fill="${c2}" />`,
      `<rect x="0" y="${2 * third}" width="${W}" height="${third}" fill="${c3}" />`,
    ].join('');
  } else if (layout === 1) {
    const third = W / 3;
    body = [
      `<rect x="0" y="0" width="${third}" height="${H}" fill="${c1}" />`,
      `<rect x="${third}" y="0" width="${third}" height="${H}" fill="${c2}" />`,
      `<rect x="${2 * third}" y="0" width="${third}" height="${H}" fill="${c3}" />`,
    ].join('');
  } else {
    const stroke = W / 6;
    const cx = W / 2 - stroke / 2;
    const cy = H / 2 - stroke / 2;
    body = [
      `<rect x="0" y="0" width="${W}" height="${H}" fill="${c1}" />`,
      `<rect x="${cx}" y="0" width="${stroke}" height="${H}" fill="${c2}" />`,
      `<rect x="0" y="${cy}" width="${W}" height="${stroke}" fill="${c2}" />`,
    ].join('');
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="player flag">${body}</svg>`;
}
