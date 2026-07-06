import { getDatabase } from "@/database";
import { settingsStorage as storage } from "@/services/storage";
import { todayIso } from "@/utils/date";
import type { Expense } from "@/services/expense-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReminderAutoMatch {
  ruleId: string;
  /** The reminder's next_due_date at the time of matching. */
  cycleDueDate: string;
  /** All expenses that exactly match this reminder's amount. */
  matches: Expense[];
}

interface DismissedPair {
  ruleId: string;
  expenseId: string;
  dismissedAt: string; // ISO
}

// ---------------------------------------------------------------------------
// MMKV — dismissed match pairs
// ---------------------------------------------------------------------------

const KEY_DISMISSED = "reminder_dismissed_matches";
const DISMISS_TTL_DAYS = 30;

function loadDismissed(): DismissedPair[] {
  try {
    const raw = storage.getString(KEY_DISMISSED);
    return raw ? (JSON.parse(raw) as DismissedPair[]) : [];
  } catch {
    return [];
  }
}

function saveDismissed(pairs: DismissedPair[]): void {
  storage.set(KEY_DISMISSED, JSON.stringify(pairs));
}

export function dismissReminderMatch(ruleId: string, expenseId: string): void {
  const existing = loadDismissed().filter(
    (p) => !(p.ruleId === ruleId && p.expenseId === expenseId),
  );
  existing.push({ ruleId, expenseId, dismissedAt: new Date().toISOString() });
  saveDismissed(existing);
}

export function isDismissed(ruleId: string, expenseId: string): boolean {
  return loadDismissed().some((p) => p.ruleId === ruleId && p.expenseId === expenseId);
}

/** Purge dismissed pairs older than TTL or where the expense no longer exists. */
export function pruneExpiredDismissals(): void {
  const cutoff = Date.now() - DISMISS_TTL_DAYS * 86_400_000;
  const fresh = loadDismissed().filter(
    (p) => new Date(p.dismissedAt).getTime() > cutoff,
  );
  saveDismissed(fresh);
}

/** Clear all dismissals for a rule (called after fulfillReminder advances the cycle). */
export function clearDismissalsForRule(ruleId: string): void {
  saveDismissed(loadDismissed().filter((p) => p.ruleId !== ruleId));
}

// ---------------------------------------------------------------------------
// Core match pass
// ---------------------------------------------------------------------------

/**
 * For every due/overdue active reminder, find approved realized expenses
 * whose amount exactly matches the reminder's source amount, dated within
 * [next_due_date - 5 days, today], not already linked to any rule.
 *
 * Dismissed pairs are excluded. Returns one entry per reminder that has at
 * least one match.
 */
export async function findAutoMatches(userId: string): Promise<ReminderAutoMatch[]> {
  const db = getDatabase();
  const today = todayIso();

  // Load active reminders that are due_soon or overdue.
  // amount: snapshotted from source expense at rule creation (migration 056).
  const rules = await db.getAllAsync<{
    id: string;
    source_expense_id: string;
    next_due_date: string;
    frequency: string;
    amount: number | null;
  }>(
    `SELECT r.id, r.source_expense_id, r.next_due_date, r.frequency, r.amount
     FROM recurring_expense_rules r
     WHERE r.user_id = ? AND r.is_active = 1
       AND r.next_due_date IS NOT NULL
       AND r.next_due_date <= ?
     ORDER BY r.next_due_date ASC;`,
    userId,
    today,
  );

  if (rules.length === 0) return [];

  const dismissed = loadDismissed();
  const dismissedSet = new Set(dismissed.map((p) => `${p.ruleId}::${p.expenseId}`));

  const results: ReminderAutoMatch[] = [];

  for (const rule of rules) {
    // Use snapshotted amount (migration 056). Fall back to live source expense
    // for rules created before the migration ran (amount IS NULL).
    let matchAmount = rule.amount;
    if (matchAmount == null) {
      const source = await db.getFirstAsync<{ amount: number }>(
        `SELECT amount FROM expenses WHERE id = ? AND deleted_at IS NULL;`,
        rule.source_expense_id,
      );
      if (!source) continue;
      matchAmount = source.amount;
    }

    // Window: 5 days before due date up to today.
    const windowStart = (() => {
      const d = new Date(rule.next_due_date + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - 5);
      return d.toISOString().slice(0, 10);
    })();

    // Fetch exact-amount matches in the date window.
    const candidates = await db.getAllAsync<Expense>(
      `SELECT * FROM expenses
       WHERE user_id = ?
         AND nature = 'realized'
         AND status = 'approved'
         AND deleted_at IS NULL
         AND fulfills_rule_id IS NULL
         AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
         AND amount = ?
         AND date >= ?
         AND date <= ?
       ORDER BY date DESC
       LIMIT 10;`,
      userId,
      matchAmount,
      windowStart,
      today,
    );

    // Remove dismissed pairs.
    const undismissed = candidates.filter(
      (e) => !dismissedSet.has(`${rule.id}::${e.id}`),
    );

    if (undismissed.length > 0) {
      results.push({
        ruleId: rule.id,
        cycleDueDate: rule.next_due_date,
        matches: undismissed,
      });
    }
  }

  return results;
}
