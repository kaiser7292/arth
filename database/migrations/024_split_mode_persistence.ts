import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 024: Persist split mode + exact amount on single-split expenses.
 *
 * Before v15.13.1, the single-split flow stored only `split_pct` (derived
 * percentage). The original `splitMode` and `exactAmount` were lost, so on
 * any edit the reconstruction forced `splitMode: "percentage"` + `paidBy:
 * "me"` — causing amount drift on "by amount" splits and hisaab-direction
 * flips on "they paid" splits.
 *
 * Adds two additive columns on `expenses`:
 *   - split_mode: text enum — "equal" | "they_owe_full" | "i_owe_full" |
 *                 "exact" | "percentage". Nullable — legacy rows carry
 *                 NULL and fall back to the percentage reconstruction.
 *   - split_exact_amount: REAL. Nullable — only populated when
 *                         split_mode = "exact".
 *
 * Idempotent via PRAGMA table_info guards.
 */
export default {
  version: 24,
  name: "split_mode_persistence",
  up: async (db: SQLiteDatabase) => {
    const cols = (await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(expenses);",
    )) as Array<{ name: string }>;
    const hasMode = cols.some((c) => c.name === "split_mode");
    const hasExact = cols.some((c) => c.name === "split_exact_amount");
    if (!hasMode) {
      await db.execAsync("ALTER TABLE expenses ADD COLUMN split_mode TEXT;");
    }
    if (!hasExact) {
      await db.execAsync("ALTER TABLE expenses ADD COLUMN split_exact_amount REAL;");
    }
  },
};
