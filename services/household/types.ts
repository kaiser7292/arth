/**
 * Household data shapes: database rows and the ops phones send each other.
 * Design: docs/HOUSEHOLD_PHASE1_DESIGN.md §3.
 */

/** Where the relay lives. Overridable for local testing (`wrangler dev`). */
export const DEFAULT_RELAY_URL = "https://sync.souravbaid.com";

/** Public web page the invite link opens; it hands the fragment to the app. */
export const INVITE_PAGE_URL = "https://souravbaid.com/join";

export const MAX_MEMBERS = 5;

export const DEFAULT_HOUSEHOLD_CATEGORIES = ["Groceries", "Rent", "Utilities", "Household help", "Fuel"];

/** Member colours, in join order. */
export const MEMBER_COLOURS = ["#378ADD", "#D4537E", "#1D9E75", "#BA7517", "#7F77DD"];

export type HouseholdStatus = "active" | "left" | "removed" | "moved" | "closed" | "no_keys";
export type HouseholdRole = "creator" | "member";

export interface Household {
  id: string;
  name: string;
  my_member_id: string;
  role: HouseholdRole;
  relay_url: string;
  key_version: number;
  status: HouseholdStatus;
  share_household_categories: number;
  share_other_totals: number;
  share_all_transactions: number;
  share_savings_rate: number;
  share_balances: number;
  next_seq: number;
  needs_snapshot: number;
  last_device_id: string | null;
  created_at: string;
  joined_at: string | null;
  left_at: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
}

export interface HouseholdMember {
  household_id: string;
  id: string;
  name: string;
  colour: string | null;
  box_public: string;
  sign_public: string;
  role: HouseholdRole;
  settings_json: string | null;
  joined_at: string | null;
  removed_at: string | null;
}

export interface HouseholdCategory {
  household_id: string;
  id: string;
  name: string;
  sort_order: number;
}

/**
 * tx: a transaction (shared, or every transaction when chosen) · total: a month's total for one of
 * the author's categories · savings: a month's savings rate · balance: an account balance ·
 * settle: a settle-up between two members · net: the author's Hisaab balance with one member
 * (id "net:<member id>"), so the other phone can say whether both agree.
 */
export type ItemKind = "tx" | "total" | "savings" | "balance" | "settle" | "net";

export interface HouseholdItem {
  household_id: string;
  id: string;
  member_id: string;
  kind: ItemKind;
  month: string | null;
  date: string | null;
  paid: number | null;
  my_share: number | null;
  category_name: string | null;
  merchant: string | null;
  payload_json: string | null;
  local_ref: string | null;
  updated_at: string;
}

export interface HouseholdEvent {
  id: string;
  household_id: string;
  member_id: string | null;
  type: EventType;
  payload_json: string | null;
  at: string;
}

export type EventType = "created" | "joined" | "left" | "removed" | "renamed" | "shared" | "rekeyed" | "closed" | "settled";

/** The sharing choices, as sent to the others in `member.settings`. */
export interface SharingChoices {
  householdCategories: boolean;
  otherTotals: boolean;
  allTransactions: boolean;
  savingsRate: boolean;
  balances: boolean;
}

// ─── Ops ───

/** What a shared item looks like inside an op (and in household_items, minus local fields). */
export interface SharedItem {
  id: string;
  kind: ItemKind;
  month?: string | null;
  date?: string | null;
  paid?: number | null;
  myShare?: number | null;
  category?: string | null;
  merchant?: string | null;
  /**
   * tx: shared, split, owes {member id: amount} · settle: payer, payee, amount · net: balance ·
   * balance: label, type, asOf · savings: rate
   */
  extra?: Record<string, unknown>;
}

export interface MemberPublic {
  id: string;
  name: string;
  colour: string | null;
  boxPublic: string;
  signPublic: string;
  role: HouseholdRole;
}

export type OpBody =
  | { kind: "member.profile"; name: string; colour: string | null }
  | { kind: "member.settings"; choices: SharingChoices }
  | { kind: "items.upsert"; items: SharedItem[] }
  | { kind: "items.delete"; ids: string[] }
  | { kind: "snapshot.begin" }
  | { kind: "snapshot.end" }
  | { kind: "resync.request"; from: string }
  | { kind: "household.rename"; name: string }
  | { kind: "household.categories"; categories: { id: string; name: string }[] }
  | { kind: "member.approve"; member: MemberPublic }
  | { kind: "member.remove"; memberId: string }
  | { kind: "member.leave" }
  | { kind: "household.rekey"; version: number; sealed: Record<string, string> };

export interface Op {
  v: 1;
  hh: string;
  m: string;
  dev: string;
  seq: number;
  at: number;
  body: OpBody;
}

/** Ops only the creator may send; anyone else's are ignored. */
export const CREATOR_ONLY: OpBody["kind"][] = [
  "household.rename",
  "household.categories",
  "member.approve",
  "member.remove",
  "household.rekey",
];
