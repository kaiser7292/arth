import type { Ionicons } from "@expo/vector-icons";
import type { MoneyEvent } from "@/services/expense-types";

/** How each money event reads in lists, Catch Up and the detail panel. */
export const MONEY_EVENT_META: Record<
  MoneyEvent,
  { tag: string; icon: keyof typeof Ionicons.glyphMap; tone: "primary" | "success"; primaryAction: string; dismissAction: string }
> = {
  fd_open: {
    tag: "Looks like a new fixed deposit",
    icon: "business-outline",
    tone: "primary",
    primaryAction: "Set up FD",
    dismissAction: "It's not an FD",
  },
  fd_closure: {
    tag: "FD / TD closed",
    icon: "business-outline",
    tone: "success",
    primaryAction: "Choose the FD",
    dismissAction: "It's a regular credit",
  },
  self_transfer: {
    tag: "Your own account",
    icon: "swap-horizontal-outline",
    tone: "primary",
    primaryAction: "Pick account",
    dismissAction: "It's not mine",
  },
  sip: {
    tag: "SIP · investment",
    icon: "trending-up-outline",
    tone: "success",
    primaryAction: "Link to bucket",
    dismissAction: "It's not a SIP",
  },
  investment_withdrawal: {
    tag: "Money back from an investment",
    icon: "trending-down-outline",
    tone: "primary",
    primaryAction: "Choose the investment",
    dismissAction: "It's regular income",
  },
};
