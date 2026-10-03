import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 080 — expenses.money_event + expenses.credit_kind.
 *
 * money_event: what kind of money movement an SMS-detected row looks like, so the review queue can
 * offer the right one-tap action instead of a plain approve. Values: 'fd_open' (debit funding a
 * fixed deposit), 'fd_closure' (credit from a closed FD not yet matched to one), 'self_transfer'
 * (to/from your own account, other side not found yet), 'sip' (mutual-fund auto-debit). Cleared
 * once the user acts on it. NULL for ordinary rows.
 *
 * credit_kind: what a credit is — 'salary' | 'interest' | 'refund' | 'cashback' | 'reimbursement'
 * | 'gift' | 'other'. Credits used to borrow spending categories; this replaces that for new
 * entries. NULL for debits and for credits saved before this migration.
 *
 * Idempotent via PRAGMA table_info guard.
 */
export const migration: Migration = {
  version: 80,
  name: "expense_money_event_credit_kind",
  up: async (db: SQLiteDatabase) => {
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(expenses);`);
    if (!columns.some((c) => c.name === "money_event")) {
      await db.execAsync(`ALTER TABLE expenses ADD COLUMN money_event TEXT;`);
    }
    if (!columns.some((c) => c.name === "credit_kind")) {
      await db.execAsync(`ALTER TABLE expenses ADD COLUMN credit_kind TEXT;`);
    }
  },
};

export default migration;
