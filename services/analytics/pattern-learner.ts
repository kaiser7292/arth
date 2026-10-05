import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { normalizeMerchant } from "@/services/smart-categorizer";
import { bumpDataVersion } from "@/services/settings";
import { THRESHOLDS } from "@/utils/analytics/thresholds";
import type { Classification } from "@/utils/analytics/types";
import type { ExpenseClassificationRow } from "./classifier";
import { getSpendingRows } from "./spending-rows";

export async function confirmPattern(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE expense_classifications
     SET source = 'user_confirmed', confidence = 1.0,
         last_confirmed_date = datetime('now'), updated_at = datetime('now')
     WHERE id = ?;`,
    id
  );
  await bumpDataVersion();
}

export async function correctPattern(
  id: string,
  classification: Classification,
  amountLow?: number,
  amountHigh?: number,
  frequency?: string,
  expectedDay?: number
): Promise<void> {
  const db = getDatabase();
  const fields = [
    "source = 'user_corrected'",
    "confidence = 1.0",
    `classification = '${classification}'`,
    "last_confirmed_date = datetime('now')",
    "updated_at = datetime('now')",
  ];
  const values: (string | number | null)[] = [];

  if (amountLow !== undefined) {
    fields.push("amount_range_low = ?");
    values.push(amountLow);
  }
  if (amountHigh !== undefined) {
    fields.push("amount_range_high = ?");
    values.push(amountHigh);
  }
  if (frequency !== undefined) {
    fields.push("frequency = ?");
    values.push(frequency);
  }
  if (expectedDay !== undefined) {
    fields.push("expected_day_of_month = ?");
    values.push(expectedDay);
  }

  values.push(id);

  await db.runAsync(
    `UPDATE expense_classifications SET ${fields.join(", ")} WHERE id = ?;`,
    ...values
  );
  await bumpDataVersion();
}

// ─── Learning (rebuilt v4.7.0) ───────────────────────────────────────────────
//
// The old learner added every matching payment to a running count on each run (counts reached
// thousands), so confidence never dropped and stopped bills were never retired; it called any
// often-used merchant "weekly" (average gap), and "fixed" only meant "same amount".
//
// Now each run recomputes everything from the last 6 months of spending:
//   - a merchant's payments are grouped by amount (two policies with one insurer = 2 patterns)
//   - how often = the typical (median) gap, and only if the gaps are steady
//   - fixed = steady rhythm + same amount; semi-fixed = steady rhythm, amount varies ≤ 50%
//   - expected day = the usual day (median), or "end of month" when it lands in the last days
//   - a pattern not seen for 1.5× its gap has stopped: auto ones are dropped, ones you
//     confirmed are paused (inactive) until they come back
// Patterns you confirmed or corrected are never overwritten — only their counts are refreshed.

/** Payments that recur at a steady rhythm need at least this many sightings. */
export const MIN_SIGHTINGS = 3;
/** Share of gaps that must sit near the typical gap for a rhythm to count as steady. */
const STEADY_SHARE = 0.6;
const LOOKBACK_MONTHS = 6;

export interface Sighting {
  date: string;
  amount: number;
  categoryId: string | null;
}

export interface LearnedPattern {
  merchant: string;
  categoryId: string | null;
  amountLow: number;
  amountHigh: number;
  classification: Classification;
  frequency: "weekly" | "monthly" | "quarterly" | "yearly";
  /** 1–31; 31 means "last day of the month". */
  expectedDay: number;
  occurrences: number;
  lastSeen: string;
  confidence: number;
  /** Typical days between payments. */
  gapDays: number;
}

const dayNum = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);

function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Group amounts that are within the tolerance of the group's middle amount. */
export function clusterByAmount(sightings: Sighting[], tolerance: number = THRESHOLDS.CLASSIFICATION_AMOUNT_TOLERANCE): Sighting[][] {
  const sorted = [...sightings].sort((a, b) => a.amount - b.amount);
  const clusters: Sighting[][] = [];
  for (const s of sorted) {
    const last = clusters[clusters.length - 1];
    if (last) {
      const mid = medianOf(last.map((x) => x.amount));
      if (Math.abs(s.amount - mid) <= mid * tolerance) {
        last.push(s);
        continue;
      }
    }
    clusters.push([s]);
  }
  return clusters;
}

/** Typical gap and whether payments keep to it. Same-day duplicates count once. */
export function rhythm(dates: string[]): { gap: number; steady: boolean } | null {
  const days = [...new Set(dates)].map(dayNum).sort((a, b) => a - b);
  if (days.length < MIN_SIGHTINGS) return null;
  const gaps = days.slice(1).map((d, i) => d - days[i]);
  const gap = medianOf(gaps);
  if (gap <= 0) return null;
  const near = gaps.filter((g) => Math.abs(g - gap) <= Math.max(2, gap * 0.25)).length;
  return { gap, steady: near / gaps.length >= STEADY_SHARE };
}

export function frequencyFor(gap: number): LearnedPattern["frequency"] | null {
  if (gap >= 5 && gap <= 9) return "weekly";
  if (gap >= 25 && gap <= 35) return "monthly";
  if (gap >= 80 && gap <= 100) return "quarterly";
  if (gap >= 340 && gap <= 390) return "yearly";
  return null;
}

/** The usual day of the month; 31 when most payments fall in the month's last 3 days. */
export function usualDay(dates: string[]): number {
  const endish = dates.filter((d) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y, m, 0).getDate() - day < 3;
  }).length;
  if (endish / dates.length >= 2 / 3) return 31;
  return Math.round(medianOf(dates.map((d) => Number(d.slice(8, 10)))));
}

/**
 * Pure: the bill-like patterns in a merchant's payments (one per amount group that keeps a
 * steady rhythm and hasn't stopped). `today` is YYYY-MM-DD.
 */
export function learnMerchant(merchant: string, sightings: Sighting[], today: string): LearnedPattern[] {
  const out: LearnedPattern[] = [];
  for (const cluster of clusterByAmount(sightings, 0.5)) {
    const dates = cluster.map((s) => s.date).sort();
    const r = rhythm(dates);
    if (!r || !r.steady) continue;
    const frequency = frequencyFor(r.gap);
    if (!frequency) continue;
    const lastSeen = dates[dates.length - 1];
    // Stopped: not seen for 1.5× its rhythm (+ a week's grace).
    if (dayNum(today) - dayNum(lastSeen) > r.gap * 1.5 + 7) continue;
    const amounts = cluster.map((s) => s.amount);
    const mid = medianOf(amounts);
    const spread = Math.max(...amounts.map((a) => Math.abs(a - mid) / mid));
    const classification: Classification = spread <= THRESHOLDS.CLASSIFICATION_AMOUNT_TOLERANCE ? "fixed" : "semi_fixed";
    const occurrences = new Set(dates).size;
    out.push({
      merchant,
      categoryId: cluster[cluster.length - 1].categoryId,
      amountLow: Math.min(...amounts),
      amountHigh: Math.max(...amounts),
      classification,
      frequency,
      expectedDay: usualDay(dates),
      occurrences,
      lastSeen,
      confidence: Math.min(0.95, 0.45 + 0.1 * occurrences),
      gapDays: r.gap,
    });
  }
  return out;
}

const rangesOverlap = (aLow: number, aHigh: number, bLow: number, bHigh: number) => {
  const t = THRESHOLDS.CLASSIFICATION_AMOUNT_TOLERANCE;
  return aLow * (1 - t) <= bHigh * (1 + t) && bLow * (1 - t) <= aHigh * (1 + t);
};

/**
 * Recompute every learned pattern from the last 6 months of spending. Idempotent: running it
 * twice gives the same result. Returns how many active patterns there are afterwards.
 */
export async function rebuildPatterns(userId: string, now: Date = new Date()): Promise<number> {
  const db = getDatabase();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const from = new Date(now.getFullYear(), now.getMonth() - LOOKBACK_MONTHS, 1);
  const fromStr = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-01`;
  const rows = await getSpendingRows(userId, fromStr, today);

  const byMerchant = new Map<string, Sighting[]>();
  for (const e of rows) {
    if (!e.merchant_name) continue;
    const key = normalizeMerchant(e.merchant_name);
    if (!key) continue;
    const list = byMerchant.get(key) ?? [];
    list.push({ date: e.date, amount: e.amount, categoryId: e.category_id });
    byMerchant.set(key, list);
  }

  const existing = await db.getAllAsync<ExpenseClassificationRow>(
    `SELECT * FROM expense_classifications WHERE user_id = ?;`,
    userId,
  );
  const userRows = existing.filter((c) => c.source !== "auto_detected");
  const autoRows = existing.filter((c) => c.source === "auto_detected");
  const keptAutoIds = new Set<string>();

  // Your confirmed / corrected patterns: refresh counts; pause when stopped, resume when back.
  for (const c of userRows) {
    const sightings = (byMerchant.get(c.merchant_normalized) ?? []).filter((s) =>
      rangesOverlap(s.amount, s.amount, c.amount_range_low, c.amount_range_high),
    );
    const dates = [...new Set(sightings.map((s) => s.date))].sort();
    const lastSeen = dates[dates.length - 1] ?? c.last_seen_date;
    const gap = rhythm(dates)?.gap ?? ({ weekly: 7, monthly: 30, quarterly: 91, yearly: 365 } as Record<string, number>)[c.frequency ?? "monthly"] ?? 30;
    const stopped = !lastSeen || dayNum(today) - dayNum(lastSeen) > gap * 1.5 + 7;
    await db.runAsync(
      `UPDATE expense_classifications
          SET occurrence_count = ?, last_seen_date = ?, is_active = ?,
              deactivated_reason = ?, updated_at = datetime('now')
        WHERE id = ?;`,
      dates.length,
      lastSeen ?? c.last_seen_date,
      // A pattern you marked "varies" stays on whatever happens — it's an answer, not a bill.
      c.classification === "variable" ? 1 : stopped ? 0 : 1,
      c.classification === "variable" ? null : stopped ? "paused" : null,
      c.id,
    );
  }

  for (const [merchant, sightings] of byMerchant) {
    for (const p of learnMerchant(merchant, sightings, today)) {
      // Never second-guess an answer you gave for this merchant and amount.
      if (userRows.some((u) => u.merchant_normalized === merchant && rangesOverlap(u.amount_range_low, u.amount_range_high, p.amountLow, p.amountHigh))) continue;
      const prior = autoRows.find(
        (a) => a.merchant_normalized === merchant && !keptAutoIds.has(a.id) && rangesOverlap(a.amount_range_low, a.amount_range_high, p.amountLow, p.amountHigh),
      );
      if (prior) {
        keptAutoIds.add(prior.id);
        await db.runAsync(
          `UPDATE expense_classifications
              SET category_id = ?, amount_range_low = ?, amount_range_high = ?, classification = ?,
                  frequency = ?, expected_day_of_month = ?, confidence = ?, occurrence_count = ?,
                  last_seen_date = ?, is_active = 1, deactivated_reason = NULL, updated_at = datetime('now')
            WHERE id = ?;`,
          p.categoryId, p.amountLow, p.amountHigh, p.classification, p.frequency, p.expectedDay,
          p.confidence, p.occurrences, p.lastSeen, prior.id,
        );
      } else {
        const id = generateUUID();
        keptAutoIds.add(id);
        await db.runAsync(
          `INSERT INTO expense_classifications
             (id, user_id, merchant_normalized, category_id, amount_range_low, amount_range_high,
              classification, frequency, expected_day_of_month, confidence, source,
              occurrence_count, last_seen_date, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto_detected', ?, ?, 1);`,
          id, userId, merchant, p.categoryId, p.amountLow, p.amountHigh, p.classification,
          p.frequency, p.expectedDay, p.confidence, p.occurrences, p.lastSeen,
        );
      }
    }
  }

  // Automatic patterns that didn't come back this run have stopped (or never were bills).
  const stale = autoRows.filter((a) => !keptAutoIds.has(a.id)).map((a) => a.id);
  for (const id of stale) {
    await db.runAsync(`DELETE FROM expense_classifications WHERE id = ?;`, id);
  }

  bumpDataVersion();
  const active = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM expense_classifications WHERE user_id = ? AND is_active = 1;`,
    userId,
  );
  return active?.n ?? 0;
}

/** "Is this a monthly bill?" — automatic fixed/semi-fixed patterns you haven't answered yet. */
export async function getPatternsToConfirm(userId: string): Promise<ExpenseClassificationRow[]> {
  const db = getDatabase();
  return db.getAllAsync<ExpenseClassificationRow>(
    `SELECT * FROM expense_classifications
      WHERE user_id = ? AND is_active = 1 AND source = 'auto_detected'
        AND classification IN ('fixed', 'semi_fixed')
      ORDER BY occurrence_count DESC, last_seen_date DESC;`,
    userId,
  );
}
