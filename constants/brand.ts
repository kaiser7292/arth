/**
 * Bridges the token layer (`constants/design-tokens.js`, RGB channel triplets) to the values the
 * app's existing JS consumers expect (hex strings, `rgba()` strings).
 *
 * This file is what lets the entire app adopt the new palette without editing 823 accent
 * references: `useColorScheme().accent`, `Colors`, `StatusColors` and the semantic-colour
 * constants are all re-pointed here, so every existing call site renders new values unchanged.
 * The call sites are migrated to `useTheme()` afterwards, at leisure, and this bridge is deleted
 * last — at which point `tsc` proves nothing still depends on it.
 */
import { teal, SEMANTIC, DATA } from "@/constants/design-tokens";
import type { Channels, Scheme, SemanticRole } from "@/constants/design-tokens";

/** "15 118 110" → "#0F766E" */
export function toHex(channels: Channels): string {
  return (
    "#" +
    channels
      .split(/\s+/)
      .map((n) => Number(n).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

/** "15 118 110" → "rgb(15, 118, 110)". React Native needs the comma form. */
export function toRgb(channels: Channels): string {
  return "rgb(" + channels.split(/\s+/).join(", ") + ")";
}

/**
 * "15 118 110", 0.1 → "rgba(15, 118, 110, 0.1)".
 * Replaces the old `acAlpha()` 8-digit-hex trick, which RN accepts but which is inconsistent with
 * how the CSS-variable layer expresses the same thing (`bg-primary/10`).
 */
export function withAlpha(channels: Channels, alpha: number): string {
  return "rgba(" + channels.split(/\s+/).join(", ") + ", " + alpha + ")";
}

/** The single brand ramp, as hex, in the 50–900 shape the legacy `accent` palette used. */
export const BRAND_RAMP = Object.fromEntries(
  Object.entries(teal).map(([shade, channels]) => [shade, toHex(channels)]),
) as Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, string>;

/** Semantic roles resolved to hex for one scheme. */
export function hexRoles(scheme: Scheme): Record<SemanticRole, string> {
  return Object.fromEntries(
    Object.entries(SEMANTIC[scheme]).map(([role, channels]) => [role, toHex(channels)]),
  ) as Record<SemanticRole, string>;
}

export const LIGHT = hexRoles("light");
export const DARK = hexRoles("dark");
export const ROLES: Record<Scheme, Record<SemanticRole, string>> = { light: LIGHT, dark: DARK };

/** Categorical data colours, resolved to hex. Not semantic — see design-tokens.js. */
export const DATA_HEX = {
  accountType: Object.fromEntries(
    Object.entries(DATA.accountType).map(([k, v]) => [k, toHex(v)]),
  ) as Record<string, string>,
  transfer: toHex(DATA.transfer),
  series: DATA.series.map(toHex),
};
