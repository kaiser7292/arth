import { getDatabase } from "@/database";
import {
  computeUnseededBalance,
  getAccountAdjustmentNet,
  getAccountCreditsTotal,
  getAccountExpensesTotal,
  getComputedBalances,
} from "@/services/account-balance";
import { getTransfersInTotal, getTransfersOutTotal } from "@/services/account-transfer";
import { getCurrentMonth } from "@/services/budget";
import { getAccountTypeDoubts, getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { todayIso } from "@/utils/date";

/**
 * Data health: what's inconsistent or doesn't add up, found on the phone with no AI. The same
 * findings go into the Fix my data export (so the user's AI starts from them) and onto the Data
 * health screen (with a tidy score). Every check is read-only.
 */

export type HealthCheckId =
  | "uncategorised"
  | "no_account"
  | "duplicates"
  | "transfers"
  | "refunds"
  | "redemptions"
  | "sips"
  | "balance_gaps"
  | "account_types"
  | "merchant_spellings"
  | "merchant_categories"
  | "overdue_dues";

export interface BalanceGap {
  accountId: string;
  name: string;
  /** What the bank said, and on which day. */
  bank: number;
  bankDate: string;
  /** What Arth makes it on that day. */
  arth: number;
  /** bank − arth */
  gap: number;
}

export interface MerchantSpelling {
  /** The spellings, most used first. */
  names: { name: string; count: number }[];
}

export interface MerchantCategories {
  merchant: string;
  categories: { name: string; count: number }[];
}

export interface HealthCheck {
  id: HealthCheckId;
  label: string;
  /** How many items. 0 = all good. */
  count: number;
  /** One line about what it means. */
  hint: string;
}

export interface HealthReport {
  checks: HealthCheck[];
  /** 0-100: share of transactions with nothing to fix, less a little for account-level issues. */
  score: number;
  /** Approved transactions looked at. */
  transactions: number;
  balanceGaps: BalanceGap[];
  merchantSpellings: MerchantSpelling[];
  merchantCategories: MerchantCategories[];
  accountTypeDoubts: { accountId: string; name: string; type: string; suggested: string | null }[];
}

const LIVE = `deleted_at IS NULL AND status = 'approved'`;

/** A merchant's name boiled down so spellings of the same one meet: "SWIGGY*ORDER", "Swiggy Ltd" → "swiggy". */
export function merchantKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(pvt|private|ltd|limited|llp|inc|india|technologies|tech|services|payments?|online|retail|store|www|com|in|order|orders|upi|pos|txn|ref|ecom)\b/g, " ")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12);
}

/** Arth's balance for an account at the end of `date`: today's, less what moved after it. */
async function arthBalanceOn(account: FinancialAccount, current: number, date: string, today: string): Promise<number> {
  if (date >= today) return current;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const from = d.toISOString().slice(0, 10);
  const [spent, credits, out, inn, adj] = await Promise.all([
    getAccountExpensesTotal(account.id, from, today),
    getAccountCreditsTotal(account.id, from, today),
    getTransfersOutTotal(account.id, from, today),
    getTransfersInTotal(account.id, from, today),
    getAccountAdjustmentNet(account.id, from, today),
  ]);
  return current + spent - credits + out - inn - adj;
}

export async function getBalanceGaps(userId: string, today: string = todayIso()): Promise<BalanceGap[]> {
  const accounts = (await getActiveAccounts(userId)).filter(
    (a) =>
      ["savings", "bank", "wallet"].includes(a.account_type as string) &&
      a.last_known_balance != null &&
      a.last_balance_date,
  );
  if (accounts.length === 0) return [];
  const computed = await getComputedBalances(accounts.map((a) => a.id));
  const month = getCurrentMonth();
  const out: BalanceGap[] = [];
  for (const a of accounts) {
    const current = computed[a.id] ?? (await computeUnseededBalance(a.id, month)).closing;
    const bankDate = (a.last_balance_date ?? "").slice(0, 10);
    const arth = await arthBalanceOn(a, current, bankDate, today);
    const gap = Math.round(((a.last_known_balance ?? 0) - arth) * 100) / 100;
    if (Math.abs(gap) >= 1) {
      out.push({
        accountId: a.id,
        name: `${a.account_label || a.bank_name}${a.account_identifier ? ` ··${a.account_identifier}` : ""}`,
        bank: a.last_known_balance ?? 0,
        bankDate,
        arth: Math.round(arth * 100) / 100,
        gap,
      });
    }
  }
  return out;
}

export async function getMerchantSpellings(userId: string): Promise<MerchantSpelling[]> {
  const rows = await getDatabase().getAllAsync<{ name: string; n: number }>(
    `SELECT merchant_name AS name, COUNT(*) AS n FROM expenses
     WHERE user_id = ? AND ${LIVE} AND merchant_name IS NOT NULL AND TRIM(merchant_name) <> ''
     GROUP BY merchant_name;`,
    userId,
  );
  const groups = new Map<string, { name: string; count: number }[]>();
  for (const r of rows) {
    const key = merchantKey(r.name);
    if (key.length < 3) continue;
    groups.set(key, [...(groups.get(key) ?? []), { name: r.name, count: r.n }]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({ names: g.sort((a, b) => b.count - a.count) }))
    .sort((a, b) => b.names.reduce((s, x) => s + x.count, 0) - a.names.reduce((s, x) => s + x.count, 0));
}

export async function getMerchantCategoryMix(userId: string): Promise<MerchantCategories[]> {
  const rows = await getDatabase().getAllAsync<{ merchant: string; category: string; n: number }>(
    `SELECT e.merchant_name AS merchant, c.name AS category, COUNT(*) AS n
     FROM expenses e JOIN categories c ON c.id = e.category_id
     WHERE e.user_id = ? AND e.deleted_at IS NULL AND e.status = 'approved' AND e.nature = 'realized'
       AND e.merchant_name IS NOT NULL AND TRIM(e.merchant_name) <> ''
       AND (e.reclassified_as_transfer IS NULL OR e.reclassified_as_transfer = 0)
     GROUP BY e.merchant_name, c.name;`,
    userId,
  );
  const byMerchant = new Map<string, { name: string; count: number }[]>();
  for (const r of rows) byMerchant.set(r.merchant, [...(byMerchant.get(r.merchant) ?? []), { name: r.category, count: r.n }]);
  return [...byMerchant.entries()]
    .filter(([, cats]) => cats.length > 1 && cats.reduce((s, c) => s + c.count, 0) >= 3)
    .map(([merchant, cats]) => ({ merchant, categories: cats.sort((a, b) => b.count - a.count) }))
    .sort((a, b) => b.categories.reduce((s, c) => s + c.count, 0) - a.categories.reduce((s, c) => s + c.count, 0));
}

async function count(sql: string, ...args: (string | number)[]): Promise<number> {
  return (await getDatabase().getFirstAsync<{ n: number }>(sql, ...args))?.n ?? 0;
}

export async function getHealthReport(userId: string, today: string = todayIso()): Promise<HealthReport> {
  const notTransfer = `(reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)`;
  const [transactions, uncategorised, noAccount, refunds, redemptions, sips] = await Promise.all([
    count(`SELECT COUNT(*) AS n FROM expenses WHERE user_id = ? AND ${LIVE} AND nature IN ('realized', 'credit');`, userId),
    count(
      `SELECT COUNT(*) AS n FROM expenses WHERE user_id = ? AND ${LIVE} AND nature = 'realized' AND category_id IS NULL AND ${notTransfer};`,
      userId,
    ),
    count(
      `SELECT COUNT(*) AS n FROM expenses WHERE user_id = ? AND ${LIVE} AND nature IN ('realized', 'credit')
         AND account_id IS NULL AND source = 'sms_auto' AND ${notTransfer};`,
      userId,
    ),
    count(
      `SELECT COUNT(*) AS n FROM expenses WHERE user_id = ? AND ${LIVE} AND nature = 'credit'
         AND credit_kind = 'refund' AND refund_of_expense_id IS NULL;`,
      userId,
    ),
    count(`SELECT COUNT(*) AS n FROM expenses WHERE user_id = ? AND ${LIVE} AND money_event = 'investment_withdrawal';`, userId),
    count(
      `SELECT COUNT(*) AS n FROM expenses e WHERE e.user_id = ? AND e.deleted_at IS NULL AND e.status = 'approved'
         AND e.money_event = 'sip' AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = e.id);`,
      userId,
    ),
  ]);

  const safe = async <T,>(f: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await f();
    } catch {
      return fallback;
    }
  };
  const { scanAllDuplicates } = await import("@/services/duplicate-detection");
  const { findTransferCandidates } = await import("@/services/transfer-detect");
  const { getOverdueForecasts } = await import("@/services/expense-forecasts");
  const monthAgo = new Date(`${today}T00:00:00Z`);
  monthAgo.setUTCDate(monthAgo.getUTCDate() - 30);

  const [dupes, transfers, gaps, spellings, mix, overdue, accounts] = await Promise.all([
    safe(() => scanAllDuplicates(userId), { groups: [], scannedCount: 0, duplicateGroupCount: 0 }),
    safe(() => findTransferCandidates(userId), []),
    safe(() => getBalanceGaps(userId, today), []),
    safe(() => getMerchantSpellings(userId), []),
    safe(() => getMerchantCategoryMix(userId), []),
    safe(() => getOverdueForecasts(userId, monthAgo.toISOString().slice(0, 10)), []),
    safe(() => getActiveAccounts(userId), []),
  ]);
  const everyday = accounts.filter((a) => ["savings", "bank", "wallet", "credit_card"].includes(a.account_type as string));
  const doubts = await safe(() => getAccountTypeDoubts(everyday.map((a) => a.id)), new Map());
  const accountTypeDoubts = everyday
    .filter((a) => doubts.has(a.id))
    .map((a) => ({
      accountId: a.id,
      name: `${a.account_label || a.bank_name}${a.account_identifier ? ` ··${a.account_identifier}` : ""}`,
      type: a.account_type as string,
      suggested: doubts.get(a.id)?.suggested ?? null,
    }));
  const transferCount = transfers.filter((t) => t.toAccountId).length;
  const dupItems = dupes.groups.reduce((s, g) => s + g.expenses.length - 1, 0);
  const spellingItems = spellings.reduce((s, g) => s + g.names.slice(1).reduce((x, n) => x + n.count, 0), 0);
  const mixItems = mix.reduce((s, m) => s + m.categories.slice(1).reduce((x, c) => x + c.count, 0), 0);

  const checks: HealthCheck[] = [
    { id: "uncategorised", label: "Uncategorised spending", count: uncategorised, hint: "Not counted under any budget" },
    { id: "duplicates", label: "Possible duplicates", count: dupItems, hint: "The same payment counted twice" },
    { id: "transfers", label: "Transfers counted as spending", count: transferCount, hint: "Money between your own accounts" },
    { id: "refunds", label: "Refunds not linked", count: refunds, hint: "Still counted as the full purchase" },
    { id: "balance_gaps", label: "Balances that differ from the bank", count: gaps.length, hint: "Arth's figure isn't the bank's" },
    { id: "account_types", label: "Accounts whose type looks wrong", count: accountTypeDoubts.length, hint: "Their messages point another way" },
    { id: "merchant_spellings", label: "Merchants spelled several ways", count: spellings.length, hint: "Split across names in reports" },
    { id: "merchant_categories", label: "Merchants in more than one category", count: mix.length, hint: "Filed differently each time" },
    { id: "no_account", label: "Transactions with no account", count: noAccount, hint: "Missing from every account's ledger" },
    { id: "redemptions", label: "Money back from investments, unsorted", count: redemptions, hint: "Not counted as income until sorted" },
    { id: "sips", label: "SIPs not linked to an investment", count: sips, hint: "Not counted towards your buckets" },
    { id: "overdue_dues", label: "Dues overdue by a month or more", count: overdue.length, hint: "Paid, skipped, or still owed?" },
  ];

  // Score: transactions with nothing to fix, less two points per account-level issue.
  const txnIssues = uncategorised + dupItems + transferCount + refunds + noAccount + redemptions + sips + spellingItems + mixItems;
  const base = transactions > 0 ? Math.max(0, 1 - txnIssues / transactions) * 100 : 100;
  const score = Math.max(0, Math.min(100, Math.round(base - 2 * (gaps.length + accountTypeDoubts.length + overdue.length / 5))));

  return {
    checks,
    score,
    transactions,
    balanceGaps: gaps,
    merchantSpellings: spellings,
    merchantCategories: mix,
    accountTypeDoubts,
  };
}
