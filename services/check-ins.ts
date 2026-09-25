import { getMonthEndPendingCount, isMonthEndWindow } from "@/services/month-end-check";
import { getRuleSuggestions } from "@/services/rule-suggestions";
import { getPeopleWhoOweYou, needsNudge } from "@/services/settle-up-check";
import { getSubscriptionCheckItems } from "@/services/subscription-check";
import { logger } from "@/utils/logger";

/**
 * Counts for the Home "Check-ins" card. Each is independent and failure-isolated — one broken
 * query shows 0 for that deck rather than hiding the card (Home load isolation, see
 * __tests__/unit/home-load-isolation.test.ts for why that matters on Home).
 */
export interface CheckInCounts {
  monthEnd: number;
  ruleSuggestions: number;
  subscriptions: number;
  settleUp: number;
}

async function safe(label: string, fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch (e) {
    logger.warn(`check-ins: ${label} count failed`, e);
    return 0;
  }
}

export async function getCheckInCounts(userId: string, now: Date = new Date()): Promise<CheckInCounts> {
  const [monthEnd, ruleSuggestions, subscriptions, settleUp] = await Promise.all([
    isMonthEndWindow(now) ? safe("month-end", () => getMonthEndPendingCount(userId)) : Promise.resolve(0),
    safe("rules", async () => (await getRuleSuggestions(userId)).length),
    safe("subscriptions", async () => (await getSubscriptionCheckItems(userId)).length),
    safe("settle-up", async () =>
      (await getPeopleWhoOweYou(userId)).filter((p) => needsNudge(p.id, now.getTime())).length,
    ),
  ]);
  return { monthEnd, ruleSuggestions, subscriptions, settleUp };
}

// ─── Moving from one check-in to the next ───

export type CheckInId = keyof CheckInCounts;

/** Order the decks are offered in: Home's Check-ins card and auto-advance both follow it. */
export const CHECK_IN_ORDER: CheckInId[] = ["monthEnd", "settleUp", "subscriptions", "ruleSuggestions"];

/**
 * The next deck to open after finishing `current`: the first one after it (wrapping round) that
 * has something in it and hasn't already been done in this run.
 */
export function pickNextCheckIn(
  counts: CheckInCounts,
  current: CheckInId,
  visited: readonly string[],
): CheckInId | null {
  const n = CHECK_IN_ORDER.length;
  const start = CHECK_IN_ORDER.indexOf(current);
  for (let k = 1; k < n; k++) {
    const id = CHECK_IN_ORDER[(start + k) % n];
    if (id === current || visited.includes(id)) continue;
    if (counts[id] > 0) return id;
  }
  return null;
}
