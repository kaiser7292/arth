import { getDatabase } from "@/database";
import { toIsoDate } from "@/utils/date";
import { getFYRange } from "@/utils/fiscal-year";

/**
 * Business receipts actually received — credits into the accounts the user marked as
 * receiving business payments (salary_profiles.business_receipt_account_ids).
 *
 * Counted: approved credits. Not counted: refunds of earlier spends, credits reclassified
 * as transfers (money moved between own accounts), and Hisaab settlements (family paying
 * back) — none of those are business income.
 */

export interface BusinessReceiptsSummary {
  /** Sum of qualifying credits between the FY start and `asOf`. */
  total: number;
  count: number;
  /** Per calendar month, "YYYY-MM" → amount, oldest first. */
  byMonth: Array<{ month: string; amount: number }>;
  /** FY window used (ISO dates). */
  from: string;
  to: string;
}

/** Parse the stored JSON account-id list; anything malformed reads as "none selected". */
export function parseReceiptAccountIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export async function getBusinessReceiptsForFY(
  userId: string,
  accountIds: string[],
  fyYear: number,
  fyStartMonth: number,
  asOf: Date = new Date(),
): Promise<BusinessReceiptsSummary> {
  const { start, end } = getFYRange(fyYear, fyStartMonth);
  const from = toIsoDate(start);
  const to = toIsoDate(asOf < end ? asOf : end);
  if (accountIds.length === 0 || to < from) {
    return { total: 0, count: 0, byMonth: [], from, to };
  }

  const db = getDatabase();
  const placeholders = accountIds.map(() => "?").join(",");
  const rows = await db.getAllAsync<{ month: string; amount: number; n: number }>(
    `SELECT strftime('%Y-%m', date) AS month, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS n
     FROM expenses
     WHERE user_id = ? AND account_id IN (${placeholders})
       AND nature = 'credit' AND status = 'approved' AND deleted_at IS NULL
       AND refund_of_expense_id IS NULL
       AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
       AND NOT EXISTS (
         SELECT 1 FROM hisaab_entries he
         WHERE he.type = 'settlement' AND he.linked_expense_id = expenses.id
       )
       AND date >= ? AND date <= ?
     GROUP BY month
     ORDER BY month;`,
    userId,
    ...accountIds,
    from,
    to,
  );

  return {
    total: rows.reduce((s, r) => s + r.amount, 0),
    count: rows.reduce((s, r) => s + r.n, 0),
    byMonth: rows.map((r) => ({ month: r.month, amount: r.amount })),
    from,
    to,
  };
}
