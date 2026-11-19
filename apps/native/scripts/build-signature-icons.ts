/**
 * Renders the signature icons used in the native tab bar to template PNGs
 * (@1x/@2x/@3x). The tab bar tints them, so they're drawn in black on
 * transparent. Re-run after changing src/components/icons/signatureIcons.ts:
 *
 *   bun run icons:build
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

import {
  signatureIconSvg,
  type SignatureIconName,
} from "../src/components/icons/signatureIcons";

// Matches the optical size of SF Symbols in a UITabBar.
const TAB_ICON_POINTS = 26;
const TAB_ICONS: SignatureIconName[] = ["home", "recipes", "plan", "shop"];
const OUT_DIR = join(import.meta.dirname, "../src/assets/icons/tabs");

mkdirSync(OUT_DIR, { recursive: true });

for (const name of TAB_ICONS) {
  for (const variant of ["outline", "filled"] as const) {
    for (const scale of [1, 2, 3]) {
      const size = TAB_ICON_POINTS * scale;
      const svg = signatureIconSvg(name, variant, { size, color: "#000" });
      const suffix = scale === 1 ? "" : `@${scale}x`;
      await sharp(Buffer.from(svg), { density: 72 * scale })
        .resize(size, size)
        .png()
        .toFile(join(OUT_DIR, `${name}-${variant}${suffix}.png`));
    }
  }
}
console.log(`Wrote ${TAB_ICONS.length * 6} tab icons to ${OUT_DIR}`);
