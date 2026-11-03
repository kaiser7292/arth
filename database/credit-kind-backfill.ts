import type { SQLiteDatabase } from "expo-sqlite";
import { inferCreditKind } from "@/services/sms/money-signals";

/** A credit filed under a category of exactly this name meant that type. Spending categories say nothing ("Rent & Utilities"). */
const KIND_BY_CATEGORY: Record<string, string> = {
  salary: "salary",
  income: "salary",
  bonus: "bonus",
  interest: "interest",
  refund: "refund",
  refunds: "refund",
  cashback: "cashback",
  reimbursement: "reimbursement",
  reimbursements: "reimbursement",
  gift: "gift",
  gifts: "gift",
  dividend: "dividend",
  dividends: "dividend",
};

/**
 * Credits are described by their type now, not a category. Gives credits that have no type yet the
 * one they show: linked to a refunded expense, then the name of their old category, then the words
 * of their SMS or description. The rest stay NULL, which reads as Other. Their category stays stored.
 *
 * Runs as migration 091 and again after a restore, whose rows arrive after migrations have run.
 */
export async function backfillCreditKinds(db: SQLiteDatabase): Promise<void> {
  const rows = await db.getAllAsync<{
    id: string;
    refund_of_expense_id: string | null;
    raw_source_text: string | null;
    description: string | null;
    category_name: string | null;
  }>(
    `SELECT e.id, e.refund_of_expense_id, e.raw_source_text, e.description, c.name AS category_name
     FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.nature = 'credit' AND e.credit_kind IS NULL;`,
  );
  for (const r of rows) {
    const kind = r.refund_of_expense_id
      ? "refund"
      : (KIND_BY_CATEGORY[(r.category_name ?? "").trim().toLowerCase()] ?? inferCreditKind(r.raw_source_text) ?? inferCreditKind(r.description));
    if (kind) await db.runAsync("UPDATE expenses SET credit_kind = ? WHERE id = ?;", kind, r.id);
  }
}
