/**
 * LEGACY semantic/status colour surface, retained during the design revamp.
 *
 * Every value is now DERIVED from `constants/design-tokens.js`. New code should use `useTheme()`
 * from `@/hooks/use-theme`; this module is deleted once the sweep finishes.
 *
 * RESOLVED — the two-greens bug. This file previously declared `success: "#10B981"` while
 * `constants/theme.ts` declared `#22C55E`, under a comment claiming "Both palettes are kept in
 * sync." They were not, and the app rendered two different greens for the same meaning depending
 * on which module a screen imported. Both now resolve to the single `success` token, which is also
 * darkened to clear WCAG AA (the old greens were 2.3:1 and 3.0:1 on white and failed as text).
 */
import { LIGHT, DATA_HEX } from "@/constants/brand";

/** Status indicator colours — convey meaning (good/bad/neutral). */
export const STATUS_COLORS = {
  /** Positive: spending down, savings, under budget, right-spend */
  success: LIGHT.success,
  /** Caution: moderate utilization, approaching limit */
  warning: LIGHT.warning,
  /** Negative: spending up, over budget, debt */
  error: LIGHT.danger,
  /** Neutral: no significant change */
  neutral: LIGHT.mutedForeground,
  /** Muted: empty state icons, disabled elements */
  muted: LIGHT.faintForeground,
} as const;

/** Returns a status colour based on spending change percentage. */
export function changePctColor(pct: number): string {
  if (pct > 10) return STATUS_COLORS.error;
  if (pct < -10) return STATUS_COLORS.success;
  return STATUS_COLORS.neutral;
}

/** Account type categorical colours — fixed, semantically tied to account meaning. */
export const ACCOUNT_TYPE_COLORS: Record<string, string> = DATA_HEX.accountType;

/** Right-spend score colour based on percentage. */
export function rightSpendColor(pct: number): string {
  if (pct >= 70) return STATUS_COLORS.success;
  if (pct >= 50) return STATUS_COLORS.warning;
  return STATUS_COLORS.error;
}

/**
 * Chart colours (axis labels, gridlines, point fills). Separate from STATUS_COLORS because they
 * convey hierarchy, not meaning.
 */
export const CHART_COLORS = {
  /** Muted tick/grid colour (inactive x-axis labels). */
  axisMuted: LIGHT.faintForeground,
  /** Emphasis tick colour (latest/current label). */
  axisEmphasis: LIGHT.foreground,
  /** Point fill stroke, to pop off the chart background. */
  pointStroke: LIGHT.card,
} as const;

/** Transfers between owned accounts — distinct from spend (red) or credits (green). */
export const TRANSFER_COLOR = DATA_HEX.transfer;
