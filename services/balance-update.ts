import { getDatabase } from "@/database";
import { adjustAccountAvailable, computeUnseededBalance, getComputedBalances } from "@/services/account-balance";
import { getCurrentMonth } from "@/services/budget";
import { getActiveAccounts } from "@/services/financial-account";
import { settingsStorage } from "@/services/storage";
import { todayIso } from "@/utils/date";

/**
 * Update balances: the user types what's really in each bank account and wallet, and what's owed
 * on each card; where that differs from Arth's figure, the difference is recorded as a transaction
 * (recordBalanceDifference): less money than Arth thought is a spend, more is money in. It counts
 * in money in and out and shows in the account's ledger, and the balance comes out exactly right.
 * A spend stays out of the budget (money_event 'balance_adjustment') unless the user chose to
 * count it, in which case it's a plain uncategorised spend.
 *
 * Cards sharing one limit (same bank) are one line: what's owed across them.
 *
 * Also the Home nudge: shown when no money has moved for 3 days or more, until dismissed for that
 * quiet spell (the next transaction starts a new one).
 */

export interface BalanceLine {
  /** First account of the line; the adjustment is written there. */
  accountId: string;
  accountIds: string[];
  name: string;
  kind: "balance" | "card_due";
  /** Arth's figure now: balance, or what's owed. */
  current: number;
  /** Cards: the limit, when set. */
  limit: number | null;
  /**
   * The latest figure the bank's own SMS gave, when there is one: the balance, or (cards) what's
   * owed, worked out as limit − available. Update balances starts the box at this.
   */
  sms: { value: number; date: string | null } | null;
}

const QUIET_DAYS = 3;
const DISMISSED_KEY = "balance_nudge_dismissed_for";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function getBalanceLines(userId: string): Promise<BalanceLine[]> {
  const accounts = (await getActiveAccounts(userId)).filter((a) =>
    ["savings", "bank", "wallet", "credit_card"].includes(a.account_type as string),
  );
  if (accounts.length === 0) return [];
  const computed = await getComputedBalances(accounts.map((a) => a.id));
  const month = getCurrentMonth();
  const name = (a: (typeof accounts)[number]) => `${a.account_label || a.bank_name}${a.account_identifier ? ` ··${a.account_identifier}` : ""}`;

  const lines: BalanceLine[] = [];
  for (const a of accounts.filter((x) => x.account_type !== "credit_card")) {
    const current = computed[a.id] ?? (await computeUnseededBalance(a.id, month)).closing;
    const sms = a.last_known_balance != null ? { value: round2(a.last_known_balance), date: a.last_balance_date } : null;
    lines.push({ accountId: a.id, accountIds: [a.id], name: name(a), kind: "balance", current: round2(current), limit: null, sms });
  }
  // Cards: one line per bank, as cards from one bank share a limit.
  const byBank = new Map<string, typeof accounts>();
  for (const a of accounts.filter((x) => x.account_type === "credit_card")) {
    byBank.set(a.bank_name, [...(byBank.get(a.bank_name) ?? []), a]);
  }
  for (const cards of byBank.values()) {
    const owed = cards.reduce((s, c) => s + (computed[c.id] ?? 0), 0);
    const limit = Math.max(0, ...cards.map((c) => c.credit_limit ?? 0)) || null;
    // Differences are written on the card that carries the limit.
    const holder = [...cards].sort((x, y) => (y.credit_limit ?? 0) - (x.credit_limit ?? 0))[0];
    // A card's SMS reports what's left to spend; with a limit that gives what's owed. Cards
    // sharing a limit report the shared figure, so the freshest one stands for the line.
    const reported = cards
      .filter((c) => c.last_known_balance != null)
      .sort((x, y) => ((y.last_balance_date ?? "") > (x.last_balance_date ?? "") ? 1 : -1))[0];
    const sms =
      limit && reported?.last_known_balance != null
        ? { value: round2(Math.max(0, limit - reported.last_known_balance)), date: reported.last_balance_date }
        : null;
    lines.push({
      accountId: holder.id,
      accountIds: cards.map((c) => c.id),
      name: cards.length === 1 ? `${name(cards[0])} card` : `${cards[0].bank_name} cards (${cards.map((c) => `··${c.account_identifier}`).join(", ")})`,
      kind: "card_due",
      current: round2(owed),
      limit,
      sms,
    });
  }
  return lines;
}

/** Merchant name on the transactions that make up a balance difference. */
export const BALANCE_DIFFERENCE_MERCHANT = "Balance adjustment";

/**
 * Records the gap between Arth's figure and the real one as a transaction dated today:
 *   bank / wallet: real lower → spend (uncategorised); real higher → money in,
 *   card (what's owed): owed higher → spend; owed lower → money in.
 * `delta` is real − Arth's. Nothing under ₹1. Returns the new transaction's id.
 */
export async function recordBalanceDifference(
  userId: string,
  accountId: string,
  kind: BalanceLine["kind"],
  delta: number,
  note?: string,
  options: { countInBudget?: boolean; date?: string } = {},
): Promise<string | null> {
  if (!Number.isFinite(delta) || Math.abs(delta) < 1) return null;
  const isSpend = kind === "balance" ? delta < 0 : delta > 0;
  const date = options.date ?? todayIso();
  const { createExpense } = await import("@/services/expense-crud");
  const id = await createExpense({
    user_id: userId,
    amount: round2(Math.abs(delta)),
    date,
    nature: isSpend ? "realized" : "credit",
    account_id: accountId,
    merchant_name: BALANCE_DIFFERENCE_MERCHANT,
    description: note?.trim() || (isSpend ? "Spending Arth missed, matched to the bank" : "Money in Arth missed, matched to the bank"),
    ...(isSpend ? {} : { credit_kind: "other" as const }),
  });
  // Tagged so budgets leave it out (money in counts it either way); a spend the user wants in the
  // budget stays a plain uncategorised spend.
  if (!(isSpend && options.countInBudget)) {
    const { setMoneyEvent } = await import("@/services/money-events");
    await setMoneyEvent(id, "balance_adjustment");
  }
  return id;
}

/**
 * One transaction per line whose new figure differs from Arth's by ₹1 or more. Returns how many
 * lines changed.
 */
export async function saveBalanceUpdates(
  userId: string,
  updates: { line: BalanceLine; value: number; note?: string; countInBudget?: boolean }[],
): Promise<number> {
  let changed = 0;
  for (const { line, value, note, countInBudget } of updates) {
    if (!Number.isFinite(value) || Math.abs(value - line.current) < 1) continue;
    if (await recordBalanceDifference(userId, line.accountId, line.kind, value - line.current, note, { countInBudget })) changed++;
  }
  return changed;
}

/**
 * A balance the account's own SMS reported is its true figure (a pension's EPFO "TOTAL BALANCE"):
 * add one adjustment so Arth's balance matches it. An adjustment, not money in or out: PF growth
 * isn't spendable income, and counting it would distort money in and the savings rate. Only when that SMS holds the account's newest
 * balance (an older one read later doesn't overwrite it), so a history scan can't roll it back.
 * Returns the adjustment made (0 when it already matched or the SMS wasn't the newest).
 */
export async function matchBalanceFromSms(userId: string, accountId: string, balance: number, note: string): Promise<number> {
  const acct = await getDatabase().getFirstAsync<{ account_type: string; last_known_balance: number | null }>(
    "SELECT account_type, last_known_balance FROM financial_accounts WHERE id = ?;",
    accountId,
  );
  if (!acct || acct.account_type === "credit_card" || acct.account_type === "loan") return 0;
  if (acct.last_known_balance == null || Math.abs(acct.last_known_balance - balance) >= 0.5) return 0;
  return adjustAccountAvailable({ accountId, userId, actualAvailable: balance, description: note });
}

/** The latest day any money moved: an approved transaction, adjustment or transfer. */
export async function getLastMovementDate(userId: string): Promise<string | null> {
  const row = await getDatabase().getFirstAsync<{ d: string | null }>(
    `SELECT MAX(d) AS d FROM (
       SELECT MAX(date) AS d FROM expenses
        WHERE user_id = ? AND deleted_at IS NULL AND status = 'approved' AND nature IN ('realized', 'credit', 'ledger_adjustment')
       UNION ALL
       SELECT MAX(date) AS d FROM account_transfers WHERE user_id = ? AND deleted_at IS NULL
     );`,
    userId,
    userId,
  );
  return row?.d ? row.d.slice(0, 10) : null;
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000);
}

/** Days since money last moved, when the Home nudge should show; null when it shouldn't. */
export async function getBalanceNudge(userId: string, today: string = todayIso()): Promise<{ quietDays: number } | null> {
  const last = await getLastMovementDate(userId);
  if (!last) return null;
  const quietDays = daysBetween(last, today);
  if (quietDays < QUIET_DAYS) return null;
  if (settingsStorage.getString(DISMISSED_KEY) === last) return null;
  const hasAccounts = (await getActiveAccounts(userId)).some((a) => ["savings", "bank", "wallet", "credit_card"].includes(a.account_type as string));
  return hasAccounts ? { quietDays } : null;
}

/** Hide the nudge for this quiet spell; it comes back after the next movement goes quiet again. */
export async function dismissBalanceNudge(userId: string): Promise<void> {
  const last = await getLastMovementDate(userId);
  if (last) settingsStorage.set(DISMISSED_KEY, last);
}
