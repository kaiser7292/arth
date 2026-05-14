/**
 * Cash-flow simulator — pure engine (v16.0.0).
 *
 * No DB access, no side effects. Takes baseline balances + planned entries,
 * returns a trajectory, warnings, and net worth end-state.
 *
 * The companion `services/simulator.ts` handles CRUD, seeding, fulfillment
 * reconciliation, and retention — all of which are DB-bound.
 */

import { daysBetween } from "@/utils/date";
import type { AccountType } from "./financial-account";

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

export interface BaselineAccount {
  id: string;
  label: string;
  type: AccountType;
  /**
   * Current computed balance.
   * For savings / wallet / demat / pension: higher = more money.
   * For credit_card: this is UTILIZED (higher = more debt).
   * For loan: this is principal remaining (higher = more debt).
   */
  balance: number;
  /** Only meaningful for savings accounts. Undefined if min-balance alert is off. */
  minBalance?: number;
  /** Only meaningful for credit_card. Undefined if not set. */
  creditLimit?: number;
}

export type EntryDirection = "out" | "in";

export interface EngineEntry {
  id: string;
  direction: EntryDirection;
  amount: number;
  /** YYYY-MM-DD */
  date: string;
  /** May be absent if the entry is unattributed. Such entries are IGNORED by the engine. */
  accountId?: string;
  /** v16.0.9 — transfer entries have from and to accounts */
  fromAccountId?: string;
  toAccountId?: string;
}

export interface SimulationInput {
  startBalances: BaselineAccount[];
  entries: EngineEntry[];
  /** YYYY-MM-DD — inclusive end of the simulation window. */
  horizonDate: string;
  /** YYYY-MM-DD — the baseline "today". Used as the first trajectory date. */
  todayDate: string;
}

export interface BalanceSnapshot {
  date: string;
  netWorth: number;
  byAccount: Record<string, number>;
}

export type WarningKind = "min_balance_breach" | "cc_over_limit" | "negative_balance";

export interface SimulationWarning {
  accountId: string;
  accountLabel: string;
  kind: WarningKind;
  /** YYYY-MM-DD on which the warning first triggers within the simulation. */
  firstTriggerDate: string;
  /** Balance at first trigger. */
  amount: number;
}

export interface SimulationOutput {
  netWorthStart: number;
  netWorthEnd: number;
  endBalances: Record<string, number>;
  trajectory: BalanceSnapshot[];
  warnings: SimulationWarning[];
}

// ═══════════════════════════════════════════════════════════════════════
// Net-worth helper
// ═══════════════════════════════════════════════════════════════════════

const ASSET_TYPES: AccountType[] = ["savings", "wallet", "demat", "pension"];
const LIABILITY_TYPES: AccountType[] = ["credit_card", "loan"];

export function netWorthOf(accounts: Map<string, BaselineAccount>): number {
  let total = 0;
  for (const a of accounts.values()) {
    if (ASSET_TYPES.includes(a.type)) total += a.balance;
    else if (LIABILITY_TYPES.includes(a.type)) total -= a.balance;
  }
  return Math.round(total * 100) / 100;
}

function snapshotByAccount(accounts: Map<string, BaselineAccount>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of accounts.values()) out[a.id] = Math.round(a.balance * 100) / 100;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// Main engine
// ═══════════════════════════════════════════════════════════════════════

/**
 * Apply an entry to the running state.
 *
 * Direction semantics:
 *   out + non-CC → balance -= amount
 *   out + CC     → balance += amount (utilized grows)
 *   in  + non-CC → balance += amount
 *   in  + CC     → balance -= amount (bill payment, utilized shrinks)
 *
 * Transfer semantics (v16.0.9):
 *   If fromAccountId and toAccountId are set, debit from_account and credit to_account.
 *   Direction is ignored for transfers.
 *
 * Unknown account id → no-op (entry attributed to deleted account).
 */
function applyEntry(state: Map<string, BaselineAccount>, entry: EngineEntry): void {
  // v16.0.9 — handle transfer entries
  if (entry.fromAccountId && entry.toAccountId) {
    const amt = Math.abs(entry.amount);
    const fromAcct = state.get(entry.fromAccountId);
    const toAcct = state.get(entry.toAccountId);
    if (!fromAcct || !toAcct) return;

    // Debit from_account
    if (fromAcct.type === "credit_card") {
      fromAcct.balance += amt;
    } else {
      fromAcct.balance -= amt;
    }
    fromAcct.balance = Math.round(fromAcct.balance * 100) / 100;

    // Credit to_account
    if (toAcct.type === "credit_card") {
      toAcct.balance -= amt;
    } else {
      toAcct.balance += amt;
    }
    toAcct.balance = Math.round(toAcct.balance * 100) / 100;
    return;
  }

  // Regular entry handling
  if (!entry.accountId) return; // Account is mandatory
  const acct = state.get(entry.accountId);
  if (!acct) return;

  const amt = Math.abs(entry.amount);
  if (entry.direction === "out") {
    acct.balance += acct.type === "credit_card" ? amt : -amt;
  } else {
    acct.balance += acct.type === "credit_card" ? -amt : amt;
  }
  acct.balance = Math.round(acct.balance * 100) / 100;
}

/**
 * Record warnings that fire at the current state. Dedupes — each
 * (accountId, kind) only ever records its first trigger date.
 *
 * v16.0.1 — only fires warnings for accounts whose balance CHANGED in the
 * simulation (vs baseline). If a user already had a negative wallet at
 * baseline, that's a real-world problem but not a simulation warning; the
 * simulator is about "what would my planned entries cause?" not "what is
 * wrong with my current balances?"
 */
function checkWarnings(
  state: Map<string, BaselineAccount>,
  baseline: Map<string, BaselineAccount>,
  date: string,
  warnings: Map<string, SimulationWarning>,
): void {
  for (const acct of state.values()) {
    const base = baseline.get(acct.id);
    // No baseline → account is unknown to us; skip warnings for it.
    if (!base) continue;
    // If the balance hasn't moved from baseline, nothing the simulation
    // caused. Skip. (Otherwise a pre-existing negative wallet / over-limit
    // CC would always raise a warning independent of what the user planned.)
    if (acct.balance === base.balance) continue;

    // Savings min-balance breach — only when simulation dragged it under.
    if (
      acct.type === "savings"
      && acct.minBalance != null
      && acct.minBalance > 0
      && acct.balance < acct.minBalance
      && base.balance >= acct.minBalance
    ) {
      const key = `${acct.id}:min_balance_breach`;
      if (!warnings.has(key)) {
        warnings.set(key, {
          accountId: acct.id,
          accountLabel: acct.label,
          kind: "min_balance_breach",
          firstTriggerDate: date,
          amount: acct.balance,
        });
      }
    }
    // CC over-limit — only when simulation pushed it over.
    if (
      acct.type === "credit_card"
      && acct.creditLimit != null
      && acct.creditLimit > 0
      && acct.balance > acct.creditLimit
      && base.balance <= acct.creditLimit
    ) {
      const key = `${acct.id}:cc_over_limit`;
      if (!warnings.has(key)) {
        warnings.set(key, {
          accountId: acct.id,
          accountLabel: acct.label,
          kind: "cc_over_limit",
          firstTriggerDate: date,
          amount: acct.balance,
        });
      }
    }
    // Non-CC negative balance — only when simulation dragged it negative.
    if (
      acct.type !== "credit_card"
      && acct.balance < 0
      && base.balance >= 0
    ) {
      const key = `${acct.id}:negative_balance`;
      if (!warnings.has(key)) {
        warnings.set(key, {
          accountId: acct.id,
          accountLabel: acct.label,
          kind: "negative_balance",
          firstTriggerDate: date,
          amount: acct.balance,
        });
      }
    }
  }
}

/**
 * Run the simulation. O(N × A) where N = entries, A = accounts.
 * Pure function — given the same input, always returns the same output.
 */
export function runSimulation(input: SimulationInput): SimulationOutput {
  const { startBalances, entries, horizonDate, todayDate } = input;

  // Build mutable state keyed by id. Defensive copy so we don't mutate
  // caller's baseline.
  const state = new Map<string, BaselineAccount>();
  const baseline = new Map<string, BaselineAccount>();
  for (const a of startBalances) {
    state.set(a.id, { ...a });
    baseline.set(a.id, { ...a });
  }

  const netWorthStart = netWorthOf(state);

  // Trajectory: start with today's baseline.
  const trajectory: BalanceSnapshot[] = [
    { date: todayDate, netWorth: netWorthStart, byAccount: snapshotByAccount(state) },
  ];

  // Sort entries ascending by date, stable tie-break by id.
  const sorted = [...entries].sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return a.id < b.id ? -1 : 1;
  });

  const warnings = new Map<string, SimulationWarning>();

  for (const entry of sorted) {
    if (entry.date > horizonDate) continue; // outside window
    applyEntry(state, entry);
    checkWarnings(state, baseline, entry.date, warnings);
    trajectory.push({
      date: entry.date,
      netWorth: netWorthOf(state),
      byAccount: snapshotByAccount(state),
    });
  }

  // Close with the horizon snapshot — if the last entry didn't land on the
  // horizon, we need a final data point so the UI can draw a line to the
  // end of the window.
  const lastDate = trajectory[trajectory.length - 1].date;
  if (lastDate < horizonDate) {
    trajectory.push({
      date: horizonDate,
      netWorth: netWorthOf(state),
      byAccount: snapshotByAccount(state),
    });
  }

  return {
    netWorthStart,
    netWorthEnd: netWorthOf(state),
    endBalances: snapshotByAccount(state),
    trajectory,
    warnings: Array.from(warnings.values()),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Fulfillment matcher — matches a planned entry to a real transaction
// ═══════════════════════════════════════════════════════════════════════

export interface FulfillmentCandidate {
  id: string;
  amount: number;
  date: string;
  account_id: string | null;
}


export interface FulfillmentTolerance {
  /** Max absolute amount-percentage tolerance. Default 0 (exact match, with
   *  a 1-paise floating-point epsilon). */
  amountPct?: number;
  /** Max absolute day-difference. Default 3. */
  dateWindowDays?: number;
}

/** Absolute epsilon to absorb SQLite REAL round-trip noise at the paise level. */
const AMOUNT_EPSILON = 0.01;

/**
 * Find the best matching real transaction for a planned entry.
 * Returns null if nothing matches within tolerance.
 *
 * Matching rules:
 *   - account_id: if entry has one, candidate must match exactly (null-safe)
 *   - amount: exact to the paise by default. v16.0.5 — previously accepted
 *     ±5% which caused false positives (e.g. a ₹950 grocery bill fulfilling
 *     a ₹1,000 planned entry even though they're clearly different). User
 *     asked for exact. A 1-paise epsilon stays to absorb float noise.
 *     Caller can still pass a non-zero `amountPct` if fuzzy matching is
 *     ever needed.
 *   - date: |daysBetween| <= dateWindowDays (default 3)
 *
 * Tie-break: closest amount first, then closest date.
 */
export function findFulfillmentCandidate(
  entry: EngineEntry,
  candidates: FulfillmentCandidate[],
  tolerance: FulfillmentTolerance = {},
): FulfillmentCandidate | null {
  const amountPct = tolerance.amountPct ?? 0;
  const dateWindowDays = tolerance.dateWindowDays ?? 3;

  const matches: Array<{ c: FulfillmentCandidate; score: [number, number, number] }> = [];
  for (const c of candidates) {
    // Account guard — only rejects when BOTH sides specify accounts and they
    // differ. v16.0.1: previously we also rejected when the entry had an
    // account but the candidate didn't; that ruled out legitimate matches
    // for SMS-detected orphan credits / refunds where `expenses.account_id`
    // is genuinely NULL. Now we match across the null case and just
    // penalise it in the tie-break score so an exact-account match still
    // wins over a null-account one.
    if (entry.accountId && c.account_id && c.account_id !== entry.accountId) continue;

    const amtDiff = Math.abs(c.amount - entry.amount);
    // Gate 1 — always-on paise epsilon for float safety.
    // Gate 2 — optional percentage tolerance if the caller opted in.
    if (amtDiff > AMOUNT_EPSILON) {
      if (amountPct <= 0) continue;
      const amtRatio = entry.amount > 0 ? amtDiff / entry.amount : Infinity;
      if (amtRatio > amountPct) continue;
    }
    const amtRatioForScore = entry.amount > 0 ? amtDiff / entry.amount : 0;

    const dateDiff = Math.abs(daysBetween(entry.date, c.date));
    if (dateDiff > dateWindowDays) continue;

    // Tie-break penalty: 0 for account match, 1 for null-candidate, 2 for
    // entry-no-account vs candidate-with-account.
    const accountPenalty = entry.accountId
      ? (c.account_id ? 0 : 1)
      : (c.account_id ? 2 : 1);
    matches.push({ c, score: [amtRatioForScore, dateDiff, accountPenalty] });
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    if (a.score[0] !== b.score[0]) return a.score[0] - b.score[0]; // amount closeness
    if (a.score[1] !== b.score[1]) return a.score[1] - b.score[1]; // date closeness
    return a.score[2] - b.score[2]; // account-match preference
  });
  return matches[0].c;
}
