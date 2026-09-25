import type { Href } from "expo-router";
import type { CheckInId } from "@/services/check-ins";

/** Where each check-in deck lives, and what it's called. */
export const CHECK_IN_ROUTES: Record<CheckInId, { href: Href; title: string }> = {
  monthEnd: { href: "/check-in/month-end", title: "Month-end check" },
  settleUp: { href: "/check-in/settle-up", title: "Settle up" },
  subscriptions: { href: "/check-in/subscriptions", title: "Subscriptions" },
  ruleSuggestions: { href: "/check-in/rules", title: "Rule suggestions" },
};
