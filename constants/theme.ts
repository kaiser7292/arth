import { Platform } from "react-native";
import { BRAND_RAMP, LIGHT, DARK, withAlpha } from "@/constants/brand";
import { SEMANTIC } from "@/constants/design-tokens";

/**
 * LEGACY colour surface, retained during the design revamp.
 *
 * Every value below is now DERIVED from `constants/design-tokens.js` rather than hardcoded, so the
 * ~700 existing `Colors[...]` / `StatusColors[...]` call sites render the new palette without being
 * edited. New code should use `useTheme()` from `@/hooks/use-theme` instead; this module is deleted
 * once the sweep finishes, at which point `tsc` proves nothing still imports it.
 */

export const Colors = {
  /** Brand ramp. Formerly a hardcoded blue; now the single brand ramp from the tokens. */
  primary: BRAND_RAMP,

  budget: {
    under: LIGHT.success,
    warning: LIGHT.warning,
    over: LIGHT.danger,
  },

  /**
   * Note one deliberate correction: `surface` was #F7F7F5 against a #F9F9F7 `background`, i.e. a
   * card DARKER than the screen it sat on. Cards now sit lighter than their ground in light mode.
   */
  light: {
    text: LIGHT.foreground,
    textSecondary: LIGHT.mutedForeground,
    background: LIGHT.background,
    surface: LIGHT.card,
    border: LIGHT.border,
    tint: LIGHT.primary,
    icon: LIGHT.mutedForeground,
    tabIconDefault: LIGHT.faintForeground,
    tabIconSelected: LIGHT.primary,
    blue: LIGHT.primary,
  },

  dark: {
    text: DARK.foreground,
    textSecondary: DARK.mutedForeground,
    background: DARK.background,
    surface: DARK.card,
    border: DARK.border,
    tint: DARK.primary,
    icon: DARK.mutedForeground,
    tabIconDefault: DARK.faintForeground,
    tabIconSelected: DARK.primary,
    blue: DARK.primary,
  },
};

/** Cross-platform elevation presets. Not colour — untouched by the token migration. */
export const Shadows = {
  card: Platform.select({
    ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
    default: { elevation: 2 },
  }),
  dropdown: Platform.select({
    ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12 },
    default: { elevation: 4 },
  }),
  fab: Platform.select({
    ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12 },
    default: { elevation: 8 },
  }),
  tabBar: Platform.select({
    ios: { shadowColor: "#000", shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.05, shadowRadius: 8 },
    default: { elevation: 4 },
  }),
} as const;

/**
 * Status colours. The `*Bg` tints were previously 8-digit hex suffixes ("#22C55E14"); they are now
 * real rgba, which is what the `bg-success/8` class compiles to on the CSS side.
 *
 * Two corrections carried in from the contrast audit, both of which will look like changes on
 * device and are fixes rather than regressions:
 *   - success was #22C55E — 2.3:1 on white, failing WCAG AA, while used as text in 41 places.
 *   - warning was #F59E0B — 2.1:1, used as a label in 43 places. Raw amber is now fills-only
 *     (`accentSolid`); the darkened `warning` role is what text uses.
 */
export const StatusColors = {
  light: {
    success: LIGHT.success,
    successBg: withAlpha(SEMANTIC.light.success, 0.08),
    danger: LIGHT.danger,
    dangerBg: withAlpha(SEMANTIC.light.danger, 0.08),
    warning: LIGHT.warning,
    warningBg: withAlpha(SEMANTIC.light.warning, 0.08),
    muted: LIGHT.faintForeground,
  },
  dark: {
    success: DARK.success,
    successBg: withAlpha(SEMANTIC.dark.success, 0.08),
    danger: DARK.danger,
    dangerBg: withAlpha(SEMANTIC.dark.danger, 0.08),
    warning: DARK.warning,
    warningBg: withAlpha(SEMANTIC.dark.warning, 0.08),
    muted: DARK.faintForeground,
  },
} as const;
