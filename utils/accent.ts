/**
 * Accent color utilities for dynamic theme support.
 * Use with the `accent` palette from `useColorScheme()`.
 */
import type { AccentPalette } from "@/constants/accent-palettes";

type Shade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
type Mode = "light" | "dark";

/** Pick the right shade for the current color mode */
export function ac(p: AccentPalette, mode: Mode, light: Shade, dark: Shade): string {
  return mode === "dark" ? p[dark] : p[light];
}

/** Accent color with alpha (e.g. acAlpha(accent, 500, 0.1) → "#3B82F61A") */
export function acAlpha(p: AccentPalette, shade: Shade, alpha: number): string {
  const hex = Math.round(alpha * 255).toString(16).padStart(2, "0").toUpperCase();
  return p[shade] + hex;
}
