/**
 * What the add / edit transaction pickers show first: recent and most-used merchants with their
 * usual category, account and payment mode, and how often each payment mode is used.
 *
 * Read-only, from approved spending in the last 18 months. No new tables.
 */
import { getDatabase } from "@/database";

export interface MerchantUsage {
  name: string;
  count: number;
  lastDate: string;
  /** The category, account and payment mode used most often with this merchant (null if never set). */
  categoryId: string | null;
  accountId: string | null;
  paymentModeId: string | null;
}

interface Row {
  merchant_name: string;
  category_id: string | null;
  account_id: string | null;
  payment_mode_id: string | null;
  date: string;
}

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c];
  return best;
}

/** Merchants by use, newest first in `recent`, busiest first in `mostUsed`. */
export async function getMerchantUsage(userId: string): Promise<{ recent: MerchantUsage[]; mostUsed: MerchantUsage[]; byName: Map<string, MerchantUsage> }> {
  const since = new Date();
  since.setMonth(since.getMonth() - 18);
  const sinceStr = since.toISOString().slice(0, 10);
  let rows: Row[] = [];
  try {
    rows = await getDatabase().getAllAsync<Row>(
      `SELECT merchant_name, category_id, account_id, payment_mode_id, date
         FROM expenses
        WHERE user_id = ? AND deleted_at IS NULL AND status = 'approved' AND nature = 'realized'
          AND merchant_name IS NOT NULL AND TRIM(merchant_name) != '' AND date >= ?
        ORDER BY date DESC
        LIMIT 6000;`,
      userId,
      sinceStr,
    );
  } catch {
    rows = [];
  }
  return summarise(rows);
}

/** Exported for tests: rows (newest first) → recent / most used / by name. */
export function summarise(rows: Row[]): { recent: MerchantUsage[]; mostUsed: MerchantUsage[]; byName: Map<string, MerchantUsage> } {
  const groups = new Map<string, { name: string; rows: Row[] }>();
  for (const r of rows) {
    const key = r.merchant_name.trim().toLowerCase();
    const g = groups.get(key);
    if (g) g.rows.push(r);
    else groups.set(key, { name: r.merchant_name.trim(), rows: [r] });
  }
  const all: MerchantUsage[] = [...groups.values()].map((g) => ({
    name: g.name,
    count: g.rows.length,
    lastDate: g.rows[0].date,
    categoryId: mostCommon(g.rows.map((r) => r.category_id)),
    accountId: mostCommon(g.rows.map((r) => r.account_id)),
    paymentModeId: mostCommon(g.rows.map((r) => r.payment_mode_id)),
  }));
  const recent = [...all].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  const mostUsed = [...all].sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate));
  const byName = new Map(all.map((m) => [m.name.toLowerCase(), m]));
  return { recent, mostUsed, byName };
}

/** How many approved transactions used each payment mode in the last 18 months. */
export async function getPaymentModeUsage(userId: string): Promise<Map<string, number>> {
  const since = new Date();
  since.setMonth(since.getMonth() - 18);
  try {
    const rows = await getDatabase().getAllAsync<{ payment_mode_id: string; n: number }>(
      `SELECT payment_mode_id, COUNT(*) AS n FROM expenses
        WHERE user_id = ? AND deleted_at IS NULL AND status = 'approved' AND payment_mode_id IS NOT NULL AND date >= ?
        GROUP BY payment_mode_id;`,
      userId,
      since.toISOString().slice(0, 10),
    );
    return new Map(rows.map((r) => [r.payment_mode_id, r.n]));
  } catch {
    return new Map();
  }
}
