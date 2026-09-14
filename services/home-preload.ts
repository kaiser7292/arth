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
  getDematAccountsWithSummary,
  getAccountLatestStaleCheckDates,
} from "@/services/financial-account";
import type { FinancialAccount, DematAccountSummary } from "@/services/financial-account";
import {
  batchInvestmentProducts,
  getInvestmentSummary,
  getUnifiedInvestmentValues,
  getUpcomingFDMaturities,
  isPensionLikeAccount,
  type InvestmentSummary,
  type InvestmentProduct,
  type UpcomingFDMaturity,
} from "@/services/investment-accounts";
import {
  getComputedBalances,
  getComputedBalanceComponents,
  computeUnseededBalance,
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
import { getCurrentFY, getFYRange, formatLocalDate } from "@/utils/fiscal-year";
import { logger } from "@/utils/logger";
import { getFinancialCockpit } from "@/services/financial-cockpit";
import type { FinancialCockpitData } from "@/services/financial-cockpit";
import { getMilestonesForFY } from "@/services/life-milestone";
import type { LifeMilestone } from "@/services/life-milestone";
import {
  getLoansSummary,
  listActiveLoans,
  listAllLoansWithBankName,
  getLoanOutstandingsByLoanId,
  getCurrentEMIsByLoanId,
  getSchedulesByLoanIds,
} from "@/services/loan-accounts";
import type { LoanAccount, LoansSummary } from "@/services/loan-accounts";
import { getTransfersOutTotal, getTransfersInTotal } from "@/services/account-transfer";
import { deriveYearlyPlan, getBucketsByFY } from "@/services/yearly-plan";
import type { DerivedPlanSummary, InvestmentBucket } from "@/services/yearly-plan";
import { getSalaryProfileByFY } from "@/services/salary-profile";
import type { SalaryProfile } from "@/services/salary-profile";
import { getDataVersion, getFYStartMonth } from "@/services/settings";
import { getVaultEntries } from "@/services/vault";
import type { VaultEntry } from "@/services/vault";
import { getDueReminders } from "@/services/recurring-rules";
import type { ReminderWithSource } from "@/services/recurring-rules";
import { findAutoMatches } from "@/services/reminder-matching";
import type { ReminderAutoMatch } from "@/services/reminder-matching";
import { getAnalyticsForecast, type AnalyticsForecast } from "@/services/analytics-forecast";
import { getInsights, type Insight } from "@/services/insight-engine";
import { getThisVsLastMonthTotals } from "@/services/comparison-insights";
import { getCategories } from "@/services/category";
import type { Category } from "@/services/category";
import { getPaymentModes } from "@/services/payment-mode";
import type { PaymentMode } from "@/services/payment-mode";
import { getTags } from "@/services/tags";
import type { Tag } from "@/services/tags";
import { getDistinctMerchantNames } from "@/services/merchant-alias";
import { listRules, type SmartRule } from "@/services/smart-rules";

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
  ccExpenseTotals: Record<string, number>;
  computedBalanceMap: Record<string, number | null>;
  investmentSummary: InvestmentSummary;
  dueReminders: ReminderWithSource[];
  autoMatches: ReminderAutoMatch[];
  loansSummary: LoansSummary | null;
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
  transfersOut: number;
  transfersIn: number;
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
// Goals screens (Investments + Milestones)
// ---------------------------------------------------------------------------

export interface GoalsPreloadData {
  cockpit: FinancialCockpitData | null;
  fyMilestones: LifeMilestone[];
  fyBuckets: InvestmentBucket[];
  hasSalaryProfile: boolean;
  activeLoansCount: number;
  totalMonthlyEMI: number;
  /** Which FY the cockpit was computed for (YYYY string). */
  fy: string;
}

// ---------------------------------------------------------------------------
// Yearly Plan screen
// ---------------------------------------------------------------------------

export interface YearlyPlanPreloadData {
  /** Which FY this was preloaded for — screen must verify before consuming. */
  fy: string;
  derived: DerivedPlanSummary | null;
  profile: SalaryProfile | null;
}

// ---------------------------------------------------------------------------
// Loans
// ---------------------------------------------------------------------------

export type EnrichedLoan = LoanAccount & { bank_name: string; outstanding: number; current_emi: number; remaining_months: number };

export interface LoansPreloadData {
  loans: EnrichedLoan[];
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

export interface VaultPreloadData {
  entries: VaultEntry[];
}

// ---------------------------------------------------------------------------
// Investments hero (app/investments/index.tsx)
// ---------------------------------------------------------------------------

export interface InvestmentsPreloadData {
  accounts: FinancialAccount[];
  products: Map<string, InvestmentProduct>;
  values: Map<string, number>;
  maturities: UpcomingFDMaturity[];
}

// ---------------------------------------------------------------------------
// Insights / Analytics dashboard (shared by Home swipe-pager page 1 and
// app/insights/index.tsx)
// ---------------------------------------------------------------------------

export interface InsightsPreloadData {
  forecast: AnalyticsForecast | null;
  insights: Insight[];
  thisMonthTotal: number;
  lastMonthTotal: number;
}

// ---------------------------------------------------------------------------
// Transactions tab — reference data only (categories, payment modes,
// accounts, tags, merchants, rules, pending count). The paginated expense
// list itself is NOT preloaded here — too large/filter-dependent.
// ---------------------------------------------------------------------------

export interface TransactionsPreloadData {
  categories: Category[];
  paymentModes: PaymentMode[];
  accounts: FinancialAccount[];
  tags: Tag[];
  merchantNames: string[];
  rules: SmartRule[];
  pendingCount: number;
}

// ---------------------------------------------------------------------------
// Cache — single-use per screen. `consume*` clears after read so stale data
// doesn't haunt the next focus.
// ---------------------------------------------------------------------------

interface Cache {
  accounts: AccountsPreloadData | null;
  balanceSheet: BalanceSheetPreloadData | null;
  creditCards: CreditCardsPreloadData | null;
  bankAccounts: BankAccountsPreloadData | null;
  wallets: WalletsPreloadData | null;
  pensionAccounts: PensionAccountsPreloadData | null;
  goals: GoalsPreloadData | null;
  yearlyPlan: YearlyPlanPreloadData | null;
  loans: LoansPreloadData | null;
  vault: VaultPreloadData | null;
  investments: InvestmentsPreloadData | null;
  insights: InsightsPreloadData | null;
  transactions: TransactionsPreloadData | null;
  /** Non-destructive snapshot of the current-month totals also present in
   *  `home`, so the Budget tab can seed its initial numbers even though Home
   *  always consumes (and clears) `cache.home` first on app launch. */
  homeTotals: { month: string; totalBudget: number; totalSpent: number } | null;
}
const cache: Cache = {
  accounts: null,
  balanceSheet: null,
  creditCards: null,
  bankAccounts: null,
  wallets: null,
  pensionAccounts: null,
  goals: null,
  yearlyPlan: null,
  loans: null,
  vault: null,
  investments: null,
  insights: null,
  transactions: null,
  homeTotals: null,
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

    const [budgets, total, pending, hisaab, overdue, forecasts, dupScan, allAccounts, ccTotals, uncatCount, dueReminders, autoMatches, loansSummary] = await Promise.all([
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
      getDueReminders(DEFAULT_USER_ID),
      findAutoMatches(DEFAULT_USER_ID).catch(() => [] as ReminderAutoMatch[]),
      getLoansSummary(DEFAULT_USER_ID).catch(() => null),
    ]);

    const allIds = allAccounts.map((a) => a.id);
    const balances = await getComputedBalances(allIds);
    const investmentAcctIds = allAccounts.filter((a) => a.account_type === "investment").map((a) => a.id);
    const investmentProductsMap = await batchInvestmentProducts(investmentAcctIds);
    const pensionAccts = allAccounts.filter((a) => isPensionLikeAccount(a, investmentProductsMap.get(a.id)));
    for (const p of pensionAccts) {
      if (balances[p.id] === null || balances[p.id] === undefined) {
        const unseeded = await computeUnseededBalance(p.id, month);
        balances[p.id] = unseeded.closing;
      }
    }
    const activeDues = forecasts.filter((f) => f.due_date && f.status !== "rejected");

    const investmentLikeAccounts = allAccounts.filter(
      (a) => a.account_type === "investment" || a.account_type === "demat" || a.account_type === "pension",
    );
    const investmentSummary = await getInvestmentSummary(DEFAULT_USER_ID, investmentLikeAccounts, investmentProductsMap);

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
      ccExpenseTotals: ccTotals,
      computedBalanceMap: balances,
      investmentSummary,
      dueReminders,
      autoMatches,
      loansSummary,
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
    let group: FinancialAccount[];
    if (accountType === "pension") {
      const investmentAcctIds = allAccounts.filter((a) => a.account_type === "investment").map((a) => a.id);
      const investmentProductsMap = await batchInvestmentProducts(investmentAcctIds);
      group = allAccounts.filter((a) => isPensionLikeAccount(a, investmentProductsMap.get(a.id)));
    } else {
      group = allAccounts.filter((a) => a.account_type === accountType);
    }

    const summaries: AccountSummaryRow[] = await Promise.all(
      group.map(async (account) => {
        const latestActivity = staleDates[account.id];
        const autoDetectedStale = !!(
          account.last_balance_date &&
          latestActivity &&
          latestActivity > account.last_balance_date
        );
        const [summaryResult, txOut, txIn] = await Promise.all([
          getMonthBalanceSummary(account.id, month),
          getTransfersOutTotal(account.id, startDate, endDate),
          getTransfersInTotal(account.id, startDate, endDate),
        ]);
        if (summaryResult) {
          return {
            account,
            opening: summaryResult.opening_balance,
            expenses: summaryResult.expenses,
            credits: summaryResult.credits,
            transfersOut: txOut,
            transfersIn: txIn,
            current: summaryResult.closing_balance,
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
          transfersOut: txOut,
          transfersIn: txIn,
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

async function loadGoalsSection(): Promise<GoalsPreloadData | null> {
  try {
    const startMonth = getFYStartMonth();
    const fy = String(getCurrentFY(startMonth));
    const today = new Date().toISOString().split("T")[0];
    const [cockpit, fyMilestones, fyBuckets, salary, activeLoans, emiMap] = await Promise.all([
      getFinancialCockpit(DEFAULT_USER_ID, fy),
      getMilestonesForFY(DEFAULT_USER_ID, fy),
      getBucketsByFY(DEFAULT_USER_ID, fy),
      getSalaryProfileByFY(DEFAULT_USER_ID, fy),
      listActiveLoans(DEFAULT_USER_ID),
      getCurrentEMIsByLoanId(DEFAULT_USER_ID, today),
    ]);
    const totalMonthlyEMI = activeLoans.reduce((s, l) => s + (emiMap.get(l.id) ?? l.emi_amount), 0);
    return {
      cockpit,
      fyMilestones,
      fyBuckets,
      hasSalaryProfile: salary != null && salary.computed_monthly_in_hand > 0,
      activeLoansCount: activeLoans.length,
      totalMonthlyEMI,
      fy,
    };
  } catch (e) {
    logger.warn("Goals preload section failed:", e);
    return null;
  }
}

async function loadYearlyPlanSection(): Promise<YearlyPlanPreloadData | null> {
  try {
    const startMonth = getFYStartMonth();
    const fy = String(getCurrentFY(startMonth));
    const [derived, profile] = await Promise.all([
      deriveYearlyPlan(DEFAULT_USER_ID, fy),
      getSalaryProfileByFY(DEFAULT_USER_ID, fy),
    ]);
    return { fy, derived, profile };
  } catch (e) {
    logger.warn("Yearly plan preload section failed:", e);
    return null;
  }
}

async function loadLoansSection(): Promise<LoansPreloadData | null> {
  try {
    const today = new Date().toISOString().split("T")[0];
    const [all, outstandingMap, emiMap] = await Promise.all([
      listAllLoansWithBankName(DEFAULT_USER_ID),
      getLoanOutstandingsByLoanId(DEFAULT_USER_ID, today),
      getCurrentEMIsByLoanId(DEFAULT_USER_ID, today),
    ]);
    const allIds = all.map((l) => l.id);
    const scheduleMap = await getSchedulesByLoanIds(allIds);
    const loans: EnrichedLoan[] = all.map((loan) => ({
      ...loan,
      bank_name: loan.bank_name ?? "Loan",
      outstanding: outstandingMap.get(loan.id) ?? 0,
      current_emi: emiMap.get(loan.id) ?? loan.emi_amount,
      remaining_months: (scheduleMap.get(loan.id) ?? []).filter((e) => e.status === "scheduled").length,
    }));
    return { loans };
  } catch (e) {
    logger.warn("Loans preload section failed:", e);
    return null;
  }
}

async function loadVaultSection(): Promise<VaultPreloadData | null> {
  try {
    const entries = await getVaultEntries();
    return { entries };
  } catch (e) {
    logger.warn("Vault preload section failed:", e);
    return null;
  }
}

async function loadInvestmentsSection(): Promise<InvestmentsPreloadData | null> {
  try {
    const allAccounts = await getActiveAccounts(DEFAULT_USER_ID);
    const accounts = allAccounts.filter(
      (a) => a.account_type === "investment" || a.account_type === "demat" || a.account_type === "pension",
    );
    const ids = accounts.filter((a) => a.account_type === "investment").map((a) => a.id);
    const products = await batchInvestmentProducts(ids);
    const [values, maturities] = await Promise.all([
      getUnifiedInvestmentValues(DEFAULT_USER_ID, accounts, products),
      getUpcomingFDMaturities(DEFAULT_USER_ID, 5),
    ]);
    return { accounts, products, values, maturities };
  } catch (e) {
    logger.warn("Investments preload section failed:", e);
    return null;
  }
}

async function loadInsightsSection(): Promise<InsightsPreloadData | null> {
  try {
    const [totals, forecast, insights] = await Promise.all([
      getThisVsLastMonthTotals(DEFAULT_USER_ID).catch(() => ({ currentMonth: 0, previousMonth: 0 })),
      getAnalyticsForecast(DEFAULT_USER_ID).catch(() => null),
      getInsights(DEFAULT_USER_ID).catch(() => [] as Insight[]),
    ]);
    return {
      forecast,
      insights,
      thisMonthTotal: totals.currentMonth,
      lastMonthTotal: totals.previousMonth,
    };
  } catch (e) {
    logger.warn("Insights preload section failed:", e);
    return null;
  }
}

async function loadTransactionsSection(): Promise<TransactionsPreloadData | null> {
  try {
    const [categories, paymentModes, accounts, tags, merchantNames, rules, pendingCount] = await Promise.all([
      getCategories(DEFAULT_USER_ID),
      getPaymentModes(DEFAULT_USER_ID),
      getActiveAccounts(DEFAULT_USER_ID),
      getTags(DEFAULT_USER_ID),
      getDistinctMerchantNames(DEFAULT_USER_ID),
      listRules(),
      getPendingExpenseCount(DEFAULT_USER_ID),
    ]);
    return { categories, paymentModes, accounts, tags, merchantNames, rules, pendingCount };
  } catch (e) {
    logger.warn("Transactions preload section failed:", e);
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
export function preloadHomeData(): Promise<void> {
  homePreloadPromise = runPreload();
  return homePreloadPromise;
}

async function runPreload(): Promise<void> {
  const version = getDataVersion();
  const [
    home, accounts, balanceSheet, creditCards,
    bankAccounts, wallets, pensionAccounts,
    goals, yearlyPlan, loans, vault,
    investments, insights, transactions,
  ] = await Promise.all([
    loadHomeSection(),
    loadAccountsSection(),
    loadBalanceSheetSection(),
    loadCreditCardsSection(),
    loadAccountGroupSection("savings"),
    loadAccountGroupSection("wallet"),
    loadAccountGroupSection("pension"),
    loadGoalsSection(),
    loadYearlyPlanSection(),
    loadLoansSection(),
    loadVaultSection(),
    loadInvestmentsSection(),
    loadInsightsSection(),
    loadTransactionsSection(),
  ]);
  if (home) saveHomeSnapshot(home, version);
  cache.accounts = accounts;
  cache.balanceSheet = balanceSheet;
  cache.creditCards = creditCards;
  cache.bankAccounts = bankAccounts;
  cache.wallets = wallets;
  cache.pensionAccounts = pensionAccounts;
  cache.goals = goals;
  cache.yearlyPlan = yearlyPlan;
  cache.loans = loans;
  cache.vault = vault;
  cache.investments = investments;
  cache.insights = insights;
  cache.transactions = transactions;
  cache.homeTotals = home
    ? { month: getCurrentMonth(), totalBudget: home.totalBudget, totalSpent: home.totalSpent }
    : null;
}

// ---------------------------------------------------------------------------
// Home snapshot — deliberately NON-destructive and refreshed by every Home
// load. Home re-mounts after each biometric unlock (the lock screen replaces
// the tab stack), and a single-use consume left it rendering zeros/empty
// cards for ~2s while its ~13 queries re-ran. Seeding from the last known
// data renders instantly; Home still refreshes in the background.
// ---------------------------------------------------------------------------

export interface HomeSnapshot {
  data: HomePreloadData;
  /** getDataVersion() when the load STARTED — any later write makes it stale. */
  version: number;
  at: number;
}

let homeSnapshot: HomeSnapshot | null = null;
let homePreloadPromise: Promise<void> | null = null;

export function peekHomeSnapshot(): HomeSnapshot | null {
  return homeSnapshot;
}

export function saveHomeSnapshot(data: HomePreloadData, version: number): void {
  homeSnapshot = { data, version, at: Date.now() };
}

/** Resolves once the app-start preload settles (immediately if none is running). */
export async function waitForHomePreload(): Promise<void> {
  if (homePreloadPromise) await homePreloadPromise.catch(() => {});
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

/**
 * Deliberately NON-destructive, unlike every other consume* here — three
 * separate screens (app/(tabs)/goals.tsx, app/goals/investment-buckets.tsx,
 * app/goals/milestones.tsx) each call this at module level to seed their
 * initial state. Since a JS module is only evaluated once per app process,
 * whichever of the three the user opens FIRST after launch would consume
 * (and null out) the shared cache, leaving the other two to always fall
 * back to a fresh fetch — even on their very first-ever open. Not clearing
 * costs nothing here: each screen's own useFocusEffect/useDataRefresh
 * already re-fetches on every subsequent focus regardless, so this value
 * is only ever used for the first render, and only once per screen (module
 * scope), no matter how many times that screen is later revisited.
 */
export function consumeGoalsPreload(): GoalsPreloadData | null {
  return cache.goals;
}

export function consumeYearlyPlanPreload(): YearlyPlanPreloadData | null {
  const data = cache.yearlyPlan;
  cache.yearlyPlan = null;
  return data;
}

export function consumeLoansPreload(): LoansPreloadData | null {
  const data = cache.loans;
  cache.loans = null;
  return data;
}

export function consumeVaultPreload(): VaultPreloadData | null {
  const data = cache.vault;
  cache.vault = null;
  return data;
}

export function consumeInvestmentsPreload(): InvestmentsPreloadData | null {
  const data = cache.investments;
  cache.investments = null;
  return data;
}

/**
 * Non-destructive like consumeGoalsPreload — InsightsPage mounts twice
 * (Home swipe-pager page 1 AND app/insights/index.tsx), and a destructive
 * consume would only ever benefit whichever mounts first.
 */
export function consumeInsightsPreload(): InsightsPreloadData | null {
  return cache.insights;
}

export function consumeTransactionsPreload(): TransactionsPreloadData | null {
  const data = cache.transactions;
  cache.transactions = null;
  return data;
}

/**
 * Non-destructive peek at current-month budget/expense totals, computed
 * once as part of the Home section. Home's own consumeHomePreload() clears
 * cache.home first (Home is always the first tab mounted on launch), so the
 * Budget tab reads this separate, never-cleared snapshot instead of
 * re-running the same two queries for a month it's very likely to open on.
 */
export function peekHomeTotals(): { month: string; totalBudget: number; totalSpent: number } | null {
  return cache.homeTotals;
}
