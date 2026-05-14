/**
 * Data Cleanup Service — scoped deletion of expenses and budgets.
 * Supports day, week, month, quarter, or full reset.
 * Supports selective object type cleanup.
 *
 * WARNING: Deletions are permanent and cannot be undone.
 * The Settings UI shows a double-confirmation dialog before calling this.
 */

import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import { formatLocalDate } from "@/utils/fiscal-year";

export type CleanupScope = "day" | "week" | "month" | "quarter" | "all" | "custom";

export type CleanupObjectType = "expenses" | "credits" | "budgets" | "pending_sms" | "merchant_aliases" | "hisaab" | "tags" | "salary_profiles" | "categories" | "payment_modes" | "accounts" | "simulator" | "audit_log";

export interface CleanupResult {
  expensesDeleted: number;
  creditsDeleted: number;
  budgetsDeleted: number;
  pendingSmsDeleted: number;
  merchantAliasesDeleted: number;
  hisaabDeleted: number;
  tagsDeleted: number;
  salaryProfilesDeleted: number;
  categoriesDeleted: number;
  paymentModesDeleted: number;
  accountsDeleted: number;
  /** v16.0.1 — simulator scenarios + entries deleted. */
  simulatorDeleted: number;
  auditLogDeleted: number;
  errors: string[];
}

/** Optional custom date range for "custom" scope */
export interface CustomDateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

/**
 * Calculate the start date for the given cleanup scope.
 * Returns an ISO date string (YYYY-MM-DD) for use in SQL comparisons.
 */
function getScopeStartDate(scope: CleanupScope, customRange?: CustomDateRange): string | null {
  if (scope === "all") return null; // no date filter = delete everything
  if (scope === "custom") return customRange?.startDate ?? null;

  const now = new Date();
  let start: Date;

  switch (scope) {
    case "day":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case "week":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      break;
    case "month":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "quarter":
      start = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
      break;
  }

  return formatLocalDate(start);
}

/**
 * Get the end date for custom scope. Returns null for non-custom scopes (deletes up to now).
 */
function getScopeEndDate(scope: CleanupScope, customRange?: CustomDateRange): string | null {
  if (scope === "custom" && customRange?.endDate) return customRange.endDate;
  return null;
}

/**
 * Get the month string (YYYY-MM) for the scope start date.
 * Used for cleaning up budget entries.
 */
function getScopeStartMonth(scope: CleanupScope, customRange?: CustomDateRange): string | null {
  if (scope === "all") return null;
  const startDate = getScopeStartDate(scope, customRange);
  if (!startDate) return null;
  return startDate.substring(0, 7); // "YYYY-MM"
}

function getScopeEndMonth(scope: CleanupScope, customRange?: CustomDateRange): string | null {
  const endDate = getScopeEndDate(scope, customRange);
  if (!endDate) return null;
  return endDate.substring(0, 7); // "YYYY-MM"
}

/**
 * Get a preview of how many records will be deleted for each object type.
 */
export async function getCleanupPreview(
  userId: string,
  scope: CleanupScope,
  objectTypes: CleanupObjectType[],
  customRange?: CustomDateRange,
): Promise<Record<CleanupObjectType, number>> {
  const db = getDatabase();
  const startDate = getScopeStartDate(scope, customRange);
  const endDate = getScopeEndDate(scope, customRange);
  const startMonth = getScopeStartMonth(scope, customRange);
  const endMonth = getScopeEndMonth(scope, customRange);
  const counts: Record<CleanupObjectType, number> = {
    expenses: 0,
    credits: 0,
    budgets: 0,
    pending_sms: 0,
    merchant_aliases: 0,
    hisaab: 0,
    tags: 0,
    salary_profiles: 0,
    categories: 0,
    payment_modes: 0,
    accounts: 0,
    simulator: 0,
    audit_log: 0,
  };

  if (objectTypes.includes("expenses")) {
    try {
      let row;
      // Count only non-credit rows so the user-facing "Expenses" count doesn't
      // include salary/refund entries that live under the dedicated "Credits" scope.
      if (scope === "all") {
        row = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM expenses WHERE user_id = ? AND nature != 'credit' AND deleted_at IS NULL;", userId);
      } else if (endDate) {
        row = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM expenses WHERE user_id = ? AND nature != 'credit' AND date >= ? AND date <= ? AND deleted_at IS NULL;", userId, startDate!, endDate);
      } else {
        row = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM expenses WHERE user_id = ? AND nature != 'credit' AND date >= ? AND deleted_at IS NULL;", userId, startDate!);
      }
      counts.expenses = row?.c ?? 0;
    } catch { /* table may not exist */ }
  }

  if (objectTypes.includes("credits")) {
    try {
      let row;
      if (scope === "all") {
        row = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM expenses WHERE user_id = ? AND nature = 'credit' AND deleted_at IS NULL;", userId);
      } else if (endDate) {
        row = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM expenses WHERE user_id = ? AND nature = 'credit' AND date >= ? AND date <= ? AND deleted_at IS NULL;", userId, startDate!, endDate);
      } else {
        row = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM expenses WHERE user_id = ? AND nature = 'credit' AND date >= ? AND deleted_at IS NULL;", userId, startDate!);
      }
      counts.credits = row?.c ?? 0;
    } catch { /* table may not exist */ }
  }

  if (objectTypes.includes("budgets")) {
    try {
      let row;
      if (scope === "all") {
        row = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM budgets WHERE user_id = ?;", userId);
      } else if (endMonth) {
        row = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM budgets WHERE user_id = ? AND month >= ? AND month <= ?;", userId, startMonth!, endMonth);
      } else {
        row = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM budgets WHERE user_id = ? AND month >= ?;", userId, startMonth!);
      }
      counts.budgets = row?.c ?? 0;
    } catch { /* table may not exist */ }
  }

  if (objectTypes.includes("pending_sms")) {
    try {
      let row;
      if (scope === "all") {
        row = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM pending_sms WHERE user_id = ?;", userId);
      } else if (endDate) {
        row = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM pending_sms WHERE user_id = ? AND created_at >= ? AND created_at <= ?;", userId, startDate!, endDate);
      } else {
        row = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM pending_sms WHERE user_id = ? AND created_at >= ?;", userId, startDate!);
      }
      counts.pending_sms = row?.c ?? 0;
    } catch { /* table may not exist */ }
  }

  if (objectTypes.includes("merchant_aliases")) {
    try {
      const row = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM merchant_aliases WHERE user_id = ?;", userId);
      counts.merchant_aliases = row?.c ?? 0;
    } catch { /* table may not exist */ }
  }

  if (objectTypes.includes("hisaab")) {
    try {
      const row = await db.getFirstAsync<{ c: number }>(
        "SELECT COUNT(*) as c FROM hisaab_entries WHERE hisaab_person_id IN (SELECT id FROM hisaab_persons WHERE user_id = ?);", userId);
      counts.hisaab = row?.c ?? 0;
    } catch { /* table may not exist */ }
  }

  if (objectTypes.includes("tags")) {
    try {
      const row = await db.getFirstAsync<{ c: number }>(
        "SELECT COUNT(*) as c FROM expense_tags WHERE expense_id IN (SELECT id FROM expenses WHERE user_id = ?);", userId);
      counts.tags = row?.c ?? 0;
    } catch { /* table may not exist */ }
  }

  if (objectTypes.includes("salary_profiles")) {
    try {
      const row = await db.getFirstAsync<{ c: number }>(
        "SELECT COUNT(*) as c FROM salary_profiles WHERE yearly_plan_id IN (SELECT id FROM yearly_plans WHERE user_id = ?);",
        userId,
      );
      counts.salary_profiles = row?.c ?? 0;
    } catch { /* table may not exist */ }
  }

  if (objectTypes.includes("categories")) {
    try {
      // Only count categories with zero linked expenses (deletable ones)
      const row = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) as c FROM categories WHERE user_id = ?
         AND id NOT IN (SELECT DISTINCT category_id FROM expenses WHERE category_id IS NOT NULL AND deleted_at IS NULL);`,
        userId,
      );
      counts.categories = row?.c ?? 0;
    } catch { /* table may not exist */ }
  }

  if (objectTypes.includes("payment_modes")) {
    try {
      // Only count payment modes with zero linked expenses (deletable ones)
      const row = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) as c FROM payment_modes WHERE user_id = ?
         AND id NOT IN (SELECT DISTINCT payment_mode_id FROM expenses WHERE payment_mode_id IS NOT NULL AND deleted_at IS NULL);`,
        userId,
      );
      counts.payment_modes = row?.c ?? 0;
    } catch { /* table may not exist */ }
  }

  if (objectTypes.includes("accounts")) {
    try {
      const row = await db.getFirstAsync<{ c: number }>(
        "SELECT COUNT(*) as c FROM financial_accounts WHERE user_id = ?;",
        userId,
      );
      counts.accounts = row?.c ?? 0;
    } catch { /* table may not exist */ }
  }

  if (objectTypes.includes("simulator")) {
    // v16.0.1 — count scenarios + entries so "Wipe all" accurately
    // reflects removal of simulator state. Scope is ignored here (no
    // per-date partition on scenarios).
    try {
      const row = await db.getFirstAsync<{ c: number }>(
        `SELECT
           (SELECT COUNT(*) FROM simulation_scenarios WHERE user_id = ?)
           + (SELECT COUNT(*) FROM simulation_entries
              WHERE scenario_id IN (SELECT id FROM simulation_scenarios WHERE user_id = ?))
         as c;`,
        userId,
        userId,
      );
      counts.simulator = row?.c ?? 0;
    } catch { /* table may not exist */ }
  }

  if (objectTypes.includes("audit_log")) {
    try {
      let row;
      if (scope === "all") {
        row = await db.getFirstAsync<{ c: number }>(
          `SELECT COUNT(*) as c FROM expense_edit_history
           WHERE expense_id IN (SELECT id FROM expenses WHERE user_id = ?);`,
          userId,
        );
      } else if (endDate) {
        row = await db.getFirstAsync<{ c: number }>(
          `SELECT COUNT(*) as c FROM expense_edit_history
           WHERE expense_id IN (SELECT id FROM expenses WHERE user_id = ?)
             AND date(edited_at) >= ? AND date(edited_at) <= ?;`,
          userId, startDate!, endDate,
        );
      } else {
        row = await db.getFirstAsync<{ c: number }>(
          `SELECT COUNT(*) as c FROM expense_edit_history
           WHERE expense_id IN (SELECT id FROM expenses WHERE user_id = ?)
             AND date(edited_at) >= ?;`,
          userId, startDate!,
        );
      }
      counts.audit_log = row?.c ?? 0;
    } catch { /* table may not exist */ }
  }

  return counts;
}

/**
 * Delete data within the given scope for the selected object types.
 *
 * @param userId - The user whose data to clean up.
 * @param scope - Time range to clean: day, week, month, quarter, or all.
 * @param objectTypes - Which object types to delete. Defaults to all for backward compatibility.
 * @returns Summary of what was deleted.
 */
export async function cleanupData(
  userId: string,
  scope: CleanupScope,
  objectTypes?: CleanupObjectType[],
  customRange?: CustomDateRange,
): Promise<CleanupResult> {
  const db = getDatabase();
  const types = objectTypes ?? ["expenses", "budgets", "pending_sms"];
  const result: CleanupResult = {
    expensesDeleted: 0,
    creditsDeleted: 0,
    budgetsDeleted: 0,
    pendingSmsDeleted: 0,
    merchantAliasesDeleted: 0,
    hisaabDeleted: 0,
    tagsDeleted: 0,
    salaryProfilesDeleted: 0,
    categoriesDeleted: 0,
    paymentModesDeleted: 0,
    accountsDeleted: 0,
    simulatorDeleted: 0,
    auditLogDeleted: 0,
    errors: [],
  };

  const startDate = getScopeStartDate(scope, customRange);
  const endDate = getScopeEndDate(scope, customRange);
  const startMonth = getScopeStartMonth(scope, customRange);
  const endMonth = getScopeEndMonth(scope, customRange);

  // ── Delete expenses (permanent — cleanup has double confirmation) ──
  // Scoped to non-credit rows so user-initiated "clear expenses" doesn't
  // wipe their salary/refund history. Credits have their own cleanup scope below.
  if (types.includes("expenses")) {
    try {
      let condition: string;
      let params: (string | number)[];
      if (scope === "all") {
        condition = "user_id = ? AND nature != 'credit'";
        params = [userId];
      } else if (endDate) {
        condition = "user_id = ? AND nature != 'credit' AND date >= ? AND date <= ? AND deleted_at IS NULL";
        params = [userId, startDate!, endDate];
      } else {
        condition = "user_id = ? AND nature != 'credit' AND date >= ? AND deleted_at IS NULL";
        params = [userId, startDate!];
      }

      // Delete hisaab entries linked to split expenses (mirrors deleteSplitExpense behavior)
      // Without this, split hisaab entries become orphans that still affect person balances.
      await db.runAsync(
        `DELETE FROM hisaab_entries WHERE id IN (
           SELECT split_hisaab_entry_id FROM expenses
           WHERE ${condition} AND split_hisaab_entry_id IS NOT NULL
         );`,
        ...params,
      );

      // Clear FK references pointing to expenses we're about to delete
      await db.runAsync(`UPDATE expenses SET refund_of_expense_id = NULL WHERE refund_of_expense_id IN (SELECT id FROM expenses WHERE ${condition});`, ...params);
      await db.runAsync(`UPDATE expenses SET matched_forecast_id = NULL WHERE matched_forecast_id IN (SELECT id FROM expenses WHERE ${condition});`, ...params);
      // Delete (not just unlink) pending_sms records so a rescan can re-detect the same SMS
      await db.runAsync(`DELETE FROM pending_sms WHERE expense_id IN (SELECT id FROM expenses WHERE ${condition});`, ...params);
      await db.runAsync(`UPDATE hisaab_entries SET linked_expense_id = NULL WHERE linked_expense_id IN (SELECT id FROM expenses WHERE ${condition});`, ...params);
      // Legacy column: pre-migration-005 hisaab entries may still reference these via linked_account_credit_id.
      await db.runAsync(`UPDATE hisaab_entries SET linked_account_credit_id = NULL WHERE linked_account_credit_id IN (SELECT id FROM expenses WHERE ${condition});`, ...params);
      // Delete expense splits referencing these expenses
      await db.runAsync(`DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE ${condition});`, ...params);

      const expenseResult = await db.runAsync(`DELETE FROM expenses WHERE ${condition};`, ...params);
      result.expensesDeleted = expenseResult.changes;
    } catch (e) {
      result.errors.push(
        `Expenses: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ── Delete credits (permanent) ──
  // Separate from expenses scope so users can clear spending without losing salary/refund history.
  if (types.includes("credits")) {
    try {
      let condition: string;
      let params: (string | number)[];
      if (scope === "all") {
        condition = "user_id = ? AND nature = 'credit'";
        params = [userId];
      } else if (endDate) {
        condition = "user_id = ? AND nature = 'credit' AND date >= ? AND date <= ? AND deleted_at IS NULL";
        params = [userId, startDate!, endDate];
      } else {
        condition = "user_id = ? AND nature = 'credit' AND date >= ? AND deleted_at IS NULL";
        params = [userId, startDate!];
      }

      // Clear FK references — a credit can be referenced by hisaab (settlement link)
      // or by another expense (refund_of_expense_id points at the original debit, not
      // the credit, so skip that direction).
      await db.runAsync(`UPDATE hisaab_entries SET linked_expense_id = NULL WHERE linked_expense_id IN (SELECT id FROM expenses WHERE ${condition});`, ...params);
      await db.runAsync(`UPDATE hisaab_entries SET linked_account_credit_id = NULL WHERE linked_account_credit_id IN (SELECT id FROM expenses WHERE ${condition});`, ...params);

      const creditResult = await db.runAsync(`DELETE FROM expenses WHERE ${condition};`, ...params);
      result.creditsDeleted = creditResult.changes;
    } catch (e) {
      result.errors.push(
        `Credits: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ── Delete budgets ──
  if (types.includes("budgets")) {
    try {
      let budgetResult;
      if (scope === "all") {
        budgetResult = await db.runAsync(
          "DELETE FROM budgets WHERE user_id = ?;",
          userId,
        );
      } else if (endMonth) {
        budgetResult = await db.runAsync(
          "DELETE FROM budgets WHERE user_id = ? AND month >= ? AND month <= ?;",
          userId,
          startMonth!,
          endMonth,
        );
      } else {
        budgetResult = await db.runAsync(
          "DELETE FROM budgets WHERE user_id = ? AND month >= ?;",
          userId,
          startMonth!,
        );
      }
      result.budgetsDeleted = budgetResult.changes;
    } catch (e) {
      result.errors.push(
        `Budgets: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ── Delete pending SMS ──
  if (types.includes("pending_sms")) {
    try {
      let smsResult;
      if (scope === "all") {
        smsResult = await db.runAsync(
          "DELETE FROM pending_sms WHERE user_id = ?;",
          userId,
        );
      } else if (endDate) {
        smsResult = await db.runAsync(
          "DELETE FROM pending_sms WHERE user_id = ? AND created_at >= ? AND created_at <= ?;",
          userId,
          startDate!,
          endDate,
        );
      } else {
        smsResult = await db.runAsync(
          "DELETE FROM pending_sms WHERE user_id = ? AND created_at >= ?;",
          userId,
          startDate!,
        );
      }
      result.pendingSmsDeleted = smsResult.changes;
    } catch {
      // Table may not exist yet
    }
  }

  // ── Delete merchant aliases (always "all" — no date field) ──
  if (types.includes("merchant_aliases")) {
    try {
      const aliasResult = await db.runAsync(
        "DELETE FROM merchant_aliases WHERE user_id = ?;",
        userId,
      );
      result.merchantAliasesDeleted = aliasResult.changes;
    } catch (e) {
      result.errors.push(
        `Merchant Aliases: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ── Delete hisaab entries ──
  if (types.includes("hisaab")) {
    try {
      // Clear expense_splits FK references to hisaab_entries we're about to delete
      await db.runAsync(
        "UPDATE expense_splits SET hisaab_entry_id = NULL WHERE hisaab_entry_id IN (SELECT id FROM hisaab_entries WHERE hisaab_person_id IN (SELECT id FROM hisaab_persons WHERE user_id = ?));",
        userId,
      );
      const hisaabResult = await db.runAsync(
        "DELETE FROM hisaab_entries WHERE hisaab_person_id IN (SELECT id FROM hisaab_persons WHERE user_id = ?);",
        userId,
      );
      result.hisaabDeleted = hisaabResult.changes;
    } catch (e) {
      result.errors.push(
        `Hisaab: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ── Delete expense tags ──
  if (types.includes("tags")) {
    try {
      const tagResult = await db.runAsync(
        "DELETE FROM expense_tags WHERE expense_id IN (SELECT id FROM expenses WHERE user_id = ?);",
        userId,
      );
      result.tagsDeleted = tagResult.changes;
    } catch (e) {
      result.errors.push(
        `Tags: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ── Delete salary profiles (always "all" — tied to yearly plans, not date-scoped) ──
  if (types.includes("salary_profiles")) {
    try {
      const salaryResult = await db.runAsync(
        "DELETE FROM salary_profiles WHERE yearly_plan_id IN (SELECT id FROM yearly_plans WHERE user_id = ?);",
        userId,
      );
      result.salaryProfilesDeleted = salaryResult.changes;
    } catch (e) {
      result.errors.push(
        `Salary Profiles: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ── Delete categories (only those with zero linked expenses) ──
  if (types.includes("categories")) {
    try {
      // Identify deletable category IDs (no linked non-deleted expenses)
      const deletable = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM categories WHERE user_id = ?
         AND id NOT IN (SELECT DISTINCT category_id FROM expenses WHERE category_id IS NOT NULL AND deleted_at IS NULL);`,
        userId,
      );
      for (const cat of deletable) {
        // Clear FK references before deleting
        await db.runAsync("DELETE FROM budgets WHERE category_id = ?;", cat.id);
        await db.runAsync("DELETE FROM unavoidable_baselines WHERE category_id = ?;", cat.id);
        await db.runAsync("DELETE FROM merchant_corrections WHERE category_id = ?;", cat.id);
        await db.runAsync("UPDATE merchant_aliases SET category_id = NULL WHERE category_id = ?;", cat.id);
        await db.runAsync("UPDATE recurring_transactions SET category_id = NULL WHERE category_id = ?;", cat.id);
        await db.runAsync("DELETE FROM categories WHERE id = ?;", cat.id);
      }
      result.categoriesDeleted = deletable.length;
    } catch (e) {
      result.errors.push(
        `Categories: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ── Delete payment modes (only those with zero linked expenses) ──
  if (types.includes("payment_modes")) {
    try {
      const deletable = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM payment_modes WHERE user_id = ?
         AND id NOT IN (SELECT DISTINCT payment_mode_id FROM expenses WHERE payment_mode_id IS NOT NULL AND deleted_at IS NULL);`,
        userId,
      );
      for (const pm of deletable) {
        await db.runAsync("DELETE FROM account_payment_modes WHERE payment_mode_id = ?;", pm.id);
        await db.runAsync("DELETE FROM payment_modes WHERE id = ?;", pm.id);
      }
      result.paymentModesDeleted = deletable.length;
    } catch (e) {
      result.errors.push(
        `Payment Modes: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ── Delete accounts + all related ledger data (always "all" — no date field) ──
  if (types.includes("accounts")) {
    try {
      // Get all account IDs for the user
      const accounts = await db.getAllAsync<{ id: string }>(
        "SELECT id FROM financial_accounts WHERE user_id = ?;",
        userId,
      );
      for (const acct of accounts) {
        // Delete ledger + snapshot data
        await db.runAsync("DELETE FROM account_month_balances WHERE account_id = ?;", acct.id);
        await db.runAsync("DELETE FROM account_credits WHERE account_id = ?;", acct.id);
        await db.runAsync("DELETE FROM account_payment_modes WHERE account_id = ?;", acct.id);
        await db.runAsync("DELETE FROM account_transfers WHERE from_account_id = ? OR to_account_id = ?;", acct.id, acct.id);
        await db.runAsync("DELETE FROM demat_portfolio_snapshots WHERE account_id = ?;", acct.id);
        await db.runAsync("DELETE FROM demat_fund_snapshots WHERE account_id = ?;", acct.id);
        // Unlink expenses and recurring transactions (don't delete them)
        await db.runAsync("UPDATE expenses SET account_id = NULL WHERE account_id = ?;", acct.id);
        await db.runAsync("UPDATE recurring_transactions SET account_id = NULL WHERE account_id = ?;", acct.id);
        // Delete the account itself
        await db.runAsync("DELETE FROM financial_accounts WHERE id = ?;", acct.id);
      }
      result.accountsDeleted = accounts.length;
    } catch (e) {
      result.errors.push(
        `Accounts: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ── Delete simulator scenarios + entries (v16.0.1) ──
  if (types.includes("simulator")) {
    try {
      // Count first for the result. ON DELETE CASCADE on simulation_entries
      // takes the child rows; count scenarios + their entries to surface
      // the total removed.
      const entryRow = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) as c FROM simulation_entries
         WHERE scenario_id IN (SELECT id FROM simulation_scenarios WHERE user_id = ?);`,
        userId,
      );
      const scenarioRow = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) as c FROM simulation_scenarios WHERE user_id = ?;`,
        userId,
      );
      // CASCADE takes entries when scenarios go; explicit delete as defense in depth.
      await db.runAsync(
        `DELETE FROM simulation_entries
         WHERE scenario_id IN (SELECT id FROM simulation_scenarios WHERE user_id = ?);`,
        userId,
      );
      await db.runAsync(
        `DELETE FROM simulation_scenarios WHERE user_id = ?;`,
        userId,
      );
      result.simulatorDeleted = (scenarioRow?.c ?? 0) + (entryRow?.c ?? 0);
    } catch (e) {
      result.errors.push(
        `Simulator: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ── Delete audit log (expense_edit_history) ──
  if (types.includes("audit_log")) {
    try {
      let auditResult;
      if (scope === "all") {
        auditResult = await db.runAsync(
          `DELETE FROM expense_edit_history
           WHERE expense_id IN (SELECT id FROM expenses WHERE user_id = ?);`,
          userId,
        );
      } else if (endDate) {
        auditResult = await db.runAsync(
          `DELETE FROM expense_edit_history
           WHERE expense_id IN (SELECT id FROM expenses WHERE user_id = ?)
             AND date(edited_at) >= ? AND date(edited_at) <= ?;`,
          userId, startDate!, endDate,
        );
      } else {
        auditResult = await db.runAsync(
          `DELETE FROM expense_edit_history
           WHERE expense_id IN (SELECT id FROM expenses WHERE user_id = ?)
             AND date(edited_at) >= ?;`,
          userId, startDate!,
        );
      }
      result.auditLogDeleted = auditResult.changes;
    } catch (e) {
      result.errors.push(
        `Audit Log: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  bumpDataVersion();
  return result;
}

