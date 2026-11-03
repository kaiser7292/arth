import { getDatabase } from "@/database";
import { getBrokerLinkedAccount } from "@/services/broker-link";
import { getConnectedBrokers, type BrokerSyncResult, type SyncBroker } from "@/services/broker-sync";
import { addOrUpdateFundSnapshot, addOrUpdateSnapshot, getActiveAccounts, getLatestFundSnapshot } from "@/services/financial-account";
import {
  batchInvestmentProducts,
  isDematLikeAccount,
  withoutFinishedInvestments,
} from "@/services/investment-accounts";
import { getLinkedAccountId } from "@/services/kite-connect";

/**
 * After a sync: how much each market investment moved since its last value, and all of them together.
 * Only market-valued accounts move day to day, so deposits and pension aren't in it. Money you moved
 * in or out since the last value isn't a gain or a loss, so it's taken out of the change.
 */
export interface SyncAccount {
  id: string;
  name: string;
  /** The connected broker that fills this account. Null means its value has to be typed in. */
  broker: SyncBroker | null;
}

export interface AccountMove {
  current: number;
  /** The value at the end of the last day before today that has one. Null on a first reading. */
  previous: number | null;
  previousDate: string | null;
  /** Moved in (+) or out (−) since the last value. */
  added: number;
  /** There's already a value for today. */
  updatedToday: boolean;
}

export type SyncLineStatus = "moved" | "first" | "skipped" | "failed";

export interface SyncLine extends AccountMove {
  id: string;
  name: string;
  status: SyncLineStatus;
  /** Null unless the status is "moved". */
  change: number | null;
  changePct: number | null;
}

export interface SyncReview {
  /** Largest move first, then the ones that aren't compared. */
  lines: SyncLine[];
  /** Across the accounts with a comparison. */
  change: number;
  changePct: number | null;
  added: number;
  /** Every market account's value now, including ones not updated today. */
  total: number;
  /** The date everything is compared with, when they all share one. */
  since: string | null;
  compared: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function getSyncAccounts(userId: string): Promise<SyncAccount[]> {
  const all = await getActiveAccounts(userId);
  const like = all.filter((a) => a.account_type === "investment" || a.account_type === "demat");
  const products = await batchInvestmentProducts(like.filter((a) => a.account_type === "investment").map((a) => a.id));
  const accounts = withoutFinishedInvestments(like, products).filter((a) => isDematLikeAccount(a, products.get(a.id)));

  const connected = await getConnectedBrokers();
  const linked = new Map<string, SyncBroker>();
  for (const broker of connected) {
    const id = broker === "kite" ? getLinkedAccountId() : getBrokerLinkedAccount(broker);
    if (id) linked.set(id, broker);
  }
  return accounts.map((a) => ({
    id: a.id,
    name: a.account_label || a.bank_name,
    broker: linked.get(a.id) ?? null,
  }));
}

/** Holdings plus idle cash, now and at the last value before today, and what moved in between. */
export async function readAccountMove(accountId: string, today: string): Promise<AccountMove> {
  const db = getDatabase();
  const latest = async (table: "demat_portfolio_snapshots" | "demat_fund_snapshots", column: string, op: "<" | "<=") =>
    db.getFirstAsync<{ date: string; value: number }>(
      `SELECT snapshot_date AS date, ${column} AS value FROM ${table}
        WHERE account_id = ? AND snapshot_date ${op} ?
        ORDER BY snapshot_date DESC LIMIT 1;`,
      accountId,
      today,
    );
  const [portfolioNow, fundNow, portfolioBefore, fundBefore] = await Promise.all([
    latest("demat_portfolio_snapshots", "portfolio_value", "<="),
    latest("demat_fund_snapshots", "fund_value", "<="),
    latest("demat_portfolio_snapshots", "portfolio_value", "<"),
    latest("demat_fund_snapshots", "fund_value", "<"),
  ]);
  const current = round2((portfolioNow?.value ?? 0) + (fundNow?.value ?? 0));
  const dates = [portfolioBefore?.date, fundBefore?.date].filter((d): d is string => !!d).sort();
  const previousDate = dates[dates.length - 1] ?? null;
  const updatedToday = portfolioNow?.date === today || fundNow?.date === today;
  if (!previousDate) return { current, previous: null, previousDate: null, added: 0, updatedToday };

  const moved = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(CASE WHEN to_account_id = ? THEN amount ELSE -amount END) AS total FROM account_transfers
      WHERE (to_account_id = ? OR from_account_id = ?) AND deleted_at IS NULL AND date > ? AND date <= ?;`,
    accountId,
    accountId,
    accountId,
    previousDate,
    today,
  );
  return {
    current,
    previous: round2((portfolioBefore?.value ?? 0) + (fundBefore?.value ?? 0)),
    previousDate,
    added: round2(moved?.total ?? 0),
    updatedToday,
  };
}

/** Saves a typed total for today. Idle cash stays as it was; the rest is holdings. */
export async function saveManualValue(accountId: string, total: number, today: string): Promise<void> {
  const fund = (await getLatestFundSnapshot(accountId))?.fund_value ?? 0;
  if (total < fund) await addOrUpdateFundSnapshot(accountId, today, total, "manual");
  await addOrUpdateSnapshot(accountId, today, Math.max(0, total - fund), "manual");
}

/** The sum of the review, from each account's move. Separate from the reads so it can be checked alone. */
export function buildSyncReview(
  entries: { account: SyncAccount; move: AccountMove; updated: boolean; failed: boolean }[],
): SyncReview {
  const lines: SyncLine[] = entries.map(({ account, move, updated, failed }) => {
    const base = { id: account.id, name: account.name, ...move };
    if (failed) return { ...base, status: "failed", change: null, changePct: null };
    if (!updated) return { ...base, status: "skipped", change: null, changePct: null };
    if (move.previous == null) return { ...base, status: "first", change: null, changePct: null };
    const change = round2(move.current - move.previous - move.added);
    return { ...base, status: "moved", change, changePct: move.previous > 0 ? (change / move.previous) * 100 : null };
  });
  const moved = lines.filter((l) => l.status === "moved");
  const change = round2(moved.reduce((s, l) => s + (l.change ?? 0), 0));
  const before = moved.reduce((s, l) => s + (l.previous ?? 0), 0);
  const dates = new Set(moved.map((l) => l.previousDate));
  const order: Record<SyncLineStatus, number> = { moved: 0, first: 1, skipped: 2, failed: 3 };
  return {
    lines: [...lines].sort((a, b) => order[a.status] - order[b.status] || Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0)),
    change,
    changePct: before > 0 ? (change / before) * 100 : null,
    added: round2(moved.reduce((s, l) => s + l.added, 0)),
    total: round2(lines.reduce((s, l) => s + l.current, 0)),
    since: dates.size === 1 ? [...dates][0] : null,
    compared: moved.length,
  };
}

export async function getSyncReview(
  accounts: SyncAccount[],
  results: BrokerSyncResult[],
  typedIds: Set<string>,
  today: string,
): Promise<SyncReview> {
  const status = new Map(results.map((r) => [r.broker, r.status]));
  const entries = await Promise.all(
    accounts.map(async (account) => {
      const move = await readAccountMove(account.id, today);
      return {
        account,
        move,
        updated: account.broker ? status.get(account.broker) === "saved" : typedIds.has(account.id) || move.updatedToday,
        failed: account.broker != null && status.get(account.broker) !== "saved",
      };
    }),
  );
  return buildSyncReview(entries);
}
