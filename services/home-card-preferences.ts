/**
 * Home cards: which are on and in what order (Settings → Customise Arth). Every Home card is
 * addressable by an id. A card also goes when the feature or tab it belongs to is switched off.
 *
 * MMKV-backed and part of backups (SETTINGS_REGISTRY).
 */

import { customiseChanged, isPartOn, resetParts, type PartId } from "./customise";
import { settingsStorage } from "./storage";

export type HomeCardId =
  | "min_balance_alert"
  | "upcoming_dues"
  | "check_ins"
  | "my_month"
  | "total_spent"
  | "hisaab"
  | "household"
  | "credit_cards"
  | "bank_balances"
  | "wallets"
  | "investments"
  | "reminders"
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
    id: "check_ins",
    label: "Check-ins",
    description: "Month-end check, settle-up, subscriptions and rule suggestions when there's something to swipe through",
    defaultVisible: true,
  },
  {
    id: "my_month",
    label: "My Month: cash flow",
    description: "Money in, money out and what's left this month",
    defaultVisible: true,
  },
  {
    id: "total_spent",
    label: "My Month: budget",
    description: "How you're doing against the budget you set. Only shows once you've set one",
    defaultVisible: true,
  },
  {
    id: "hisaab",
    label: "Hisaab — Family Ledger",
    description: "Quick access to shared expense tracking with family & friends",
    defaultVisible: true,
  },
  {
    id: "household",
    label: "Together — Household",
    description: "What your household spent together this month and who owes whom (only when you're in a household)",
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
    id: "investments",
    label: "Investments",
    description: "Total value across demat, pension, and fixed deposit accounts",
    defaultVisible: true,
  },
  {
    id: "reminders",
    label: "Reminders",
    description: "Active reminders due soon or overdue",
    defaultVisible: true,
  },
  {
    id: "loans",
    label: "Loans summary",
    description: "Total outstanding + next EMI due",
    defaultVisible: true,
  },
];

/** The feature or tab a card goes away with. */
const CARD_OWNERS: Partial<Record<HomeCardId, PartId>> = {
  hisaab: "hisaab",
  household: "together",
  investments: "investments",
  loans: "loans",
  total_spent: "budget",
};

export function owningPart(id: HomeCardId): PartId | null {
  return CARD_OWNERS[id] ?? null;
}

/** The card's own switch, whatever its feature is doing. */
export function isHomeCardSwitchedOn(id: HomeCardId): boolean {
  const override = settingsStorage.getBoolean(KEY_PREFIX + id);
  if (override !== undefined) return override;
  return HOME_CARDS.find((c) => c.id === id)?.defaultVisible ?? true;
}

/** Does the card show on Home? Its own switch, and its feature or tab being on. */
export function isHomeCardVisible(id: HomeCardId): boolean {
  const owner = CARD_OWNERS[id];
  if (owner && !isPartOn(owner)) return false;
  return isHomeCardSwitchedOn(id);
}

/** Set whether the card is visible. */
export function setHomeCardVisible(id: HomeCardId, visible: boolean): void {
  settingsStorage.set(KEY_PREFIX + id, visible);
  customiseChanged();
}

// ─── Order ───

/** The cards that can be moved, as Home has always had them. Low-balance alerts stay on top; the budget part sits inside My Month. */
export const HOME_CARD_DEFAULT_ORDER: HomeCardId[] = [
  "check_ins",
  "my_month",
  "reminders",
  "upcoming_dues",
  "hisaab",
  "household",
  "credit_cards",
  "bank_balances",
  "wallets",
  "investments",
  "loans",
];

const ORDER_KEY = "home_card_order";

export type HomeGroupId = "month" | "people" | "accounts";

/**
 * The group each card belongs to, and the title it sits under. Order is entirely the user's: a card
 * can go anywhere and a block of cards can move together. A card moved out of its group takes its
 * title with it, so every card is always under the right one.
 */
const HOME_GROUPS: { id: HomeGroupId; title: string; cards: HomeCardId[] }[] = [
  { id: "month", title: "This Month", cards: ["check_ins", "my_month", "reminders", "upcoming_dues"] },
  { id: "people", title: "People & Money", cards: ["hisaab", "household"] },
  { id: "accounts", title: "Your Accounts", cards: ["credit_cards", "bank_balances", "wallets", "investments", "loans"] },
];
const groupOf = (id: HomeCardId) => HOME_GROUPS.find((g) => g.cards.includes(id));

/** The saved order. Cards it doesn't know keep their default place at the end; ones that no longer exist drop out. */
export function getHomeCardOrder(): HomeCardId[] {
  let saved: string[] = [];
  try {
    saved = JSON.parse(settingsStorage.getString(ORDER_KEY) ?? "[]");
  } catch {
    saved = [];
  }
  if (!Array.isArray(saved)) saved = [];
  const known = saved.filter((id): id is HomeCardId => HOME_CARD_DEFAULT_ORDER.includes(id as HomeCardId));
  return [...known, ...HOME_CARD_DEFAULT_ORDER.filter((id) => !known.includes(id))];
}

export interface HomeCardBlock {
  group: HomeGroupId;
  title: string;
  cards: HomeCardId[];
}

/** The order as blocks: cards of one group side by side. A group split by another card is two blocks. */
export function getHomeCardBlocks(order: HomeCardId[] = getHomeCardOrder()): HomeCardBlock[] {
  const blocks: HomeCardBlock[] = [];
  for (const id of order) {
    const group = groupOf(id);
    if (!group) continue;
    const last = blocks[blocks.length - 1];
    if (last?.group === group.id) last.cards.push(id);
    else blocks.push({ group: group.id, title: group.title, cards: [id] });
  }
  return blocks;
}

/**
 * Which cards get a title above them: wherever the group changes, counting only cards actually on
 * screen, so a title never sits over nothing. Home opens with the month's cards untitled, as it always
 * has. Anywhere lower they need their title like any other.
 */
export function homeCardHeadings(order: HomeCardId[], isPresent: (id: HomeCardId) => boolean): Partial<Record<HomeCardId, string>> {
  const headings: Partial<Record<HomeCardId, string>> = {};
  let current: HomeGroupId | null = null;
  for (const id of order) {
    if (!isPresent(id)) continue;
    const group = groupOf(id);
    if (!group || group.id === current) continue;
    if (current !== null || group.id !== "month") headings[id] = group.title;
    current = group.id;
  }
  return headings;
}

export function isDefaultHomeCardOrder(): boolean {
  return getHomeCardOrder().every((id, i) => id === HOME_CARD_DEFAULT_ORDER[i]);
}

/** One place up (-1) or down (1), across groups if that's where the next place is. */
export function moveHomeCard(id: HomeCardId, by: -1 | 1): void {
  const order = getHomeCardOrder();
  const from = order.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= order.length) return;
  [order[from], order[to]] = [order[to], order[from]];
  settingsStorage.set(ORDER_KEY, JSON.stringify(order));
  customiseChanged();
}

/** A whole block, identified by its first card, past the block above (-1) or below (1). */
export function moveHomeBlock(firstCard: HomeCardId, by: -1 | 1): void {
  const blocks = getHomeCardBlocks();
  const from = blocks.findIndex((b) => b.cards[0] === firstCard);
  const to = from + by;
  if (from < 0 || to < 0 || to >= blocks.length) return;
  [blocks[from], blocks[to]] = [blocks[to], blocks[from]];
  settingsStorage.set(ORDER_KEY, JSON.stringify(blocks.flatMap((b) => b.cards)));
  customiseChanged();
}

/** Everything back on, in the original order. */
export function resetCustomisation(): void {
  for (const c of HOME_CARDS) {
    settingsStorage.delete(KEY_PREFIX + c.id);
  }
  settingsStorage.delete(ORDER_KEY);
  resetParts();
  customiseChanged();
}

/**
 * One-time migration (Item 10 Phase 3): the separate "demat" and "pension"
 * Home cards merged into a single "investments" card. If the user had
 * explicitly hidden either old card, carry that intent forward by hiding the
 * merged card too — otherwise the merge would silently un-hide a card they'd
 * turned off. A no-op once "investments" has any explicit preference (first
 * run, or the user has already toggled it themselves).
 */
export function migrateInvestmentsHomeCardPreference(): void {
  const key = KEY_PREFIX + "investments";
  if (settingsStorage.getBoolean(key) !== undefined) return;
  const dematHidden = settingsStorage.getBoolean(KEY_PREFIX + "demat");
  const pensionHidden = settingsStorage.getBoolean(KEY_PREFIX + "pension");
  if (dematHidden === false || pensionHidden === false) {
    settingsStorage.set(key, false);
  }
}
