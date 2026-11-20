/**
 * cookclub icons: drawn on a 24pt grid at SF Symbols semibold weight (2.2
 * stroke). Each has an outline (default) and filled (selected) form.
 *
 * The first four are the signature set (the tab icons). The rest are everyday UI icons
 * (search, notifications, like, comment, save, open link) drawn at the same
 * weight so they sit evenly next to each other.
 *
 * The markup is single-colour (`currentColor`) so it can be tinted. Holes in
 * filled icons are masks, not white shapes, so tinting never covers them.
 *
 * This file is the source of truth for both <SignatureIcon> (in-app, via
 * react-native-svg) and the tab bar PNGs (`bun run icons:build`).
 */

const STROKE =
  'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';

const HEART =
  "M12 12.3s-2.8-1.6-2.8-3.5a1.4 1.4 0 0 1 2.8-.5 1.4 1.4 0 0 1 2.8.5c0 1.9-2.8 3.5-2.8 3.5Z";

const PLAN_DOTS = [
  [8, 14],
  [12, 14],
  [16, 14],
  [8, 17.5],
  [12, 17.5],
  [16, 17.5],
]
  .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="1.25"/>`)
  .join("");

const CART_BODY =
  "M5.5 6h14.2c.7 0 1.2.7 1 1.3l-1.5 5.9a2.2 2.2 0 0 1-2.1 1.7H9a2.2 2.2 0 0 1-2.1-1.7Z";

const BELL = "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9";
const HEART_LARGE =
  "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z";
const BUBBLE = "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z";
const PLUS = "M12 4.5v15M4.5 12h15";
const CHECK = "m4.5 12.5 5 5 10-11";
const ARROW_UP_RIGHT = "M7 17 17 7M8 7h9v9";

/** A mask that keeps everything except `holes` (drawn in black). */
const mask = (id: string, holes: string) =>
  `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/>${holes}</mask></defs>`;

export const SIGNATURE_ICONS = {
  home: {
    outline: `<g ${STROKE}><path d="M2.5 11 12 3l9.5 8"/><path d="M4.5 9.5V19a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V9.5"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/></g>`,
    filled: `<g ${STROKE}><path d="M2.5 11 12 3l9.5 8"/><path d="M4.5 9.7 12 3.6l7.5 6.1V19a2 2 0 0 1-2 2H14v-4a2 2 0 0 0-4 0v4H6.5a2 2 0 0 1-2-2Z" fill="currentColor"/></g>`,
  },
  recipes: {
    outline: `<g ${STROKE}><path d="M19.5 16.5H6.75a2.25 2.25 0 0 0 0 4.5H19.5V3H7a2.5 2.5 0 0 0-2.5 2.5v13.25"/><path d="${HEART}" fill="currentColor" stroke-width="1"/></g>`,
    filled: `${mask("recipes-heart", `<path d="${HEART}" fill="#000" stroke="#000" stroke-width="1" stroke-linejoin="round"/>`)}<g ${STROKE} mask="url(#recipes-heart)"><path d="M19.5 3H7a2.5 2.5 0 0 0-2.5 2.5v11h15Z" fill="currentColor"/><path d="M19.5 16.5H6.75a2.25 2.25 0 0 0 0 4.5H19.5M4.5 5.5v13.25"/></g>`,
  },
  plan: {
    outline: `<g ${STROKE}><rect x="3" y="5" width="18" height="16" rx="3.5"/><path d="M8 3v4M16 3v4M3 10h18"/></g><g fill="currentColor">${PLAN_DOTS}</g>`,
    filled: `${mask("plan-dots", `<g fill="#000">${PLAN_DOTS}</g>`)}<g ${STROKE}><rect x="3" y="5" width="18" height="16" rx="3.5" fill="currentColor" mask="url(#plan-dots)"/><path d="M8 3v4M16 3v4"/></g>`,
  },
  shop: {
    outline: `<g ${STROKE}><path d="M2.5 3.5h1.6c.5 0 .9.3 1 .8L5.5 6"/><path d="${CART_BODY}"/><circle cx="9.5" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/></g>`,
    filled: `<g ${STROKE}><path d="M2.5 3.5h1.6c.5 0 .9.3 1 .8L5.5 6"/><path d="${CART_BODY}" fill="currentColor"/><circle cx="9.5" cy="19.5" r="1.5" fill="currentColor"/><circle cx="17" cy="19.5" r="1.5" fill="currentColor"/></g>`,
  },

  // ─── Everyday UI icons, matched to the signature weight ───────────────────
  search: {
    outline: `<g ${STROKE}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></g>`,
    filled: `<g ${STROKE}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></g>`,
  },
  bell: {
    outline: `<g ${STROKE}><path d="${BELL}"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></g>`,
    filled: `<g ${STROKE}><path d="${BELL}" fill="currentColor"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></g>`,
  },
  heart: {
    outline: `<g ${STROKE}><path d="${HEART_LARGE}"/></g>`,
    filled: `<g ${STROKE}><path d="${HEART_LARGE}" fill="currentColor"/></g>`,
  },
  comment: {
    outline: `<g ${STROKE}><path d="${BUBBLE}"/></g>`,
    filled: `<g ${STROKE}><path d="${BUBBLE}" fill="currentColor"/></g>`,
  },
  // Add to your recipes: a plus, which becomes a tick once it's there
  // (the same pairing as adding to a library in Apple Music).
  addToLibrary: {
    outline: `<g ${STROKE}><path d="${PLUS}"/></g>`,
    filled: `<g ${STROKE}><path d="${CHECK}"/></g>`,
  },
  // "Opens outside the app". A chevron would mean another screen in the app.
  external: {
    outline: `<g ${STROKE}><path d="${ARROW_UP_RIGHT}"/></g>`,
    filled: `<g ${STROKE}><path d="${ARROW_UP_RIGHT}"/></g>`,
  },
} as const;

export type SignatureIconName = keyof typeof SIGNATURE_ICONS;
export type SignatureIconVariant = "outline" | "filled";

export function signatureIconSvg(
  name: SignatureIconName,
  variant: SignatureIconVariant,
  { size = 24, color = "currentColor" }: { size?: number; color?: string } = {},
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" color="${color}">${SIGNATURE_ICONS[name][variant]}</svg>`;
}
