import { settingsStorage } from "./storage";

/**
 * Customise Arth: what's switched off and the order of the Home cards. Off only hides: nothing is
 * deleted, and switching it back on restores everything. Backed up with the other settings.
 */

export type FeatureId = "vault" | "simulator" | "insights" | "hisaab" | "investments" | "loans" | "together";
export type TabId = "budget" | "goals";
export type InnerTabId = "budget_split" | "budget_monthly" | "tx_committed" | "tx_transfers";
export type PartId = FeatureId | TabId | InnerTabId;

export const FEATURES: { id: FeatureId; label: string; description: string }[] = [
  { id: "vault", label: "Vault", description: "Passwords and PINs. Your saved entries stay on this phone while it's off." },
  { id: "simulator", label: "Simulator", description: "What-if cash-flow plans" },
  { id: "insights", label: "Insights", description: "Budget vs actual, money in and out, forecast and reports" },
  { id: "hisaab", label: "Hisaab", description: "Money owed with family and friends. Splitting an expense goes with it." },
  { id: "investments", label: "Investments", description: "Holdings, sync, projections and broker connections" },
  { id: "loans", label: "Loans", description: "Loan schedules, prepayments and the loans summary" },
  { id: "together", label: "Together", description: "Your household. It stops syncing while off, so others won't see new spends." },
];

export const TABS: { id: TabId; label: string; description: string }[] = [
  { id: "budget", label: "Budget", description: "The tab, and the budget part of My Month" },
  { id: "goals", label: "Goals", description: "The tab, with your plan, net worth and year-over-year" },
];

export const INNER_TABS: { id: InnerTabId; label: string; description: string }[] = [
  { id: "budget_split", label: "Spending Split", description: "In Budget" },
  { id: "budget_monthly", label: "Monthly Summary", description: "In Budget" },
  { id: "tx_committed", label: "Committed", description: "In Transactions" },
  { id: "tx_transfers", label: "Transfers", description: "In Transactions" },
];

const OFF_PREFIX = "customise_off__";

const listeners = new Set<() => void>();
let version = 0;

/** Screens that show or hide things re-render through this (hooks/use-customisation.ts). */
export function subscribeCustomise(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
export function customiseVersion(): number {
  return version;
}
export function customiseChanged(): void {
  version += 1;
  for (const l of listeners) l();
}

export function isPartOn(id: PartId): boolean {
  return settingsStorage.getBoolean(OFF_PREFIX + id) !== true;
}

export function setPartOn(id: PartId, on: boolean): void {
  const key = OFF_PREFIX + id;
  settingsStorage.set(key, !on);
  customiseChanged();
}

const ALL_PARTS: PartId[] = [...FEATURES.map((f) => f.id), ...TABS.map((t) => t.id), ...INNER_TABS.map((t) => t.id)];

export function resetParts(): void {
  for (const id of ALL_PARTS) settingsStorage.delete(OFF_PREFIX + id);
  // Broker records are opt-in (services/broker-history/enabled.ts): back to off.
  settingsStorage.delete("broker_history_on");
}

const PATH_PARTS: [string, PartId][] = [
  ["/vault", "vault"],
  ["/simulator", "simulator"],
  ["/insights", "insights"],
  ["/hisaab", "hisaab"],
  ["/investments", "investments"],
  ["/settings/kite-connect", "investments"],
  ["/settings/angel-connect", "investments"],
  ["/settings/zebpay-connect", "investments"],
  ["/loans", "loans"],
  ["/goals/loans", "loans"],
  ["/together", "together"],
  ["/settings/household", "together"],
  ["/budget", "budget"],
  ["/(tabs)/budget", "budget"],
  ["/goals", "goals"],
  ["/(tabs)/goals", "goals"],
];

/** Whether a screen belongs to something that's on. Search leaves out the ones that aren't. */
export function isPathOn(pathname: string): boolean {
  return PATH_PARTS.every(([prefix, id]) => !(pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}-`)) || isPartOn(id));
}
