/**
 * Bills and subscriptions, for Insights → Where it goes → Regulars
 * (docs/INSIGHTS_STREAMLINE_PROPOSAL.md §2.3). Built only from what Arth already learns: the
 * regular payments in expense_classifications (pattern-learner.ts) and the Budget tab's spending
 * rows. Nothing is stored.
 *
 *  - The month's usual total: each active bill's usual amount, as a monthly figure.
 *  - "Went up": the latest payment to a regular is above the amount it usually charges.
 *  - "Stopped?": a monthly regular hasn't come for a month and a few days since its last payment.
 */

import { DEFAULT_USER_ID } from "@/constants/app";
import { getPatternLibrary } from "@/services/analytics/pattern-learner";
import type { ExpenseClassificationRow } from "@/services/analytics/classifier";
import { getSpendingRows } from "@/services/analytics/spending-rows";
import { normalizeMerchant } from "@/services/smart-categorizer";
import { toIsoDate } from "@/utils/date";

export interface Regular {
  id: string;
  name: string;
  frequency: string | null;
  /** What it usually charges (the top of its learned range). */
  usual: number;
  /** As a monthly figure, for the total. */
  monthly: number;
  lastDate: string | null;
  lastAmount: number | null;
  wentUp: boolean;
  stopped: boolean;
}

export interface RegularsSummary {
  monthlyTotal: number;
  regulars: Regular[];
  wentUp: number;
  stopped: number;
}

const PER_MONTH: Record<string, number> = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
/** A price counts as "up" only past this much over the usual amount (rounding, small fees). */
const UP_BY = 1.05;
/** Days past a month since its last payment before a monthly regular counts as "not come". */
const GRACE_DAYS = 5;
const DAY_MS = 86400000;

interface Sighting {
  date: string;
  amount: number;
}

/** Pure: the summary from the patterns, the recent payments by merchant and today. Exported for tests. */
export function summarise(patterns: ExpenseClassificationRow[], byMerchant: Map<string, Sighting[]>, today: Date): RegularsSummary {
  const regulars: Regular[] = [];
  for (const p of patterns) {
    if (!p.is_active || p.classification === "variable") continue;
    const usual = p.amount_range_high;
    // This pattern's own payments: a merchant with two plans has two patterns, each its own range.
    const seen = (byMerchant.get(p.merchant_normalized) ?? [])
      .filter((x) => x.amount >= p.amount_range_low * 0.8 && x.amount <= p.amount_range_high * 1.5)
      .sort((a, b) => a.date.localeCompare(b.date));
    const last = seen[seen.length - 1] ?? null;
    const wentUp = !!last && usual > 0 && last.amount > usual * UP_BY;
    const [ly, lm, ld] = (last?.date ?? "").slice(0, 10).split("-").map(Number);
    const sinceLast = last ? Math.floor((today.getTime() - new Date(ly, lm - 1, ld).getTime()) / DAY_MS) : 0;
    const stopped = p.frequency === "monthly" && !!last && sinceLast > 31 + GRACE_DAYS;
    regulars.push({
      id: p.id,
      name: p.merchant_normalized,
      frequency: p.frequency,
      usual,
      monthly: usual * (PER_MONTH[p.frequency ?? "monthly"] ?? 1),
      lastDate: last?.date.slice(0, 10) ?? null,
      lastAmount: last?.amount ?? null,
      wentUp,
      stopped,
    });
  }
  regulars.sort((a, b) => Number(b.wentUp) - Number(a.wentUp) || Number(b.stopped) - Number(a.stopped) || b.monthly - a.monthly);
  return {
    monthlyTotal: regulars.reduce((s, r) => s + r.monthly, 0),
    regulars,
    wentUp: regulars.filter((r) => r.wentUp).length,
    stopped: regulars.filter((r) => r.stopped).length,
  };
}

export async function loadRegulars(today: Date = new Date()): Promise<RegularsSummary> {
  const from = new Date(today.getFullYear(), today.getMonth() - 3, 1);
  const [patterns, rows] = await Promise.all([getPatternLibrary(DEFAULT_USER_ID), getSpendingRows(DEFAULT_USER_ID, toIsoDate(from), toIsoDate(today))]);
  const byMerchant = new Map<string, Sighting[]>();
  for (const r of rows) {
    if (!r.merchant_name) continue;
    const key = normalizeMerchant(r.merchant_name);
    if (!key) continue;
    byMerchant.set(key, [...(byMerchant.get(key) ?? []), { date: r.date, amount: r.amount }]);
  }
  return summarise(patterns, byMerchant, today);
}
