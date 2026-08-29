/**
 * Recurring reminder rules (v14.7.0 model).
 *
 * A rule is a reminder scheduled for a repeating cadence. It does NOT create
 * forecast expenses. When the actual expense happens (SMS-detected or
 * manually added), the user links it to the reminder — that link advances
 * `next_due_date` to the next cycle and records a row in
 * `reminder_fulfillments` so history is preserved.
 *
 * Key operations:
 *   - createRule: persist the rule, compute the first `next_due_date`, no
 *     expenses created.
 *   - getDueReminders: rules with next_due_date in a window (e.g. 24h
 *     before → 7d after). Used by the home-screen Reminders card.
 *   - findCandidateExpenses: for a pending reminder, return recent expenses
 *     at the same merchant as the source — candidates to link.
 *   - fulfillReminder(ruleId, expenseId): insert fulfillment row, stamp
 *     expenses.fulfills_rule_id, advance the rule's next_due_date by one
 *     cycle (from the *cycle's due date*, not today).
 *   - unfulfillReminder(expenseId): reverse a fulfillment — delete the
 *     fulfillment row, clear the stamp, rewind next_due_date.
 *   - getReminderForExpense: given an incoming realized expense, find an
 *     active rule whose source has the same merchant and whose next_due_date
 *     falls within ±7 days of the expense date. Used for the suggestion
 *     banner.
 *   - stopRule / updateRule / onSourceExpenseDeleted: unchanged from v14.6.0.
 */

import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { bumpDataVersion } from "@/services/settings";
import { todayIso } from "@/utils/date";
import { splitExistingExpense } from "./expense-splits";
import { applyMultiSplit } from "./expense-multi-split";
import type { Expense, SplitConfig, SplitMode } from "./expense-types";
import type { RecurringFrequency } from "./recurring-detector";

export type { RecurringFrequency };

export interface RecurringRule {
  id: string;
  user_id: string;
  source_expense_id: string;
  frequency: RecurringFrequency;
  start_date: string;
  end_date: string | null;
  /** For nth_weekday: 1=first, 2=second, 3=third, 4=fourth, -1=last occurrence. */
  repeat_ordinal: number | null;
  /** For nth_weekday: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat. */
  repeat_weekday: number | null;
  /** Legacy from v14.6.0; not written anymore. */
  last_materialized_date: string | null;
  /** The next reminder date. Advances when a cycle is fulfilled. */
  next_due_date: string | null;
  is_active: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** migration 056 — snapshotted from source expense at rule creation. */
  amount: number | null;
}

export interface CreateRuleInput {
  source_expense_id: string;
  frequency: RecurringFrequency;
  /** YYYY-MM-DD — the date of the first occurrence (usually the source's date). */
  start_date: string;
  /** For nth_weekday: which occurrence (1–4 or -1 for last). */
  repeat_ordinal?: number | null;
  /** For nth_weekday: day of week (0=Sun … 6=Sat). */
  repeat_weekday?: number | null;
  /** Optional last-occurrence date; rule auto-deactivates when next > end. */
  end_date?: string | null;
  notes?: string | null;
}

export interface ReminderWithSource {
  rule: RecurringRule;
  source: Expense | null;
  /** Last fulfillment row for this rule (most recent cycle), if any. */
  lastFulfillment: ReminderFulfillment | null;
  /** Current cycle state derived from next_due_date vs today. */
  state: "upcoming" | "due_soon" | "overdue";
}

export interface ReminderFulfillment {
  id: string;
  rule_id: string;
  expense_id: string;
  cycle_due_date: string;
  fulfilled_at: string;
}

/** Returns the Nth occurrence of `weekday` in the given UTC month (0-indexed). ordinal -1 = last. */
function nthWeekdayOfMonth(year: number, month: number, ordinal: number, weekday: number): string {
  if (ordinal === -1) {
    const last = new Date(Date.UTC(year, month + 1, 0));
    while (last.getUTCDay() !== weekday) last.setUTCDate(last.getUTCDate() - 1);
    return last.toISOString().slice(0, 10);
  }
  const first = new Date(Date.UTC(year, month, 1));
  let diff = weekday - first.getUTCDay();
  if (diff < 0) diff += 7;
  first.setUTCDate(first.getUTCDate() + diff + (ordinal - 1) * 7);
  if (first.getUTCMonth() !== month) {
    // Requested ordinal doesn't exist this month (e.g. 5th Monday) — use last.
    return nthWeekdayOfMonth(year, month, -1, weekday);
  }
  return first.toISOString().slice(0, 10);
}

/** Add one cycle of `frequency` to `iso` (YYYY-MM-DD). */
function addCycle(iso: string, frequency: RecurringFrequency, repeatOrdinal?: number | null, repeatWeekday?: number | null): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (frequency === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  else if (frequency === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
  else if (frequency === "quarterly") date.setUTCMonth(date.getUTCMonth() + 3);
  else if (frequency === "yearly") date.setUTCFullYear(date.getUTCFullYear() + 1);
  else if (frequency === "last_day_of_month") {
    // Last day of the month following the current date's month.
    date.setUTCMonth(date.getUTCMonth() + 2, 0);
  } else if (frequency === "nth_weekday" && repeatOrdinal != null && repeatWeekday != null) {
    const nextMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    return nthWeekdayOfMonth(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), repeatOrdinal, repeatWeekday);
  }
  return date.toISOString().slice(0, 10);
}

function assertISODate(date: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${field} must be YYYY-MM-DD`);
  }
}

/**
 * Compute the first `next_due_date` for a new rule. If start_date is today
 * or in the future, use it as-is. If start_date is in the past, project
 * forward to the first future cycle so the user isn't greeted with a stale
 * "overdue" reminder the moment they turn recurring on.
 */
function firstNextDue(startDate: string, frequency: RecurringFrequency, repeatOrdinal?: number | null, repeatWeekday?: number | null): string {
  const today = todayIso();
  let due = startDate;
  while (due < today) due = addCycle(due, frequency, repeatOrdinal, repeatWeekday);
  return due;
}

export async function createRule(
  userId: string,
  input: CreateRuleInput,
): Promise<string> {
  assertISODate(input.start_date, "start_date");
  if (input.end_date) assertISODate(input.end_date, "end_date");

  const db = getDatabase();
  // source_expense_id carries a DB-level UNIQUE constraint (migration 013),
  // so we must inspect ANY existing row regardless of is_active — a stopped
  // rule would still cause an INSERT to fail with "UNIQUE constraint failed".
  // Three shapes:
  //   1. Active rule for this expense → refuse with a clear error.
  //   2. Stopped rule (is_active=0) → reactivate + overwrite with new inputs.
  //      Matches user mental model: "Set reminder" again = resume, not duplicate.
  //   3. No row → plain INSERT as before.
  const existing = await db.getFirstAsync<{ id: string; is_active: number }>(
    "SELECT id, is_active FROM recurring_expense_rules WHERE source_expense_id = ?;",
    input.source_expense_id,
  );

  // Snapshot the pre-split total so matching works against full SMS amounts
  // even when the source expense has a split applied (migration 056).
  // split_original_amount is the full amount before split; amount is the
  // user's reduced share. We always want to match on the full SMS amount.
  const sourceExpense = await db.getFirstAsync<{
    amount: number;
    split_original_amount: number | null;
    category_id: string | null;
    description: string | null;
    split_person_id: string | null;
    split_pct: number | null;
    split_hisaab_entry_id: string | null;
    split_mode: string | null;
    split_exact_amount: number | null;
  }>(
    `SELECT amount, split_original_amount, category_id, description,
            split_person_id, split_pct, split_hisaab_entry_id,
            split_mode, split_exact_amount
     FROM expenses WHERE id = ? AND deleted_at IS NULL;`,
    input.source_expense_id,
  );
  const snapshotAmount = sourceExpense
    ? (sourceExpense.split_original_amount ?? sourceExpense.amount)
    : null;

  const nextDue = firstNextDue(input.start_date, input.frequency, input.repeat_ordinal, input.repeat_weekday);

  if (existing) {
    if (existing.is_active === 1) {
      throw new Error("This expense already has an active recurring reminder.");
    }
    // Reactivate the stopped row, overwrite with new config, reset next_due_date.
    await db.runAsync(
      `UPDATE recurring_expense_rules
       SET frequency = ?,
           start_date = ?,
           end_date = ?,
           notes = ?,
           next_due_date = ?,
           amount = ?,
           repeat_ordinal = ?,
           repeat_weekday = ?,
           is_active = 1,
           updated_at = datetime('now')
       WHERE id = ?;`,
      input.frequency,
      input.start_date,
      input.end_date ?? null,
      input.notes ?? null,
      nextDue,
      snapshotAmount,
      input.repeat_ordinal ?? null,
      input.repeat_weekday ?? null,
      existing.id,
    );
    bumpDataVersion();
    return existing.id;
  }

  const ruleId = generateUUID();
  await db.runAsync(
    `INSERT INTO recurring_expense_rules
       (id, user_id, source_expense_id, frequency, start_date, end_date, notes, next_due_date, amount, repeat_ordinal, repeat_weekday)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    ruleId,
    userId,
    input.source_expense_id,
    input.frequency,
    input.start_date,
    input.end_date ?? null,
    input.notes ?? null,
    nextDue,
    snapshotAmount,
    input.repeat_ordinal ?? null,
    input.repeat_weekday ?? null,
  );

  bumpDataVersion();
  return ruleId;
}

export async function stopRule(ruleId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "UPDATE recurring_expense_rules SET is_active = 0, updated_at = datetime('now') WHERE id = ?;",
    ruleId,
  );
  bumpDataVersion();
}

export async function updateRule(
  ruleId: string,
  patch: {
    frequency?: RecurringFrequency;
    end_date?: string | null;
    notes?: string | null;
    next_due_date?: string | null;
    amount?: number | null;
    repeat_ordinal?: number | null;
    repeat_weekday?: number | null;
  },
): Promise<void> {
  const db = getDatabase();
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.frequency !== undefined) {
    sets.push("frequency = ?");
    values.push(patch.frequency);
  }
  if (patch.end_date !== undefined) {
    if (patch.end_date) assertISODate(patch.end_date, "end_date");
    sets.push("end_date = ?");
    values.push(patch.end_date ?? null);
  }
  if (patch.next_due_date !== undefined) {
    if (patch.next_due_date) assertISODate(patch.next_due_date, "next_due_date");
    sets.push("next_due_date = ?");
    values.push(patch.next_due_date ?? null);
  }
  if (patch.amount !== undefined) {
    sets.push("amount = ?");
    values.push(patch.amount ?? null);
  }
  if (patch.notes !== undefined) {
    sets.push("notes = ?");
    values.push(patch.notes ?? null);
  }
  if (patch.repeat_ordinal !== undefined) {
    sets.push("repeat_ordinal = ?");
    values.push(patch.repeat_ordinal ?? null);
  }
  if (patch.repeat_weekday !== undefined) {
    sets.push("repeat_weekday = ?");
    values.push(patch.repeat_weekday ?? null);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  values.push(ruleId);
  await db.runAsync(
    `UPDATE recurring_expense_rules SET ${sets.join(", ")} WHERE id = ?;`,
    ...values,
  );
  bumpDataVersion();
}

export async function getRuleForExpense(
  sourceExpenseId: string,
): Promise<RecurringRule | null> {
  const db = getDatabase();
  return db.getFirstAsync<RecurringRule>(
    "SELECT * FROM recurring_expense_rules WHERE source_expense_id = ? AND is_active = 1;",
    sourceExpenseId,
  );
}

export async function getActiveRules(userId: string): Promise<RecurringRule[]> {
  const db = getDatabase();
  return db.getAllAsync<RecurringRule>(
    `SELECT * FROM recurring_expense_rules
     WHERE user_id = ? AND is_active = 1
     ORDER BY next_due_date ASC;`,
    userId,
  );
}

/**
 * Get an active rule's last fulfillment (most recent cycle), if any.
 * Used to render "Last paid: ₹15,500 on 2026-04-28" on the reminder card.
 */
export async function getLastFulfillment(
  ruleId: string,
): Promise<ReminderFulfillment | null> {
  const db = getDatabase();
  return db.getFirstAsync<ReminderFulfillment>(
    `SELECT * FROM reminder_fulfillments
     WHERE rule_id = ?
     ORDER BY cycle_due_date DESC LIMIT 1;`,
    ruleId,
  );
}

/**
 * Reminders for the home card — all active rules, each enriched with its
 * source expense (for merchant/description display) and last fulfillment
 * (for "last paid" line). Sorted by due date ascending.
 *
 * `state` classifies each:
 *   - overdue: next_due_date is strictly before today
 *   - due_soon: next_due_date is today or tomorrow
 *   - upcoming: next_due_date is 2+ days away
 *
 * Home card should show overdue + due_soon. Settings list shows all.
 */
export async function getReminders(userId: string): Promise<ReminderWithSource[]> {
  const db = getDatabase();
  const rules = await db.getAllAsync<RecurringRule>(
    `SELECT * FROM recurring_expense_rules
     WHERE user_id = ? AND is_active = 1
     ORDER BY next_due_date ASC;`,
    userId,
  );
  if (rules.length === 0) return [];

  const today = todayIso();
  const tomorrowDate = new Date(today + "T00:00:00Z");
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tmrwIso = tomorrowDate.toISOString().slice(0, 10);

  // Perf (v14.8.0): fan-out sources + last-fulfillments in 2 batched queries
  // rather than N+1 per rule. For 20 rules this drops 40 serial round-trips
  // to 2 parallel ones.
  const sourceIds = rules.map((r) => r.source_expense_id);
  const ruleIds = rules.map((r) => r.id);
  const placeholdersSource = sourceIds.map(() => "?").join(",");
  const placeholdersRule = ruleIds.map(() => "?").join(",");

  const [sources, latestFulfillments] = await Promise.all([
    db.getAllAsync<Expense>(
      `SELECT * FROM expenses
       WHERE id IN (${placeholdersSource}) AND deleted_at IS NULL;`,
      ...sourceIds,
    ),
    // Latest fulfillment per rule via a correlated "latest per group" query.
    db.getAllAsync<ReminderFulfillment>(
      `SELECT f.* FROM reminder_fulfillments f
       WHERE f.rule_id IN (${placeholdersRule})
         AND f.cycle_due_date = (
           SELECT MAX(cycle_due_date) FROM reminder_fulfillments
           WHERE rule_id = f.rule_id
         );`,
      ...ruleIds,
    ),
  ]);

  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const fulfillmentByRule = new Map(
    latestFulfillments.map((f) => [f.rule_id, f]),
  );

  return rules.map((rule) => {
    const source = sourceById.get(rule.source_expense_id) ?? null;
    const lastFulfillment = fulfillmentByRule.get(rule.id) ?? null;

    let state: ReminderWithSource["state"];
    if (!rule.next_due_date) state = "upcoming";
    else if (rule.next_due_date < today) state = "overdue";
    else if (rule.next_due_date <= tmrwIso) state = "due_soon";
    else state = "upcoming";

    return { rule, source, lastFulfillment, state };
  });
}

/**
 * Home-card subset: rules that are due_soon or overdue. These are the ones
 * the user should act on right now.
 */
export async function getDueReminders(userId: string): Promise<ReminderWithSource[]> {
  const all = await getReminders(userId);
  return all.filter((r) => r.state === "due_soon" || r.state === "overdue");
}

/**
 * Find recent realized expenses that might fulfill a pending reminder.
 * Matches by merchant (same as source's merchant_name) within the last 30
 * days, excluding expenses already linked to a rule.
 */
export async function findCandidateExpenses(ruleId: string): Promise<Expense[]> {
  const db = getDatabase();
  const rule = await db.getFirstAsync<RecurringRule>(
    "SELECT * FROM recurring_expense_rules WHERE id = ?;",
    ruleId,
  );
  if (!rule) return [];
  const source = await db.getFirstAsync<Expense>(
    "SELECT * FROM expenses WHERE id = ?;",
    rule.source_expense_id,
  );
  if (!source) return [];

  const today = todayIso();
  const thirtyDaysAgo = new Date(today + "T00:00:00Z");
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const thirtyDaysAgoIso = thirtyDaysAgo.toISOString().slice(0, 10);

  if (source.merchant_name) {
    return db.getAllAsync<Expense>(
      `SELECT * FROM expenses
       WHERE user_id = ?
         AND nature = 'realized'
         AND status != 'rejected'
         AND deleted_at IS NULL
         AND fulfills_rule_id IS NULL
         AND merchant_name = ?
         AND date >= ?
       ORDER BY date DESC LIMIT 20;`,
      source.user_id,
      source.merchant_name,
      thirtyDaysAgoIso,
    );
  }
  // No merchant — broaden to any recent unlinked expense in the same account.
  return db.getAllAsync<Expense>(
    `SELECT * FROM expenses
     WHERE user_id = ?
       AND nature = 'realized'
       AND status != 'rejected'
       AND deleted_at IS NULL
       AND fulfills_rule_id IS NULL
       AND account_id IS NOT NULL
       AND account_id = ?
       AND date >= ?
     ORDER BY date DESC LIMIT 20;`,
    source.user_id,
    source.account_id ?? "",
    thirtyDaysAgoIso,
  );
}

/**
 * Mark a rule's current cycle as fulfilled by an expense. Stamps
 * expenses.fulfills_rule_id, inserts a reminder_fulfillments row, and
 * advances the rule's next_due_date by one cycle from the CYCLE's due date
 * (not from today).
 *
 * If the rule has an end_date and the next cycle would exceed it, the rule
 * is auto-stopped.
 */
export async function fulfillReminder(
  ruleId: string,
  expenseId: string,
): Promise<void> {
  const db = getDatabase();
  const rule = await db.getFirstAsync<RecurringRule>(
    "SELECT * FROM recurring_expense_rules WHERE id = ? AND is_active = 1;",
    ruleId,
  );
  if (!rule) throw new Error("Reminder not found or no longer active.");
  if (!rule.next_due_date) throw new Error("Reminder has no due date set.");

  // Make sure the expense isn't already linked to a rule.
  const existingLink = await db.getFirstAsync<{ fulfills_rule_id: string | null }>(
    "SELECT fulfills_rule_id FROM expenses WHERE id = ?;",
    expenseId,
  );
  if (existingLink?.fulfills_rule_id) {
    throw new Error("This expense is already linked to a reminder.");
  }

  const cycleDue = rule.next_due_date;
  const fulfillmentId = generateUUID();

  // Load source expense fields to copy over to the matched expense.
  const src = await db.getFirstAsync<{
    category_id: string | null;
    description: string | null;
    split_person_id: string | null;
    split_pct: number | null;
    split_hisaab_entry_id: string | null;
    split_mode: string | null;
    split_exact_amount: number | null;
  }>(
    `SELECT category_id, description, split_person_id, split_pct,
            split_hisaab_entry_id, split_mode, split_exact_amount
     FROM expenses WHERE id = ? AND deleted_at IS NULL;`,
    rule.source_expense_id,
  );

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO reminder_fulfillments (id, rule_id, expense_id, cycle_due_date)
       VALUES (?, ?, ?, ?);`,
      fulfillmentId,
      ruleId,
      expenseId,
      cycleDue,
    );

    // Stamp the fulfillment link and copy category + description from the
    // source expense — only when the source has a non-null value.
    const sets: string[] = ["fulfills_rule_id = ?"];
    const vals: (string | number | null)[] = [ruleId];
    if (src?.category_id != null) { sets.push("category_id = ?"); vals.push(src.category_id); }
    if (src?.description != null) { sets.push("description = ?"); vals.push(src.description); }
    sets.push("updated_at = datetime('now')");
    vals.push(expenseId);
    await db.runAsync(
      `UPDATE expenses SET ${sets.join(", ")} WHERE id = ?;`,
      ...vals,
    );

    const nextCycle = addCycle(cycleDue, rule.frequency, rule.repeat_ordinal, rule.repeat_weekday);
    if (rule.end_date && nextCycle > rule.end_date) {
      // Rule run finished.
      await db.runAsync(
        `UPDATE recurring_expense_rules SET is_active = 0, next_due_date = NULL,
            updated_at = datetime('now') WHERE id = ?;`,
        ruleId,
      );
    } else {
      await db.runAsync(
        `UPDATE recurring_expense_rules SET next_due_date = ?,
            updated_at = datetime('now') WHERE id = ?;`,
        nextCycle,
        ruleId,
      );
    }
  });

  // Apply the source's split to the matched expense (outside the transaction
  // since splitExistingExpense / applyMultiSplit manage their own transactions).
  if (src?.split_person_id && src.split_pct != null) {
    try {
      // Determine paidBy from the source hisaab entry type.
      let paidBy: "me" | string = "me";
      if (src.split_hisaab_entry_id) {
        const entry = await db.getFirstAsync<{ type: string }>(
          `SELECT type FROM hisaab_entries WHERE id = ?;`,
          src.split_hisaab_entry_id,
        );
        if (entry?.type === "credit") paidBy = "they";
      }
      const splitMode = (src.split_mode as SplitMode | null) ?? "percentage";
      const config: SplitConfig = {
        personId: src.split_person_id,
        paidBy,
        splitMode,
        exactAmount: src.split_exact_amount ?? undefined,
        percentage: splitMode === "percentage" ? 100 - src.split_pct : undefined,
      };
      await splitExistingExpense(expenseId, config);
    } catch (e) {
      // Non-fatal — split apply failure shouldn't undo the fulfillment.
    }
  } else if (src) {
    // Check for multi-person split.
    try {
      const multiSplits = await db.getAllAsync<{
        hisaab_person_id: string;
        description: string | null;
        amount: number;
      }>(
        `SELECT hisaab_person_id, description, amount FROM expense_splits WHERE expense_id = ?;`,
        rule.source_expense_id,
      );
      if (multiSplits.length > 0) {
        await applyMultiSplit(expenseId, {
          splits: multiSplits.map((s) => ({
            personId: s.hisaab_person_id,
            description: s.description ?? "",
            amount: s.amount,
          })),
          feeAbsorbed: false,
        });
      }
    } catch (e) {
      // Non-fatal.
    }
  }

  bumpDataVersion();

  const statusRow = await db.getFirstAsync<{ status: string }>(
    `SELECT status FROM expenses WHERE id = ?;`, expenseId,
  );
  if (statusRow?.status === "pending_review") {
    const { approveExpense } = await import("@/services/expense-crud");
    await approveExpense(expenseId);
  }
}

/**
 * Reverse a fulfillment — clears the expense stamp, deletes the fulfillment
 * row, and rewinds the rule's next_due_date to the cycle that was unwound
 * (only if that cycle is earlier than the current next_due_date — otherwise
 * leave it alone, because a later fulfillment may have advanced things).
 *
 * Re-activates a stopped-because-end_date-reached rule so the user's undo
 * actually brings it back.
 */
export async function unfulfillReminder(expenseId: string): Promise<void> {
  const db = getDatabase();
  const fulfillment = await db.getFirstAsync<ReminderFulfillment>(
    "SELECT * FROM reminder_fulfillments WHERE expense_id = ?;",
    expenseId,
  );
  if (!fulfillment) return;

  const rule = await db.getFirstAsync<RecurringRule>(
    "SELECT * FROM recurring_expense_rules WHERE id = ?;",
    fulfillment.rule_id,
  );

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "DELETE FROM reminder_fulfillments WHERE id = ?;",
      fulfillment.id,
    );
    await db.runAsync(
      "UPDATE expenses SET fulfills_rule_id = NULL, updated_at = datetime('now') WHERE id = ?;",
      expenseId,
    );
    if (rule) {
      const rewoundDue = fulfillment.cycle_due_date;
      const current = rule.next_due_date;
      const needsRewind = !current || current > rewoundDue;
      const newActive = rule.is_active === 1 ? 1 : 1; // always re-activate
      if (needsRewind) {
        await db.runAsync(
          `UPDATE recurring_expense_rules
           SET next_due_date = ?, is_active = ?, updated_at = datetime('now')
           WHERE id = ?;`,
          rewoundDue,
          newActive,
          rule.id,
        );
      } else if (rule.is_active === 0) {
        await db.runAsync(
          `UPDATE recurring_expense_rules
           SET is_active = 1, updated_at = datetime('now') WHERE id = ?;`,
          rule.id,
        );
      }
    }
  });
  bumpDataVersion();
}

/**
 * Skip the current cycle — user decides they don't owe this cycle.
 * Advances next_due_date by one cycle without creating a fulfillment row.
 */
export async function skipReminderCycle(ruleId: string): Promise<void> {
  const db = getDatabase();
  const rule = await db.getFirstAsync<RecurringRule>(
    "SELECT * FROM recurring_expense_rules WHERE id = ? AND is_active = 1;",
    ruleId,
  );
  if (!rule || !rule.next_due_date) return;
  const nextCycle = addCycle(rule.next_due_date, rule.frequency, rule.repeat_ordinal, rule.repeat_weekday);
  if (rule.end_date && nextCycle > rule.end_date) {
    await db.runAsync(
      `UPDATE recurring_expense_rules SET is_active = 0, next_due_date = NULL,
          updated_at = datetime('now') WHERE id = ?;`,
      ruleId,
    );
  } else {
    await db.runAsync(
      `UPDATE recurring_expense_rules SET next_due_date = ?,
          updated_at = datetime('now') WHERE id = ?;`,
      nextCycle,
      ruleId,
    );
  }
  bumpDataVersion();
}

/**
 * For a realized expense, suggest a pending reminder to link it to.
 * Returns the best match (same merchant, next_due_date within ±7 days of
 * the expense date) or null.
 */
export async function suggestReminderForExpense(
  expense: Expense,
): Promise<RecurringRule | null> {
  if (expense.nature !== "realized") return null;
  if (expense.fulfills_rule_id) return null;
  if (!expense.merchant_name) return null;

  const db = getDatabase();
  return db.getFirstAsync<RecurringRule>(
    `SELECT r.* FROM recurring_expense_rules r
     JOIN expenses src ON src.id = r.source_expense_id AND src.deleted_at IS NULL
     WHERE r.user_id = ? AND r.is_active = 1
       AND r.next_due_date IS NOT NULL
       AND src.merchant_name = ?
       AND r.next_due_date >= date(?, '-7 days')
       AND r.next_due_date <= date(?, '+7 days')
     ORDER BY ABS(julianday(r.next_due_date) - julianday(?)) ASC
     LIMIT 1;`,
    expense.user_id,
    expense.merchant_name,
    expense.date,
    expense.date,
    expense.date,
  );
}

/**
 * Auto-stop when the source expense is soft-deleted.
 * Existing fulfillments stay (they're history of real paid expenses).
 */
export async function onSourceExpenseDeleted(expenseId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE recurring_expense_rules SET is_active = 0, updated_at = datetime('now')
     WHERE source_expense_id = ? AND is_active = 1;`,
    expenseId,
  );
}

export interface ReminderHistoryEntry {
  fulfillmentId: string;
  cycleDueDate: string;
  fulfilledAt: string;
  expense: {
    id: string;
    date: string;
    amount: number;
    merchant_name: string | null;
    description: string | null;
  };
}

export interface ReminderDetail {
  rule: RecurringRule;
  source: Expense | null;
  history: ReminderHistoryEntry[];
}

/**
 * Full detail for a single reminder rule: rule row + source expense + all
 * fulfillment history (most-recent-cycle first). Returns null if the rule
 * doesn't exist.
 */
export async function getReminderDetail(ruleId: string): Promise<ReminderDetail | null> {
  const db = getDatabase();
  const rule = await db.getFirstAsync<RecurringRule>(
    "SELECT * FROM recurring_expense_rules WHERE id = ?;",
    ruleId,
  );
  if (!rule) return null;

  const source = rule.source_expense_id
    ? await db.getFirstAsync<Expense>(
        "SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL;",
        rule.source_expense_id,
      ) ?? null
    : null;

  const rows = await db.getAllAsync<{
    fulfillmentId: string;
    cycleDueDate: string;
    fulfilledAt: string;
    expenseId: string;
    expenseDate: string;
    expenseAmount: number;
    merchantName: string | null;
    description: string | null;
  }>(
    `SELECT f.id AS fulfillmentId,
            f.cycle_due_date AS cycleDueDate,
            f.fulfilled_at AS fulfilledAt,
            e.id AS expenseId,
            e.date AS expenseDate,
            e.amount AS expenseAmount,
            e.merchant_name AS merchantName,
            e.description
     FROM reminder_fulfillments f
     JOIN expenses e ON e.id = f.expense_id
     WHERE f.rule_id = ?
     ORDER BY f.cycle_due_date DESC;`,
    ruleId,
  );

  return {
    rule,
    source,
    history: rows.map((r) => ({
      fulfillmentId: r.fulfillmentId,
      cycleDueDate: r.cycleDueDate,
      fulfilledAt: r.fulfilledAt,
      expense: {
        id: r.expenseId,
        date: r.expenseDate,
        amount: r.expenseAmount,
        merchant_name: r.merchantName,
        description: r.description,
      },
    })),
  };
}

/**
 * When an expense that fulfills a reminder is deleted, also unfulfill it.
 * Called from expense-crud.deleteExpense.
 */
export async function onFulfillingExpenseDeleted(expenseId: string): Promise<void> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ fulfills_rule_id: string | null }>(
    "SELECT fulfills_rule_id FROM expenses WHERE id = ?;",
    expenseId,
  );
  if (!row?.fulfills_rule_id) return;
  await unfulfillReminder(expenseId);
}
