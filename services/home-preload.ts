import { DEFAULT_USER_ID } from "@/constants/app";
import { getBudgetsForMonth, getCurrentMonth } from "@/services/budget";
import {
  getExpenseTotal,
  getPendingExpenseCount,
  getOverdueForecasts,
  getForecastExpenses,
  getUncategorizedCount,
} from "@/services/expense";
import type { Expense } from "@/services/expense";
import { getHisaabSummary } from "@/services/hisaab";
import { scanAllDuplicatesCached } from "@/services/duplicate-detection";
import {
  getActiveAccounts,
  getCcExpenseTotals,
  getDematSummary,
  getDematAccountsWithSummary,
  getAccountLatestStaleCheckDates,
} from "@/services/financial-account";
import type { FinancialAccount, DematAccountSummary } from "@/services/financial-account";
import {
  getComputedBalances,
  getComputedBalanceComponents,
  getEarliestMonthForAccounts,
  getAdjustmentAbsTotalByAccountType,
  getMonthBalanceSummary,
  getAccountExpensesTotal,
  getAccountCreditsTotal,
  getAccountAdjustmentNet,
} from "@/services/account-balance";
import type { BalanceComponents } from "@/services/account-balance";
import { getAllAccountsWithModes } from "@/services/account-master";
import type { AccountWithModes } from "@/services/account-master";
import { getBalanceSheetColumn } from "@/services/balance-sheet";
import type { BalanceSheetColumn } from "@/services/balance-sheet";
import { getBalanceSourceInfo } from "@/services/balance-source";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { formatLocalDate } from "@/utils/fiscal-year";
import { logger } from "@/utils/logger";

// ---------------------------------------------------------------------------
// Home tab
// ---------------------------------------------------------------------------

export interface HomePreloadData {
  totalSpent: number;
  totalBudget: number;
  pendingCount: number;
  overdueCount: number;
  upcomingDues: Expense[];
  hisaabSummary: { totalOwedToYou: number; totalYouOwe: number; netBalance: number };
  duplicateCount: number;
  uncategorizedCount: number;
  ccAccounts: FinancialAccount[];
  bankAccounts: FinancialAccount[];
  walletAccounts: FinancialAccount[];
  pensionAccounts: FinancialAccount[];
  ccExpenseTotals: Record<string, number>;
  computedBalanceMap: Record<string, number | null>;
  dematSummary: { totalPortfolio: number; totalFund: number; accountCount: number };
}

// ---------------------------------------------------------------------------
// Accounts master
// ---------------------------------------------------------------------------

export interface AccountsPreloadData {
  accounts: AccountWithModes[];
  dematSummaries: DematAccountSummary[];
}

// ---------------------------------------------------------------------------
// Balance Sheet (Live column only — historic columns are user-triggered)
// ---------------------------------------------------------------------------

export interface BalanceSheetPreloadData {
  liveColumn: BalanceSheetColumn;
}

// ---------------------------------------------------------------------------
// Reconciliation — Credit Cards / Bank Accounts / Wallets
// ---------------------------------------------------------------------------

export interface CreditCardsPreloadData {
  ccAccounts: FinancialAccount[];
  expenseTotals: Record<string, number>;
  /** v15.9.2: pool-level staleness keyed by bank name (replaces per-account staleDates). */
  poolStaleByBank: Record<string, boolean>;
  adjustmentStats: { total: number; count: number };
  balanceComponents: Record<string, BalanceComponents | null>;
  minMonth: string | undefined;
}

export interface AccountSummaryRow {
  account: FinancialAccount;
  opening: number;
  expenses: number;
  credits: number;
  current: number;
  seeded: boolean;
  autoDetectedStale: boolean;
}

export interface BankAccountsPreloadData {
  summaries: AccountSummaryRow[];
  adjustmentStats: { total: number; count: number };
}

export interface WalletsPreloadData {
  summaries: AccountSummaryRow[];
  adjustmentStats: { total: number; count: number };
}

export interface PensionAccountsPreloadData {
  summaries: AccountSummaryRow[];
  adjustmentStats: { total: number; count: number };
}

// ---------------------------------------------------------------------------
// Cache — single-use per screen. `consume*` clears after read so stale data
// doesn't haunt the next focus.
// ---------------------------------------------------------------------------

interface Cache {
  home: HomePreloadData | null;
  accounts: AccountsPreloadData | null;
  balanceSheet: BalanceSheetPreloadData | null;
  creditCards: CreditCardsPreloadData | null;
  bankAccounts: BankAccountsPreloadData | null;
  wallets: WalletsPreloadData | null;
  pensionAccounts: PensionAccountsPreloadData | null;
}
const cache: Cache = {
  home: null,
  accounts: null,
  balanceSheet: null,
  creditCards: null,
  bankAccounts: null,
  wallets: null,
  pensionAccounts: null,
};

// ---------------------------------------------------------------------------
// Per-section loaders — each wrapped in try/catch so one failure doesn't
// knock out the rest of the preload.
// ---------------------------------------------------------------------------

async function loadHomeSection(): Promise<HomePreloadData | null> {
  try {
    const month = getCurrentMonth();
    const { startDate, endDate } = getMonthDateRange(month);
    const today = new Date().toISOString().split("T")[0];

    const [budgets, total, pending, hisaab, overdue, forecasts, dupScan, allAccounts, ccTotals, uncatCount, dematSum] = await Promise.all([
      getBudgetsForMonth(DEFAULT_USER_ID, month),
      getExpenseTotal(DEFAULT_USER_ID, startDate, endDate),
      getPendingExpenseCount(DEFAULT_USER_ID),
      getHisaabSummary(DEFAULT_USER_ID),
      getOverdueForecasts(DEFAULT_USER_ID, today),
      getForecastExpenses(DEFAULT_USER_ID),
      scanAllDuplicatesCached(DEFAULT_USER_ID),
      getActiveAccounts(DEFAULT_USER_ID),
      getCcExpenseTotals(DEFAULT_USER_ID, startDate, endDate),
      getUncategorizedCount(DEFAULT_USER_ID),
      getDematSummary(DEFAULT_USER_ID),
    ]);

    const allIds = allAccounts.map((a) => a.id);
    const balances = await getComputedBalances(allIds);
    const activeDues = forecasts.filter((f) => f.due_date && f.status !== "rejected");

    return {
      totalSpent: total,
      totalBudget: budgets.reduce((sum, b) => sum + b.amount, 0),
      pendingCount: pending,
      overdueCount: overdue.length,
      upcomingDues: activeDues,
      hisaabSummary: hisaab,
      duplicateCount: dupScan.duplicateGroupCount,
      uncategorizedCount: uncatCount,
      ccAccounts: allAccounts.filter((a) => a.account_type === "credit_card"),
      bankAccounts: allAccounts.filter((a) => a.account_type === "savings"),
      walletAccounts: allAccounts.filter((a) => a.account_type === "wallet"),
      pensionAccounts: allAccounts.filter((a) => a.account_type === "pension"),
      ccExpenseTotals: ccTotals,
      computedBalanceMap: balances,
      dematSummary: dematSum,
    };
  } catch (e) {
    logger.warn("Home preload section failed:", e);
    return null;
  }
}

async function loadAccountsSection(): Promise<AccountsPreloadData | null> {
  try {
    const [accounts, dematSummaries] = await Promise.all([
      getAllAccountsWithModes(DEFAULT_USER_ID),
      getDematAccountsWithSummary(DEFAULT_USER_ID),
    ]);
    return { accounts, dematSummaries };
  } catch (e) {
    logger.warn("Accounts preload section failed:", e);
    return null;
  }
}

async function loadBalanceSheetSection(): Promise<BalanceSheetPreloadData | null> {
  try {
    const todayStr = formatLocalDate(new Date());
    const liveColumn = await getBalanceSheetColumn(DEFAULT_USER_ID, todayStr, "Today", true, null);
    return { liveColumn };
  } catch (e) {
    logger.warn("Balance sheet preload section failed:", e);
    return null;
  }
}

async function loadCreditCardsSection(): Promise<CreditCardsPreloadData | null> {
  try {
    const month = getCurrentMonth();
    const { startDate, endDate } = getMonthDateRange(month);

    const [allAccounts, totals, adjStats] = await Promise.all([
      getActiveAccounts(DEFAULT_USER_ID),
      getCcExpenseTotals(DEFAULT_USER_ID, startDate, endDate),
      getAdjustmentAbsTotalByAccountType(DEFAULT_USER_ID, "credit_card", startDate, endDate),
    ]);
    const ccOnly = allAccounts.filter((a) => a.account_type === "credit_card");

    // v15.9.2: pool staleness via getBalanceSourceInfo (matches Account Detail).
    // One call per bank group.
    const bankAnchors = new Map<string, string>();
    for (const a of ccOnly) {
      if (!bankAnchors.has(a.bank_name)) bankAnchors.set(a.bank_name, a.id);
    }
    const staleEntries = await Promise.all(
      Array.from(bankAnchors.entries()).map(async ([bankName, anchorId]) => {
        try {
          const info = await getBalanceSourceInfo(anchorId);
          return [bankName, info?.isStale ?? false] as const;
        } catch {
          return [bankName, false] as const;
        }
      }),
    );
    const poolStaleByBank: Record<string, boolean> = Object.fromEntries(staleEntries);

    let balanceComponents: Record<string, BalanceComponents | null> = {};
    let minMonth: string | undefined;
    if (ccOnly.length > 0) {
      const ccIds = ccOnly.map((a) => a.id);
      const [components, earliestMonth] = await Promise.all([
        getComputedBalanceComponents(ccIds),
        getEarliestMonthForAccounts(ccIds),
      ]);
      balanceComponents = components;
      minMonth = earliestMonth ?? undefined;
    }

    return {
      ccAccounts: ccOnly,
      expenseTotals: totals,
      poolStaleByBank,
      adjustmentStats: adjStats,
      balanceComponents,
      minMonth,
    };
  } catch (e) {
    logger.warn("Credit cards preload section failed:", e);
    return null;
  }
}

async function loadAccountGroupSection(
  accountType: "savings" | "wallet" | "pension",
): Promise<{ summaries: AccountSummaryRow[]; adjustmentStats: { total: number; count: number } } | null> {
  try {
    const month = getCurrentMonth();
    const { startDate, endDate } = getMonthDateRange(month);

    const [allAccounts, staleDates, adjStats] = await Promise.all([
      getActiveAccounts(DEFAULT_USER_ID),
      getAccountLatestStaleCheckDates(DEFAULT_USER_ID, startDate, endDate),
      getAdjustmentAbsTotalByAccountType(DEFAULT_USER_ID, accountType, startDate, endDate),
    ]);
    const group = allAccounts.filter((a) => a.account_type === accountType);

    const summaries: AccountSummaryRow[] = await Promise.all(
      group.map(async (account) => {
        const summary = await getMonthBalanceSummary(account.id, month);
        const latestActivity = staleDates[account.id];
        const autoDetectedStale = !!(
          account.last_balance_date &&
          latestActivity &&
          latestActivity > account.last_balance_date
        );
        if (summary) {
          return {
            account,
            opening: summary.opening_balance,
            expenses: summary.expenses,
            credits: summary.credits,
            current: summary.closing_balance,
            seeded: true,
            autoDetectedStale,
          };
        }
        const [expenses, credits, adjNet] = await Promise.all([
          getAccountExpensesTotal(account.id, startDate, endDate),
          getAccountCreditsTotal(account.id, startDate, endDate),
          getAccountAdjustmentNet(account.id, startDate, endDate),
        ]);
        return {
          account,
          opening: 0,
          expenses,
          credits,
          current: 0 - expenses + credits + adjNet,
          seeded: false,
          autoDetectedStale,
        };
      }),
    );

    return { summaries, adjustmentStats: adjStats };
  } catch (e) {
    logger.warn(`${accountType} preload section failed:`, e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Called once on app startup. Fetches data for Home + Accounts + Balance Sheet
 * (Live) + reconciliation screens in parallel and stores each under its own
 * cache key. Each subsequent screen's consume* call reads-and-clears its slot.
 *
 * Failures in any section are logged and that slot is left null — screens fall
 * back to their own fetch path gracefully.
 */
export async function preloadHomeData(): Promise<void> {
  const [home, accounts, balanceSheet, creditCards, bankAccounts, wallets, pensionAccounts] = await Promise.all([
    loadHomeSection(),
    loadAccountsSection(),
    loadBalanceSheetSection(),
    loadCreditCardsSection(),
    loadAccountGroupSection("savings"),
    loadAccountGroupSection("wallet"),
    loadAccountGroupSection("pension"),
  ]);
  cache.home = home;
  cache.accounts = accounts;
  cache.balanceSheet = balanceSheet;
  cache.creditCards = creditCards;
  cache.bankAccounts = bankAccounts;
  cache.wallets = wallets;
  cache.pensionAccounts = pensionAccounts;
}

export function consumeHomePreload(): HomePreloadData | null {
  const data = cache.home;
  cache.home = null;
  return data;
}

export function consumeAccountsPreload(): AccountsPreloadData | null {
  const data = cache.accounts;
  cache.accounts = null;
  return data;
}

export function consumeBalanceSheetPreload(): BalanceSheetPreloadData | null {
  const data = cache.balanceSheet;
  cache.balanceSheet = null;
  return data;
}

export function consumeCreditCardsPreload(): CreditCardsPreloadData | null {
  const data = cache.creditCards;
  cache.creditCards = null;
  return data;
}

export function consumeBankAccountsPreload(): BankAccountsPreloadData | null {
  const data = cache.bankAccounts;
  cache.bankAccounts = null;
  return data;
}

export function consumeWalletsPreload(): WalletsPreloadData | null {
  const data = cache.wallets;
  cache.wallets = null;
  return data;
}

export function consumePensionAccountsPreload(): PensionAccountsPreloadData | null {
  const data = cache.pensionAccounts;
  cache.pensionAccounts = null;
  return data;
}
