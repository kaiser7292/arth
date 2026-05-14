/**
 * Semantic and status colors used across the app.
 * These are fixed (not accent-dependent) and convey meaning.
 *
 * Note: `STATUS_COLORS` is a light-mode flat palette kept for legacy
 * callers. For new code prefer `StatusColors[colorScheme]` from
 * `constants/theme.ts` which auto-adapts to dark mode (lighter/brighter
 * shades that stay readable on #111111). Both palettes are kept in sync;
 * the `+ "14"` alpha-blended tints render acceptably on both surfaces.
 */

/** Status indicator colors — convey meaning (good/bad/neutral). Never change with accent. */
export const STATUS_COLORS = {
  /** Positive: spending down, savings, under budget, right-spend */
  success: "#10B981",
  /** Caution: moderate utilization, approaching limit */
  warning: "#F59E0B",
  /** Negative: spending up, over budget, debt */
  error: "#EF4444",
  /** Neutral: no significant change */
  neutral: "#6B7280",
  /** Muted: empty state icons, disabled elements */
  muted: "#9CA3AF",
} as const;

/** Returns a status color based on spending change percentage. */
export function changePctColor(pct: number): string {
  if (pct > 10) return STATUS_COLORS.error;
  if (pct < -10) return STATUS_COLORS.success;
  return STATUS_COLORS.neutral;
}

/** Account type categorical colors — fixed, semantically tied to account meaning. */
export const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  savings: STATUS_COLORS.success,
  credit_card: STATUS_COLORS.warning,
  loan: STATUS_COLORS.error,
  wallet: "#8B5CF6",
  demat: "#14B8A6",
  pension: "#6366F1",
};

/** Right-spend score color based on percentage. */
export function rightSpendColor(pct: number): string {
  if (pct >= 70) return STATUS_COLORS.success;
  if (pct >= 50) return STATUS_COLORS.warning;
  return STATUS_COLORS.error;
}

/**
 * Chart / chart-like semantic colors (axis labels, gridlines, point fills).
 * Kept separate from STATUS_COLORS because they convey hierarchy, not meaning.
 */
export const CHART_COLORS = {
  /** Muted tick/grid color (inactive x-axis labels). */
  axisMuted: "#9CA3AF",
  /** Emphasis tick color (latest/current label). */
  axisEmphasis: "#374151",
  /** Point fill stroke (white to pop off background). */
  pointStroke: "#FFFFFF",
} as const;

/** Transfers between owned accounts — distinct from spend (red) or credits (green). */
export const TRANSFER_COLOR = "#8B5CF6";
