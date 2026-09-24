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
