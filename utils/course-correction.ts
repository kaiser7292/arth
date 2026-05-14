/**
 * Course Correction Alert Logic — Task 8.1
 *
 * Determines when to show alert banners based on savings trajectory.
 * Threshold: alert when actual savings rate drops >5% below target.
 */

import { formatAmount } from "./format";

export type AlertSeverity = "info" | "warning" | "critical";

export interface CourseCorrectionAlert {
  /** Should an alert be shown? */
  shouldAlert: boolean;
  /** Alert severity based on gap magnitude */
  severity: AlertSeverity;
  /** Gap between target and actual savings rate (positive = behind) */
  rateGapPct: number;
  /** Amount behind the prorated target savings */
  amountBehind: number;
  /** Extra per month needed to get back on track */
  extraPerMonth: number;
  /** Months remaining to correct */
  monthsRemaining: number;
  /** Human-readable alert message */
  message: string;
}

export interface CourseCorrectionInput {
  actualSavingsRatePct: number;
  targetSavingsRatePct: number;
  savingsGap: number;
  courseCorrectionPerMonth: number;
  avgMonthlySavings: number;
  monthsRemaining: number;
}

/**
 * Evaluate whether a course correction alert should be triggered.
 *
 * Rules:
 * - No alert if on track (actual rate >= target rate)
 * - Info alert if gap is 0-5%
 * - Warning alert if gap is 5-10%
 * - Critical alert if gap is >10%
 * - shouldAlert = true only when gap > 5% (per acceptance criteria)
 */
export function evaluateCourseCorrection(
  input: CourseCorrectionInput,
): CourseCorrectionAlert {
  const {
    actualSavingsRatePct,
    targetSavingsRatePct,
    savingsGap,
    courseCorrectionPerMonth,
    avgMonthlySavings,
    monthsRemaining,
  } = input;

  const rateGapPct = targetSavingsRatePct - actualSavingsRatePct;
  const amountBehind = Math.abs(Math.min(savingsGap, 0));
  const extraPerMonth = Math.max(courseCorrectionPerMonth - avgMonthlySavings, 0);

  // On track or ahead
  if (rateGapPct <= 0) {
    return {
      shouldAlert: false,
      severity: "info",
      rateGapPct: 0,
      amountBehind: 0,
      extraPerMonth: 0,
      monthsRemaining,
      message: "",
    };
  }

  // Determine severity
  let severity: AlertSeverity;
  if (rateGapPct > 10) {
    severity = "critical";
  } else if (rateGapPct > 5) {
    severity = "warning";
  } else {
    severity = "info";
  }

  // Only trigger visible alert when gap exceeds 5%
  const shouldAlert = rateGapPct > 5;

  // Build message
  let message: string;
  if (monthsRemaining <= 0) {
    message = `You ended the year ${formatAmount(amountBehind)} behind your savings target.`;
  } else if (severity === "critical") {
    message = `You're ${formatAmount(amountBehind)} behind target. Save ${formatAmount(Math.round(extraPerMonth))} extra/month for ${monthsRemaining} months to recover.`;
  } else {
    message = `You're slightly behind. Save ${formatAmount(Math.round(extraPerMonth))} extra/month to get back on track.`;
  }

  return {
    shouldAlert,
    severity,
    rateGapPct: Math.round(rateGapPct * 10) / 10,
    amountBehind: Math.round(amountBehind),
    extraPerMonth: Math.round(extraPerMonth),
    monthsRemaining,
    message,
  };
}

