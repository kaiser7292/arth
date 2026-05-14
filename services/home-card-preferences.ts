/**
 * Home card visibility preferences (v17.4.0, trimmed in v17.5.2).
 *
 * Every Home card is addressable by an id. User can hide any card from
 * Settings → Preferences → Home cards. v17.5.2 removed the "advisor" and
 * "reconcile" entries — both were dead-end Coming Soon stubs that confused
 * users who enabled them.
 *
 * MMKV-backed. Device-local; intentionally NOT part of backup (prefs pattern
 * matches biometric-lock, locale-preferences, fiscal-year-start-month).
 */

import { settingsStorage } from "./storage";

export type HomeCardId =
  | "min_balance_alert"
  | "upcoming_dues"
  | "review_queue"
  | "total_spent"
  | "hisaab"
  | "insights"
  | "credit_cards"
  | "bank_balances"
  | "wallets"
  | "demat"
  | "reminders"
  | "simulator"
  | "loans";

const KEY_PREFIX = "home_card_hidden__";

export interface HomeCardMeta {
  id: HomeCardId;
  label: string;
  description: string;
  /** Default-visible? (some legacy cards were flag-gated off pre-v17.4.0) */
  defaultVisible: boolean;
}

/**
 * Catalog of Home cards — shown on the Settings preferences screen so the
 * user can toggle any of them on/off.
 */
export const HOME_CARDS: HomeCardMeta[] = [
  {
    id: "min_balance_alert",
    label: "Low-balance alerts",
    description: "Red card when savings dips below the threshold you set",
    defaultVisible: true,
  },
  {
    id: "upcoming_dues",
    label: "Upcoming dues",
    description: "Forecasted expenses + reminder cycles due in the next few days",
    defaultVisible: true,
  },
  {
    id: "review_queue",
    label: "Review Queue",
    description: "Action Required card + standalone Review Queue shortcut in Explore & Tools",
    defaultVisible: true,
  },
  {
    id: "total_spent",
    label: "Total Spent",
    description: "Budget health card showing monthly spend, progress bar, and days remaining",
    defaultVisible: true,
  },
  {
    id: "hisaab",
    label: "Hisaab — Family Ledger",
    description: "Quick access to shared expense tracking with family & friends",
    defaultVisible: true,
  },
  {
    id: "insights",
    label: "Insights & Analytics",
    description: "Merchants, accounts, trends, comparisons and spending patterns",
    defaultVisible: true,
  },
  {
    id: "credit_cards",
    label: "Credit cards",
    description: "Utilization + next statement across all your credit cards",
    defaultVisible: true,
  },
  {
    id: "bank_balances",
    label: "Bank balances",
    description: "Closing balance across your savings accounts",
    defaultVisible: true,
  },
  {
    id: "wallets",
    label: "Wallets",
    description: "Paytm / PhonePe / other wallet balances",
    defaultVisible: true,
  },
  {
    id: "demat",
    label: "Demat portfolio + fund",
    description: "Broker portfolio value + idle cash",
    defaultVisible: true,
  },
  {
    id: "reminders",
    label: "Reminders",
    description: "Active reminders due soon or overdue",
    defaultVisible: true,
  },
  {
    id: "simulator",
    label: "Cash-flow Simulator",
    description: "What-if planner shortcut",
    defaultVisible: true,
  },
  {
    id: "loans",
    label: "Loans summary",
    description: "Total outstanding + next EMI due",
    defaultVisible: true,
  },
];

/**
 * Is the card visible on Home? Checks MMKV override first; falls back to the
 * catalog default. Returns false only when explicitly hidden or the catalog
 * default is hidden and the user hasn't overridden it.
 */
export function isHomeCardVisible(id: HomeCardId): boolean {
  const override = settingsStorage.getBoolean(KEY_PREFIX + id);
  if (override !== undefined) {
    // User set an explicit preference: true=visible, false=hidden
    return override;
  }
  return HOME_CARDS.find((c) => c.id === id)?.defaultVisible ?? true;
}

/** Set whether the card is visible. */
export function setHomeCardVisible(id: HomeCardId, visible: boolean): void {
  settingsStorage.set(KEY_PREFIX + id, visible);
}

/** Reset all cards to catalog defaults. */
export function resetHomeCardPreferences(): void {
  for (const c of HOME_CARDS) {
    settingsStorage.delete(KEY_PREFIX + c.id);
  }
}
