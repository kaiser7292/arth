import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import type { RecurringFrequency, RecurringTransaction } from "@/services/recurring-detector";
import { confirmRecurring, dismissRecurring, getRecurringTransactions } from "@/services/recurring-detector";
import { settingsStorage } from "@/services/storage";

/**
 * Subscription check: swipe through detected recurring payments — keep, or "cancel this".
 *
 * A card shows up when:
 *   - it was detected but never reviewed (is_confirmed = 0), or
 *   - it was marked to cancel but charged again afterwards ("still charging"), or
 *   - it was kept, but not looked at for REVIEW_EVERY_DAYS (a periodic audit, so the deck isn't
 *     the same list every time you open it).
 *
 * "Last reviewed" is device-local (MMKV): losing it just means an early re-review.
 */

export const REVIEW_EVERY_DAYS = 90;
const REVIEWED_PREFIX = "subscription_reviewed__";

export type SubscriptionReason = "new" | "still_charging" | "periodic";

export interface SubscriptionItem {
  sub: RecurringTransaction;
  reason: SubscriptionReason;
  /** Rough yearly cost, for the "₹X a year" line. */
  yearlyCost: number;
}

const PER_YEAR: Record<RecurringFrequency, number> = {
  weekly: 52,
  monthly: 12,
  last_day_of_month: 12,
  nth_weekday: 12,
  quarterly: 4,
  yearly: 1,
};

export function yearlyCost(amount: number, frequency: RecurringFrequency): number {
  return Math.round(amount * (PER_YEAR[frequency] ?? 12));
}

function lastReviewed(id: string): number {
  return settingsStorage.getNumber(REVIEWED_PREFIX + id) ?? 0;
}

function markReviewed(id: string): void {
  settingsStorage.set(REVIEWED_PREFIX + id, Date.now());
}

/** Pure: which subscriptions need a card, and why. */
export function classifySubscription(
  sub: RecurringTransaction,
  lastReviewedMs: number,
  now: number,
): SubscriptionReason | null {
  if (sub.cancel_requested_at) {
    const requested = sub.cancel_requested_at.slice(0, 10);
    return sub.last_seen_date > requested ? "still_charging" : null;
  }
  if (sub.is_confirmed === 0) return "new";
  if (now - lastReviewedMs > REVIEW_EVERY_DAYS * 86400000) return "periodic";
  return null;
}

const REASON_ORDER: Record<SubscriptionReason, number> = { still_charging: 0, new: 1, periodic: 2 };

export async function getSubscriptionCheckItems(userId: string): Promise<SubscriptionItem[]> {
  const subs = await getRecurringTransactions(userId);
  const now = Date.now();
  const items: SubscriptionItem[] = [];
  for (const sub of subs) {
    const reason = classifySubscription(sub, lastReviewed(sub.id), now);
    if (reason) items.push({ sub, reason, yearlyCost: yearlyCost(sub.amount, sub.frequency) });
  }
  return items.sort((a, b) => REASON_ORDER[a.reason] - REASON_ORDER[b.reason] || b.yearlyCost - a.yearlyCost);
}

export async function keepSubscription(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE recurring_transactions SET cancel_requested_at = NULL, updated_at = datetime('now') WHERE id = ?;`,
    id,
  );
  await confirmRecurring(id);
  markReviewed(id);
}

export async function requestCancelSubscription(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE recurring_transactions SET is_confirmed = 1, cancel_requested_at = datetime('now'), updated_at = datetime('now') WHERE id = ?;`,
    id,
  );
  markReviewed(id);
  bumpDataVersion();
}

/** "Not a subscription" — the detector got it wrong. */
export async function notASubscription(id: string): Promise<void> {
  await dismissRecurring(id);
  markReviewed(id);
}
