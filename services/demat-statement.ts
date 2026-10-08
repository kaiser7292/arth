/**
 * Day-by-day statement for a demat (or other market-valued) account, one month at a time.
 *
 * For every day with a snapshot or a transfer:
 *   value      portfolio + idle cash that day: the snapshot, or the previous value ± money moved
 *   in / out   transfers into / out of the account that day (invested / withdrawn)
 *   gain       value − previous day's value − in + out   (what the market did, not your money);
 *              only on snapshot days — between snapshots nothing but the transfers is known
 *
 * The first day compares against the value at the end of the previous month. Values come from
 * the snapshot tables — the same numbers the rest of the Demat screens show. Read-only.
 */

import { getDatabase } from "@/database";

export interface DematDayEntry {
  id: string;
  direction: "in" | "out";
  amount: number;
  /** The other account's name. */
  counterparty: string;
}

export interface DematDay {
  date: string;
  value: number;
  moneyIn: number;
  moneyOut: number;
  gain: number;
  /** Gain against what was at work that day (previous value + money in), or null with nothing at work. */
  gainPct: number | null;
  /** A snapshot was recorded this day (otherwise the value is carried from an earlier one). */
  hasSnapshot: boolean;
  /** The account's first-ever snapshot: its value is where tracking starts, not a gain. */
  isStart: boolean;
  /**
   * The day the gain is measured from, when that's more than a day before — after a gap of
   * skipped days the gain covers all of them. Null when it's just the previous day (or no gain).
   */
  gainSince: string | null;
  entries: DematDayEntry[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Days with activity in `month`, newest first. Pure: snapshots/transfers in, rows out. */
export function buildDematDays(
  accountId: string,
  month: string,
  portfolio: { date: string; value: number }[],
  fund: { date: string; value: number }[],
  transfers: { id: string; date: string; amount: number; from_account_id: string; counterparty: string }[],
  today = todayStr(),
): DematDay[] {
  const start = `${month}-01`;
  const end = monthEnd(month) < today ? monthEnd(month) : today;
  const inMonth = (d: string) => d >= start && d <= end;

  const sortedP = [...portfolio].sort((a, b) => a.date.localeCompare(b.date));
  const sortedF = [...fund].sort((a, b) => a.date.localeCompare(b.date));
  const dayBefore = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    const x = new Date(y, m - 1, dd - 1);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  };
  const latest = (list: { date: string; value: number }[], day: string) => {
    let v = 0;
    for (const r of list) {
      if (r.date > day) break;
      v = r.value;
    }
    return v;
  };
  const valueAt = (day: string) => latest(sortedP, day) + latest(sortedF, day);

  const snapshotDays = new Set([...sortedP, ...sortedF].map((r) => r.date).filter(inMonth));
  const days = [...new Set([...snapshotDays, ...transfers.map((t) => t.date).filter(inMonth)])].sort();

  const rows: DematDay[] = [];
  const beforeMonth = `${month}-00`; // end of the previous month: every real date sorts after "-00"
  let prev = valueAt(beforeMonth);
  // Last day there was a value to compare against, and whether any snapshot exists yet.
  const earlier = [...sortedP, ...sortedF].filter((r) => r.date <= beforeMonth).map((r) => r.date).sort();
  let prevDate: string | null = earlier.length > 0 ? earlier[earlier.length - 1] : null;
  let tracking = prevDate != null;
  for (const date of days) {
    const entries: DematDayEntry[] = transfers
      .filter((t) => t.date === date)
      .map((t) => ({
        id: t.id,
        direction: t.from_account_id === accountId ? "out" : "in",
        amount: t.amount,
        counterparty: t.counterparty,
      }));
    const moneyIn = round2(entries.filter((e) => e.direction === "in").reduce((s, e) => s + e.amount, 0));
    const moneyOut = round2(entries.filter((e) => e.direction === "out").reduce((s, e) => s + e.amount, 0));
    const hasSnapshot = snapshotDays.has(date);
    // The first snapshot ever is where tracking starts — compared against nothing, its whole
    // value would read as gain.
    const isStart = hasSnapshot && !tracking;
    // Without a snapshot that day, the money moved is all that changed — so a deposit isn't
    // later read as market gain when the next snapshot includes it.
    const value = hasSnapshot ? valueAt(date) : prev + moneyIn - moneyOut;
    const gain = hasSnapshot && !isStart ? round2(value - prev - moneyIn + moneyOut) : 0;
    const atWork = prev + moneyIn;
    const gainSince = gain !== 0 && prevDate != null && prevDate < dayBefore(date) ? prevDate : null;
    rows.push({
      date,
      value: round2(value),
      moneyIn,
      moneyOut,
      gain,
      gainPct: atWork > 0 ? round2((gain / atWork) * 100) : null,
      hasSnapshot,
      isStart,
      gainSince,
      entries,
    });
    prev = value;
    prevDate = date;
    if (hasSnapshot) tracking = true;
  }
  return rows.reverse();
}

export async function getDematDailyStatement(accountId: string, month: string): Promise<DematDay[]> {
  const db = getDatabase();
  const end = monthEnd(month);
  const [portfolio, fund, transfers] = await Promise.all([
    db.getAllAsync<{ date: string; value: number }>(
      `SELECT snapshot_date AS date, portfolio_value AS value FROM demat_portfolio_snapshots
        WHERE account_id = ? AND snapshot_date <= ?;`,
      accountId,
      end,
    ),
    db.getAllAsync<{ date: string; value: number }>(
      `SELECT snapshot_date AS date, fund_value AS value FROM demat_fund_snapshots
        WHERE account_id = ? AND snapshot_date <= ?;`,
      accountId,
      end,
    ),
    db.getAllAsync<{ id: string; date: string; amount: number; from_account_id: string; counterparty: string }>(
      `SELECT t.id, t.date, t.amount, t.from_account_id,
              COALESCE(fa.account_label, fa.bank_name, 'Another account') AS counterparty
         FROM account_transfers t
         LEFT JOIN financial_accounts fa
           ON fa.id = CASE WHEN t.from_account_id = ? THEN t.to_account_id ELSE t.from_account_id END
        WHERE (t.from_account_id = ? OR t.to_account_id = ?)
          AND t.deleted_at IS NULL AND t.date >= ? AND t.date <= ?;`,
      accountId,
      accountId,
      accountId,
      `${month}-01`,
      end,
    ),
  ]);
  return buildDematDays(accountId, month, portfolio, fund, transfers);
}
