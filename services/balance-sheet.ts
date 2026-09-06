/**
 * Balance Sheet — a point-in-time snapshot of assets and liabilities.
 *
 * Sources everything from existing ledger & snapshot data. No new tables.
 *
 * Assets
 *  - Savings closing balance (from account_month_balances, end-of-month)
 *  - Wallets closing balance (same)
 *  - Demat portfolio (latest demat_portfolio_snapshots on-or-before date,
 *    with earliest-snapshot carry-back for dates pre-dating any snapshot)
 *  - Demat fund (same snapshot-based logic — demat_fund_snapshots is the single source
 *    as ultimate fallback)
 *  - Hisaab: positive balances across persons (they owe me)
 *
 * Liabilities
 *  - Credit card utilized (closing balance in the utilized model)
 *  - Loans (last_known_balance as best-effort — no principal history yet)
 *  - Hisaab: negative balances (I owe them, shown as positive liability)
 */

import { getDatabase } from "@/database";
import { computeClosing, computeUnseededBalance } from "@/services/account-balance";
import { V15_FLAGS } from "@/services/feature-flags";
import { getLoanOutstandingsByFA } from "@/services/loan-accounts";
import { getMonthDateRange } from "@/utils/budget-helpers";

export interface BalanceSheetRow {
  /** Short label for the row, e.g. "HDFC ••••1234" or "Credit cards utilized". */
  label: string;
  /** Grouping so the UI can collapse rows per section. */
  group: "savings" | "wallet" | "demat_portfolio" | "demat_fund" | "pension" | "hisaab_owed" | "cc" | "loan" | "hisaab_owes";
  /** Money amount on this row (always non-negative — sign is conveyed by section). */
  amount: number;
  /** Per-row meta for tapping; optional route hint. */
  accountId?: string;
  personId?: string;
  /** True if the value is a best-effort fallback (no real data for this date). */
  isFallback?: boolean;
}

export interface BalanceSheetColumn {
  /** "YYYY-MM-DD" — the date this column is "as of". */
  asOfDate: string;
  /** Short label for the column header (e.g. "31 Mar 2026" or "Today"). */
  label: string;
  /** Flag so UI can style the live column differently. */
  isLive: boolean;
  /** All asset rows summed up, in display order. */
  assets: BalanceSheetRow[];
  /** All liability rows summed up, in display order. */
  liabilities: BalanceSheetRow[];
  totalAssets: number;
  totalLiabilities: number;
  /** Assets − Liabilities. */
  netWorth: number;
}

const yyyymm = (date: string) => date.slice(0, 7);

interface AccountRow {
  id: string;
  account_type: string;
  account_label: string | null;
  bank_name: string;
  account_identifier: string;
  last_known_balance: number | null;
}

/** Load all active accounts once — cheap, one query. */
async function loadAccounts(userId: string): Promise<AccountRow[]> {
  const db = getDatabase();
  return db.getAllAsync<AccountRow>(
    `SELECT id, account_type, account_label, bank_name, account_identifier,
            last_known_balance
     FROM financial_accounts
     WHERE user_id = ? AND is_active = 1 AND closed_at IS NULL;`,
    userId,
  );
}

/**
 * Latest snapshot value per account within [minDate, asOfDate]. When no
 * snapshot exists in that window for an account, the account is simply absent
 * from the result map (caller renders "—").
 *
 * Historic FY columns pass minDate = FY start; the column only reflects data
 * recorded within that fiscal year. Live columns pass minDate = null which
 * effectively means "any time up to and including today" (the user's current
 * state). No more carry-back from snapshots recorded in other FYs.
 *
 * Batched: one query total.
 */
async function batchSnapshotAsOf(
  table: "demat_portfolio_snapshots" | "demat_fund_snapshots",
  valueCol: "portfolio_value" | "fund_value",
  accountIds: string[],
  asOfDate: string,
  minDate: string | null,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (accountIds.length === 0) return result;
  const db = getDatabase();
  const placeholders = accountIds.map(() => "?").join(",");

  if (minDate === null) {
    // Live column: latest snapshot on-or-before asOfDate.
    const rows = await db.getAllAsync<{ account_id: string; val: number }>(
      `SELECT s.account_id, s.${valueCol} AS val
       FROM ${table} s
       WHERE s.account_id IN (${placeholders}) AND s.snapshot_date <= ?
         AND s.snapshot_date = (
           SELECT MAX(snapshot_date) FROM ${table}
           WHERE account_id = s.account_id AND snapshot_date <= ?
         );`,
      ...accountIds,
      asOfDate,
      asOfDate,
    );
    for (const r of rows) result.set(r.account_id, r.val);
    return result;
  }

  // Historic column: latest snapshot within [minDate, asOfDate].
  const rows = await db.getAllAsync<{ account_id: string; val: number }>(
    `SELECT s.account_id, s.${valueCol} AS val
     FROM ${table} s
     WHERE s.account_id IN (${placeholders})
       AND s.snapshot_date >= ? AND s.snapshot_date <= ?
       AND s.snapshot_date = (
         SELECT MAX(snapshot_date) FROM ${table}
         WHERE account_id = s.account_id
           AND snapshot_date >= ? AND snapshot_date <= ?
       );`,
    ...accountIds,
    minDate,
    asOfDate,
    minDate,
    asOfDate,
  );
  for (const r of rows) result.set(r.account_id, r.val);
  return result;
}

/**
 * Sum hisaab positive balances (owed to me) and negative balances (I owe) for
 * a given userId as-of a specific date. `endDateInclusive` means entries dated
 * on that day are included (we pass the day after to the existing exclusive
 * predicate). Batched into a single query.
 */
async function batchHisaabAsOf(
  userId: string,
  endDateInclusive: string | null, // null = "now" (all entries)
): Promise<{ owedToMe: number; iOwe: number }> {
  const db = getDatabase();
  if (endDateInclusive === null) {
    // Live: simple per-person sum, filter negatives vs. positives afterwards.
    const rows = await db.getAllAsync<{ balance: number }>(
      `SELECT COALESCE(p.initial_balance, 0) +
              COALESCE(SUM(CASE WHEN e.type = 'debit' THEN e.amount ELSE 0 END), 0) -
              COALESCE(SUM(CASE WHEN e.type IN ('credit', 'settlement') THEN e.amount ELSE 0 END), 0)
              AS balance
       FROM hisaab_persons p
       LEFT JOIN hisaab_entries e ON p.id = e.hisaab_person_id
         AND (e.linked_expense_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM expenses x WHERE x.id = e.linked_expense_id AND x.deleted_at IS NOT NULL
         ))
       WHERE p.owner_user_id = ? AND p.is_active = 1
       GROUP BY p.id;`,
      userId,
    );
    let owedToMe = 0;
    let iOwe = 0;
    for (const r of rows) {
      if (r.balance > 0) owedToMe += r.balance;
      else if (r.balance < 0) iOwe += Math.abs(r.balance);
    }
    return { owedToMe, iOwe };
  }

  // Historic column: balance is computed from DATED entries only (exclude
  // initial_balance — it represents today's seed, not a historical anchor,
  // and leaks forward into every historic column if included).
  // Only include persons with at least one entry on-or-before the as-of-date;
  // a person with no historic activity should not appear in past FYs.
  const dayAfter = new Date(endDateInclusive);
  dayAfter.setDate(dayAfter.getDate() + 1);
  const y = dayAfter.getFullYear();
  const m = String(dayAfter.getMonth() + 1).padStart(2, "0");
  const d = String(dayAfter.getDate()).padStart(2, "0");
  const exclusive = `${y}-${m}-${d}`;

  const rows = await db.getAllAsync<{ balance: number }>(
    `SELECT SUM(CASE WHEN e.type = 'debit' THEN e.amount ELSE 0 END)
            - SUM(CASE WHEN e.type IN ('credit', 'settlement') THEN e.amount ELSE 0 END)
            AS balance
     FROM hisaab_persons p
     INNER JOIN hisaab_entries e ON p.id = e.hisaab_person_id
       AND e.date < ?
       AND (e.linked_expense_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM expenses x WHERE x.id = e.linked_expense_id AND x.deleted_at IS NOT NULL
       ))
     WHERE p.owner_user_id = ? AND p.is_active = 1
     GROUP BY p.id;`,
    exclusive,
    userId,
  );
  let owedToMe = 0;
  let iOwe = 0;
  for (const r of rows) {
    if (r.balance > 0) owedToMe += r.balance;
    else if (r.balance < 0) iOwe += Math.abs(r.balance);
  }
  return { owedToMe, iOwe };
}

/**
 * Batch-compute closing balances for all balance-eligible accounts in one pass.
 *
 * Replaces the per-account `getAccountClosingForDate` loop. Instead of 7 serial
 * DB round-trips per account, we do 6 parallel queries covering all accounts at
 * once, then compute each closing in JS using the same `computeClosing` formula.
 *
 * Accounts with no opening-balance row in `account_month_balances` for the
 * target month are handled via their type-specific fallback:
 *  - pension (unseeded): `computeUnseededBalance` called individually (rare, typically 1 account)
 *  - savings/wallet/cc (live only): falls back to `last_known_balance` (isFallback=true)
 *  - savings/wallet/cc (historic): omitted from result — no authoritative data
 *
 * The self-heal write (`getOrCreateMonthBalance` may update a stale opening) is
 * intentionally skipped here; it happens lazily when the user visits the account
 * ledger. This is acceptable for the balance sheet overview.
 */
async function batchBalanceSheetClosings(
  accounts: AccountRow[],
  month: string,
  isLive: boolean,
): Promise<Map<string, { value: number; isFallback: boolean }>> {
  const result = new Map<string, { value: number; isFallback: boolean }>();
  if (accounts.length === 0) return result;

  const db = getDatabase();
  const { startDate, endDate } = getMonthDateRange(month);
  const ids = accounts.map((a) => a.id);
  const ph = ids.map(() => "?").join(",");

  const [openingRows, expenseRows, creditRows, tOutRows, tInRows, adjRows] = await Promise.all([
    db.getAllAsync<{ account_id: string; opening_balance: number }>(
      `SELECT account_id, opening_balance FROM account_month_balances
       WHERE account_id IN (${ph}) AND month = ?;`,
      ...ids, month,
    ),
    db.getAllAsync<{ account_id: string; total: number }>(
      `SELECT account_id, COALESCE(SUM(COALESCE(split_original_amount, amount)), 0) AS total
       FROM expenses
       WHERE account_id IN (${ph}) AND deleted_at IS NULL
         AND nature = 'realized' AND status = 'approved'
         AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
         AND date >= ? AND date <= ?
       GROUP BY account_id;`,
      ...ids, startDate, endDate,
    ),
    db.getAllAsync<{ account_id: string; total: number }>(
      `SELECT account_id, COALESCE(SUM(amount), 0) AS total
       FROM expenses
       WHERE account_id IN (${ph}) AND deleted_at IS NULL
         AND nature = 'credit' AND status = 'approved'
         AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
         AND date >= ? AND date <= ?
       GROUP BY account_id;`,
      ...ids, startDate, endDate,
    ),
    db.getAllAsync<{ account_id: string; total: number }>(
      `SELECT from_account_id AS account_id, COALESCE(SUM(amount), 0) AS total
       FROM account_transfers
       WHERE from_account_id IN (${ph}) AND deleted_at IS NULL
         AND date >= ? AND date <= ?
       GROUP BY from_account_id;`,
      ...ids, startDate, endDate,
    ),
    db.getAllAsync<{ account_id: string; total: number }>(
      `SELECT to_account_id AS account_id, COALESCE(SUM(amount), 0) AS total
       FROM account_transfers
       WHERE to_account_id IN (${ph}) AND deleted_at IS NULL
         AND date >= ? AND date <= ?
       GROUP BY to_account_id;`,
      ...ids, startDate, endDate,
    ),
    db.getAllAsync<{ account_id: string; net: number }>(
      `SELECT account_id,
              COALESCE(SUM(CASE WHEN description LIKE '% -]' THEN -amount ELSE amount END), 0) AS net
       FROM expenses
       WHERE account_id IN (${ph}) AND deleted_at IS NULL
         AND nature = 'ledger_adjustment' AND status = 'approved'
         AND date >= ? AND date <= ?
       GROUP BY account_id;`,
      ...ids, startDate, endDate,
    ),
  ]);

  const openingMap = new Map<string, number>();
  for (const r of openingRows) openingMap.set(r.account_id, r.opening_balance);
  const expMap = new Map<string, number>();
  for (const r of expenseRows) expMap.set(r.account_id, r.total);
  const credMap = new Map<string, number>();
  for (const r of creditRows) credMap.set(r.account_id, r.total);
  const tOutMap = new Map<string, number>();
  for (const r of tOutRows) tOutMap.set(r.account_id, r.total);
  const tInMap = new Map<string, number>();
  for (const r of tInRows) tInMap.set(r.account_id, r.total);
  const adjMap = new Map<string, number>();
  for (const r of adjRows) adjMap.set(r.account_id, r.net);

  const pensionUnseeded: AccountRow[] = [];

  for (const a of accounts) {
    const opening = openingMap.get(a.id);
    const isCC = a.account_type === "credit_card";

    if (opening == null) {
      if (a.account_type === "pension") {
        pensionUnseeded.push(a);
      } else if (isLive && a.last_known_balance != null) {
        result.set(a.id, { value: a.last_known_balance, isFallback: true });
      }
      continue;
    }

    const closing = computeClosing({
      opening,
      expenses: expMap.get(a.id) ?? 0,
      credits: credMap.get(a.id) ?? 0,
      transfersOut: tOutMap.get(a.id) ?? 0,
      transfersIn: tInMap.get(a.id) ?? 0,
      adjustmentNet: adjMap.get(a.id) ?? 0,
      isCC,
    });
    result.set(a.id, { value: closing, isFallback: false });
  }

  // Pension accounts are typically unseeded — handle individually (rare case)
  for (const a of pensionUnseeded) {
    const unseeded = await computeUnseededBalance(a.id, month);
    if (unseeded.closing !== 0 || unseeded.credits !== 0 || unseeded.expenses !== 0) {
      result.set(a.id, { value: unseeded.closing, isFallback: false });
    } else if (isLive && a.last_known_balance != null) {
      result.set(a.id, { value: a.last_known_balance, isFallback: true });
    }
  }

  return result;
}

export interface ColumnRequest {
  asOfDate: string;
  label: string;
  isLive: boolean;
  /** Start of the window for historic columns (FY start). null for Live. */
  minDate: string | null;
}

/**
 * Build a full balance-sheet column for a specific date.
 *
 * Batching strategy:
 *  - One SELECT for all accounts.
 *  - One batched query for portfolio snapshots (within window).
 *  - One batched query for fund snapshots (within window).
 *  - One aggregate hisaab query (all persons in one GROUP BY).
 *  - Per-account closing balance fetches run in parallel via Promise.all.
 *
 * Windowing rule for demat snapshots:
 *  - Historic column: snapshot_date must lie in [minDate, asOfDate].
 *    No snapshot in that FY → row omitted → UI renders "—".
 *  - Live column: latest snapshot on-or-before today.
 */
export async function getBalanceSheetColumn(
  userId: string,
  asOfDate: string,
  label: string,
  isLive: boolean,
  minDate: string | null,
): Promise<BalanceSheetColumn> {
  const accounts = await loadAccounts(userId);

  const dematIds = accounts.filter((a) => a.account_type === "demat").map((a) => a.id);
  const balanceEligible = accounts.filter(
    (a) => a.account_type === "savings" || a.account_type === "wallet" || a.account_type === "credit_card" || a.account_type === "pension",
  );

  const loanOutstandingsPromise = V15_FLAGS.v17_loans_v1
    ? getLoanOutstandingsByFA(userId, asOfDate)
    : Promise.resolve(new Map<string, number>());

  const [portfolioMap, fundMap, hisaab, loanOutstandings, balanceMap] = await Promise.all([
    batchSnapshotAsOf("demat_portfolio_snapshots", "portfolio_value", dematIds, asOfDate, minDate),
    batchSnapshotAsOf("demat_fund_snapshots", "fund_value", dematIds, asOfDate, minDate),
    batchHisaabAsOf(userId, isLive ? null : asOfDate),
    loanOutstandingsPromise,
    batchBalanceSheetClosings(balanceEligible, yyyymm(asOfDate), isLive),
  ]);

  const assets: BalanceSheetRow[] = [];
  const liabilities: BalanceSheetRow[] = [];

  for (const a of accounts) {
    const name = a.account_label ?? `${a.bank_name} ••••${a.account_identifier}`;

    if (a.account_type === "savings") {
      const r = balanceMap.get(a.id);
      if (r) assets.push({ label: name, group: "savings", amount: r.value, accountId: a.id, isFallback: r.isFallback });
    } else if (a.account_type === "wallet") {
      const r = balanceMap.get(a.id);
      if (r) assets.push({ label: name, group: "wallet", amount: r.value, accountId: a.id, isFallback: r.isFallback });
    } else if (a.account_type === "pension") {
      // Treat pension accounts same as savings - use ledger-based balance calculation
      const r = balanceMap.get(a.id);
      if (r) assets.push({ label: name, group: "pension", amount: r.value, accountId: a.id, isFallback: r.isFallback });
    } else if (a.account_type === "demat") {
      // Portfolio — include ONLY when a snapshot exists within the window.
      // Absent → row omitted → UI cell shows "—".
      if (portfolioMap.has(a.id)) {
        assets.push({
          label: `${name} · Portfolio`,
          group: "demat_portfolio",
          amount: portfolioMap.get(a.id)!,
          accountId: a.id,
          isFallback: false,
        });
      }
      if (fundMap.has(a.id)) {
        assets.push({
          label: `${name} · Fund`,
          group: "demat_fund",
          amount: fundMap.get(a.id)!,
          accountId: a.id,
          isFallback: false,
        });
      }
    } else if (a.account_type === "credit_card") {
      const r = balanceMap.get(a.id);
      if (r && (r.value > 0 || !r.isFallback)) {
        liabilities.push({ label: name, group: "cc", amount: Math.max(0, r.value), accountId: a.id, isFallback: r.isFallback });
      }
    } else if (a.account_type === "loan") {
      // v17.0.0: if a loan_accounts row exists, use amortization-schedule
      // outstanding (accurate + historic-column friendly). Else fall back to
      // last_known_balance scalar (legacy behaviour, live column only).
      const amortized = loanOutstandings.get(a.id);
      if (amortized !== undefined) {
        if (amortized > 0) {
          liabilities.push({
            label: name,
            group: "loan",
            amount: amortized,
            accountId: a.id,
            isFallback: false,
          });
        }
      } else if (isLive) {
        const val = a.last_known_balance ?? 0;
        if (val > 0) {
          liabilities.push({ label: name, group: "loan", amount: val, accountId: a.id, isFallback: true });
        }
      }
    }
  }

  if (hisaab.owedToMe > 0) {
    assets.push({ label: "Hisaab · People owe me", group: "hisaab_owed", amount: hisaab.owedToMe });
  }
  if (hisaab.iOwe > 0) {
    liabilities.push({ label: "Hisaab · I owe", group: "hisaab_owes", amount: hisaab.iOwe });
  }

  const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);

  return {
    asOfDate,
    label,
    isLive,
    assets,
    liabilities,
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
  };
}

/**
 * Does the user have ANY balance-sheet-relevant data within [fyStart, fyEnd]?
 * Used to disable the "add earlier FY" button when there's nothing to show.
 *
 * Checks: seeded month balances, demat portfolio snapshots, demat fund
 * snapshots, hisaab entries. Cheap aggregate — one EXISTS per source.
 */
export async function hasDataInRange(
  userId: string,
  fyStart: string,
  fyEnd: string,
): Promise<boolean> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ found: number }>(
    `SELECT (
       EXISTS (
         SELECT 1 FROM account_month_balances amb
         INNER JOIN financial_accounts fa ON fa.id = amb.account_id
         WHERE fa.user_id = ? AND amb.month >= substr(?, 1, 7) AND amb.month <= substr(?, 1, 7)
       )
       OR EXISTS (
         SELECT 1 FROM demat_portfolio_snapshots s
         INNER JOIN financial_accounts fa ON fa.id = s.account_id
         WHERE fa.user_id = ? AND s.snapshot_date >= ? AND s.snapshot_date <= ?
       )
       OR EXISTS (
         SELECT 1 FROM demat_fund_snapshots s
         INNER JOIN financial_accounts fa ON fa.id = s.account_id
         WHERE fa.user_id = ? AND s.snapshot_date >= ? AND s.snapshot_date <= ?
       )
       OR EXISTS (
         SELECT 1 FROM hisaab_entries e
         INNER JOIN hisaab_persons p ON p.id = e.hisaab_person_id
         WHERE p.owner_user_id = ? AND e.date >= ? AND e.date <= ?
       )
     ) AS found;`,
    userId, fyStart, fyEnd,
    userId, fyStart, fyEnd,
    userId, fyStart, fyEnd,
    userId, fyStart, fyEnd,
  );
  return (row?.found ?? 0) === 1;
}

/**
 * Build the balance sheet for a set of columns in parallel.
 */
export async function getBalanceSheet(
  userId: string,
  columns: ColumnRequest[],
): Promise<BalanceSheetColumn[]> {
  return Promise.all(
    columns.map((c) => getBalanceSheetColumn(userId, c.asOfDate, c.label, c.isLive, c.minDate)),
  );
}
