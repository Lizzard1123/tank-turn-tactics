// Emoji-free inline SVG icons used across the UI.
// SVG markup strings (no JSX) rendered through a single small span so
// `stroke="currentColor"` inherits the surrounding text color.

// Renders an icon string inline; stroke="currentColor" inherits text color.
export function Icon({ html, className, width = 14, height = 14 }: { html: string; className?: string; width?: number; height?: number }) {
  const style = { width, height, display: 'inline-block', verticalAlign: '-0.1em' };
  const inner = { __html: html };
  return <span dangerouslySetInnerHTML={inner} className={className} style={style} />;
}

// Attributes are hyphenated (raw SVG markup, not JSX props) because these
// strings are injected via innerHTML, where camelCase names would be ignored.
const svg = (inner: string) =>
  `<svg width="100%" height="100%" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none" aria-hidden="true">${inner}</svg>`;

const heartPath = "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3.05 1.29-3.8 2.8c-0.75-1.51-2.04-2.8-3.8-2.8A5.5 5.5 0 0 0 2 8.5c0 2.3 1.51 4.04 3 5.5l7 7.3 7-7.3c1.49-1.46 3-3.21 3-5.5z";

export const heartSvg = svg(`<path d="${heartPath}" />`);
export const boltSvg = svg(`<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />`);
export const targetSvg = svg(`
  <circle cx="12" cy="12" r="10" />
  <circle cx="12" cy="12" r="6" />
  <circle cx="12" cy="12" r="2" />
`);
export const robotSvg = svg(`
  <rect x="3" y="2" width="18" height="16" rx="2" />
  <line x1="9" y1="8" x2="15" y2="8" />
  <rect x="9" y="12" width="2" height="2" />
  <rect x="13" y="12" width="2" height="2" />
`);
export const skullSvg = svg(`
  <circle cx="12" cy="9" r="5" />
  <path d="M7 14v1a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4v-1" />
  <line x1="10" y1="14" x2="14" y2="14" />
  <line x1="8" y1="11" x2="16" y2="11" />
`);
export const trophySvg = svg(`
  <path d="M9 17c0-2 2-3 5-3s5 1 5 3" />
  <path d="M9 17h6v3H9z" />
  <path d="M7 6h10v10H7z" />
  <path d="M6 14h12" />
`);
export const flagSvgIcon = svg(`
  <rect x="2" y="3" width="14" height="18" />
  <line x1="2" y1="8" x2="16" y2="8" />
  <line x1="2" y1="13" x2="16" y2="13" />
`);
