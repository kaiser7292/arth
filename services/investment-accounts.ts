/**
 * Investment accounts service (docs/INVESTMENT_ACCOUNTS_PROPOSAL.md).
 *
 * Wraps DB ops for `investment_products` / `investment_schedule_entries`.
 * FD math lives in services/investment-engine.ts (pure, no DB).
 *
 * Creation flow, mirroring services/loan-accounts.ts:
 *   1. createManualAccount() creates a financial_accounts row (account_type='investment').
 *   2a. createFDAccount() creates the investment_products sibling + generates the
 *       (single-row, v1) maturity schedule — for 'contract' (FD) products.
 *   2b. createInvestmentProductForAccount() creates a bare investment_products
 *       sibling with no schedule — for 'market' (demat-style) and 'contribution'
 *       (pension-style) products, which don't need one.
 *
 * Phase 2 (docs/INVESTMENT_ACCOUNTS_PROPOSAL.md section 4): demat and pension
 * accounts are created as account_type='investment' directly via (1)+(2b) from
 * here on — see app/settings/account-add.tsx and services/sms/bank-patterns.ts.
 * convertLegacyAccountToInvestment()/migrateLegacyDematPensionAccounts() below
 * handle accounts that already exist under the old 'demat'/'pension' types.
 */

import { getDatabase } from "@/database";
import { createManualAccount, getActiveAccounts, getDematAccountsWithSummary } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import { createTransfer } from "@/services/account-transfer";
import { getComputedBalances, computeUnseededBalance } from "@/services/account-balance";
import {
  currentFDValue,
  generateFDSchedule,
  type CompoundingFreq,
  type InterestMethod,
} from "@/services/investment-engine";
import { bumpDataVersion } from "@/services/settings";
import { logger } from "@/utils/logger";
import { generateUUID } from "@/utils/uuid";
import { todayIso } from "@/utils/date";

// ─── Types ────────────────────────────────────────────────

export type InvestmentInstrument = "equity" | "mutual_fund" | "gold" | "fd" | "bond" | "epf" | "nps" | "ppf" | "other";
export type InvestmentValuation = "market" | "contract" | "contribution";
export type InvestmentProductStatus = "active" | "matured" | "closed";

/** Shared display label per instrument — used by the Investments list, the unified Home card, and the balance sheet. */
export const INSTRUMENT_LABELS: Record<InvestmentInstrument, string> = {
  fd: "Fixed deposit",
  bond: "Bond",
  equity: "Equity",
  mutual_fund: "Mutual fund",
  gold: "Gold",
  epf: "EPF",
  nps: "NPS",
  ppf: "PPF",
  other: "Investment",
};

export interface InvestmentProduct {
  id: string;
  financial_account_id: string;
  instrument: InvestmentInstrument;
  valuation: InvestmentValuation;
  principal: number | null;
  interest_rate_pa: number | null;
  interest_method: InterestMethod | null;
  compounding_freq: CompoundingFreq | null;
  start_date: string | null;
  maturity_date: string | null;
  payout_mode: "cumulative" | "periodic" | null;
  source_account_id: string | null;
  auto_credit_on_maturity: number;
  status: InvestmentProductStatus;
  created_at: string;
  updated_at: string;
}

export interface InvestmentScheduleRow {
  id: string;
  product_id: string;
  event_num: number;
  event_date: string;
  kind: "maturity" | "interest_payout";
  principal_component: number | null;
  interest_component: number | null;
  status: "scheduled" | "materialised" | "skipped";
  linked_expense_id: string | null;
  linked_transfer_id: string | null;
}

export interface CreateFDInput {
  user_id: string;
  bank_name: string;
  account_identifier: string;
  account_label?: string;
  principal: number;
  interest_rate_pa: number;
  interest_method: InterestMethod;
  compounding_freq?: CompoundingFreq;
  start_date: string;
  maturity_date: string;
  source_account_id: string;
}

// ─── Create ───────────────────────────────────────────────

export async function createFDAccount(input: CreateFDInput): Promise<string> {
  if (!(Number.isFinite(input.principal) && input.principal > 0)) {
    throw new Error("Principal must be a positive number");
  }
  if (!(Number.isFinite(input.interest_rate_pa) && input.interest_rate_pa > 0)) {
    throw new Error("Interest rate must be a positive number");
  }
  if (input.maturity_date <= input.start_date) {
    throw new Error("Maturity date must be after the start date");
  }
  if (input.interest_method === "compound" && !input.compounding_freq) {
    throw new Error("Compounding frequency is required for compound interest");
  }

  const db = getDatabase();

  const financialAccountId = await createManualAccount({
    userId: input.user_id,
    bankName: input.bank_name,
    accountType: "investment",
    accountIdentifier: input.account_identifier,
    accountLabel: input.account_label ?? `${input.bank_name} FD`,
    initialBalance: input.principal,
  });

  // Record the deposit as a real transfer, not just the last_known_balance
  // scalar createManualAccount sets. Without this the FD account has no
  // ledger entry establishing its balance — the standard balance-chain
  // (which account-ledger.tsx always uses, same as savings/wallet) would
  // compute it as unseeded-from-zero and go negative the moment the maturity
  // transfer moves principal back out. This transfer plus the maturity
  // transfer is exactly what a real FD deposit/payout looks like anyway.
  await createTransfer({
    userId: input.user_id,
    fromAccountId: input.source_account_id,
    toAccountId: financialAccountId,
    amount: input.principal,
    description: `${input.bank_name} FD — deposit`,
    date: input.start_date,
    source: "manual",
  });

  const productId = generateUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO investment_products (
      id, financial_account_id, instrument, valuation,
      principal, interest_rate_pa, interest_method, compounding_freq,
      start_date, maturity_date, payout_mode, source_account_id,
      auto_credit_on_maturity, status, created_at, updated_at
    ) VALUES (?, ?, 'fd', 'contract', ?, ?, ?, ?, ?, ?, 'cumulative', ?, 1, 'active', ?, ?);`,
    productId,
    financialAccountId,
    input.principal,
    input.interest_rate_pa,
    input.interest_method,
    input.compounding_freq ?? null,
    input.start_date,
    input.maturity_date,
    input.source_account_id,
    now,
    now,
  );

  const schedule = generateFDSchedule({
    principal: input.principal,
    interest_rate_pa: input.interest_rate_pa,
    start_date: input.start_date,
    maturity_date: input.maturity_date,
    interest_method: input.interest_method,
    compounding_freq: input.compounding_freq,
  });
  for (const entry of schedule) {
    await db.runAsync(
      `INSERT INTO investment_schedule_entries (
        id, product_id, event_num, event_date, kind,
        principal_component, interest_component, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled');`,
      entry.id,
      productId,
      entry.event_num,
      entry.event_date,
      entry.kind,
      entry.principal_component,
      entry.interest_component,
    );
  }

  bumpDataVersion();
  return financialAccountId;
}

/**
 * Creates a bare investment_products row with no schedule, for 'market'
 * (demat-style) or 'contribution' (pension-style) products — those value
 * themselves from snapshots or the standard balance chain respectively, not
 * a generated schedule. Used when creating a brand-new demat/pension-flavoured
 * investment account (see app/settings/account-add.tsx,
 * services/sms/bank-patterns.ts) — for converting an EXISTING legacy
 * 'demat'/'pension' account, use convertLegacyAccountToInvestment() instead,
 * which also flips account_type.
 */
export async function createInvestmentProductForAccount(
  financialAccountId: string,
  instrument: InvestmentInstrument,
  valuation: InvestmentValuation,
): Promise<string> {
  const db = getDatabase();
  const productId = generateUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO investment_products (id, financial_account_id, instrument, valuation, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?);`,
    productId,
    financialAccountId,
    instrument,
    valuation,
    now,
    now,
  );
  bumpDataVersion();
  return productId;
}

// ─── Read ─────────────────────────────────────────────────

/**
 * Batch-fetch investment_products for a set of investment-type financial
 * accounts, keyed by financial_account_id. Shared by every call site that
 * needs to tell a 'market' (demat-aliased) or 'contribution' (pension-aliased)
 * investment account apart from an FD — see isDematLikeAccount/isPensionLikeAccount.
 */
export async function batchInvestmentProducts(accountIds: string[]): Promise<Map<string, InvestmentProduct>> {
  const result = new Map<string, InvestmentProduct>();
  if (accountIds.length === 0) return result;
  const db = getDatabase();
  const placeholders = accountIds.map(() => "?").join(",");
  const rows = await db.getAllAsync<InvestmentProduct>(
    `SELECT * FROM investment_products WHERE financial_account_id IN (${placeholders});`,
    ...accountIds,
  );
  for (const r of rows) result.set(r.financial_account_id, r);
  return result;
}

/**
 * Is this account "demat-like" — either the legacy account_type='demat', or
 * a Phase-2-converted account_type='investment' with valuation='market'?
 * Every place that used to check `account_type === "demat"` should use this
 * instead so it keeps recognising the same accounts across the conversion.
 */
export function isDematLikeAccount(account: { account_type: string }, product?: InvestmentProduct | null): boolean {
  return account.account_type === "demat" || (account.account_type === "investment" && product?.valuation === "market");
}

/**
 * Is this account "pension-like" — either the legacy account_type='pension',
 * or a Phase-2-converted account_type='investment' with valuation='contribution'?
 */
export function isPensionLikeAccount(account: { account_type: string }, product?: InvestmentProduct | null): boolean {
  return account.account_type === "pension" || (account.account_type === "investment" && product?.valuation === "contribution");
}

/**
 * Single-account async convenience wrappers for isDematLikeAccount/
 * isPensionLikeAccount, for call sites checking one account at a time (e.g. a
 * transfer's from/to account) where batching isn't worth the ceremony.
 */
export async function isDematLikeAccountById(account: { id: string; account_type: string }): Promise<boolean> {
  if (account.account_type !== "investment") return isDematLikeAccount(account);
  return isDematLikeAccount(account, await getInvestmentProduct(account.id));
}

export async function isPensionLikeAccountById(account: { id: string; account_type: string }): Promise<boolean> {
  if (account.account_type !== "investment") return isPensionLikeAccount(account);
  return isPensionLikeAccount(account, await getInvestmentProduct(account.id));
}

/**
 * getActiveAccounts() plus each account's investment_products row (null for
 * non-investment types). The common starting point for any screen that needs
 * to tell demat-like/pension-like/FD accounts apart post-Phase-2.
 */
export async function getActiveAccountsWithProducts(
  userId: string,
): Promise<{ account: FinancialAccount; product: InvestmentProduct | null }[]> {
  const accounts = await getActiveAccounts(userId);
  const investmentIds = accounts.filter((a) => a.account_type === "investment").map((a) => a.id);
  const products = await batchInvestmentProducts(investmentIds);
  return accounts.map((account) => ({ account, product: products.get(account.id) ?? null }));
}

export async function getInvestmentProduct(financialAccountId: string): Promise<InvestmentProduct | null> {
  const db = getDatabase();
  return db.getFirstAsync<InvestmentProduct>(
    "SELECT * FROM investment_products WHERE financial_account_id = ?;",
    financialAccountId,
  );
}

export async function listActiveInvestmentProducts(userId: string): Promise<InvestmentProduct[]> {
  const db = getDatabase();
  return db.getAllAsync<InvestmentProduct>(
    `SELECT ip.* FROM investment_products ip
     JOIN financial_accounts fa ON fa.id = ip.financial_account_id
     WHERE fa.user_id = ? AND fa.is_active = 1
     ORDER BY ip.created_at DESC;`,
    userId,
  );
}

export async function getScheduleForProduct(productId: string): Promise<InvestmentScheduleRow[]> {
  const db = getDatabase();
  return db.getAllAsync<InvestmentScheduleRow>(
    "SELECT * FROM investment_schedule_entries WHERE product_id = ? ORDER BY event_num ASC;",
    productId,
  );
}

// ─── Legacy demat/pension conversion (Phase 2) ─────────────

/**
 * Converts one existing `demat` or `pension` account to `account_type='investment'`
 * and creates its `investment_products` sibling row. Idempotent — a no-op if the
 * account already has a product row.
 *
 * Deliberately does NOT reuse services/financial-account.ts's updateAccountType:
 * that function clears `fund_balance`/`account_number` for any type other than
 * 'demat', which would destroy a demat account's idle-cash balance and account
 * number on this exact conversion. Those fields stay meaningful for a
 * 'market'-valuation investment account (the demat snapshot screens key on
 * account_id only, not account_type — see docs/INVESTMENT_ACCOUNTS_PROPOSAL.md
 * section 4), so this leaves them untouched.
 */
export async function convertLegacyAccountToInvestment(
  accountId: string,
  instrument: InvestmentInstrument,
  valuation: InvestmentValuation,
): Promise<void> {
  const db = getDatabase();
  let converted = false;
  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM investment_products WHERE financial_account_id = ?;",
      accountId,
    );
    if (existing) return;

    await db.runAsync(
      `UPDATE financial_accounts SET account_type = 'investment', updated_at = datetime('now') WHERE id = ?;`,
      accountId,
    );

    const productId = generateUUID();
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO investment_products (id, financial_account_id, instrument, valuation, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?);`,
      productId,
      accountId,
      instrument,
      valuation,
      now,
      now,
    );
    converted = true;
  });
  if (converted) await bumpDataVersion();
}

/**
 * Idempotent on-app-open catch-up pass: converts every remaining `demat`/`pension`
 * account for the user. Needed for two cases, not just the initial one-time
 * migration — (a) EPFO SMS auto-discovery and the manual add-account flow are
 * being updated to create 'investment' accounts directly, but a backup taken
 * before this shipped can still reintroduce legacy-typed rows on restore
 * (see the "migration ordering caveat" in .context/), and (b) belt-and-braces
 * alongside the explicit repair step in services/backup.ts's restore path.
 *
 * All existing pension accounts convert to instrument='epf' — EPFO is the only
 * bank pattern that has ever created a pension account (services/sms/bank-patterns.ts),
 * so there's no real NPS/PPF data to misclassify. Demat accounts convert to
 * instrument='equity' — the generic "brokerage holding" instrument; the
 * portfolio/fund snapshot screens don't distinguish equity from mutual funds
 * today either, so this doesn't lose any information.
 */
export async function migrateLegacyDematPensionAccounts(userId: string): Promise<number> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ id: string; account_type: string }>(
    `SELECT id, account_type FROM financial_accounts WHERE user_id = ? AND account_type IN ('demat', 'pension');`,
    userId,
  );
  let migrated = 0;
  for (const row of rows) {
    try {
      if (row.account_type === "demat") {
        await convertLegacyAccountToInvestment(row.id, "equity", "market");
      } else {
        await convertLegacyAccountToInvestment(row.id, "epf", "contribution");
      }
      migrated++;
    } catch (e) {
      logger.warn(`Failed to convert legacy account ${row.id} (non-fatal):`, e);
    }
  }
  return migrated;
}

/**
 * Current value for a 'contract' product. 'market' and 'contribution'
 * products don't go through this — they use the demat snapshot and standard
 * balance-chain paths respectively.
 *
 * Note this deliberately returns 0 once matured, not the maturity value —
 * materialisation moves the principal out via a real transfer (see
 * createFDAccount's initial deposit transfer, mirrored at maturity) and
 * credits interest to a different account, so the FD account's own balance
 * genuinely goes to zero. This function exists mainly as a cheap, chain-free
 * read for display; the balance-sheet/ledger truth comes from the standard
 * transfer-based chain, which agrees with it at every point.
 */
export function getContractCurrentValue(product: InvestmentProduct): number {
  if (product.valuation !== "contract" || product.principal == null) return 0;
  return currentFDValue(product.principal, product.status);
}

function currentMonthStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Current value for every account in `accounts`, dispatched by valuation
 * strategy — the fix for a real bug in the pre-Phase-3 /investments screen,
 * which called getContractCurrentValue (FD-only math) on every product
 * regardless of valuation, producing wrong values (0/NaN) for converted
 * demat/pension accounts once they started sharing investment_products rows.
 *
 * - 'market' (demat-like): latest portfolio + fund snapshot, same source as
 *   the demat-portfolio screen.
 * - 'contribution' (pension-like): standard balance chain, falling back to
 *   computeUnseededBalance when the account has no seeded opening balance.
 * - 'contract' (FD): getContractCurrentValue.
 *
 * Accounts with no product (should not happen post-Phase-2, but a legacy
 * demat/pension row can transiently lack one) or an unrecognised valuation
 * are simply absent from the result map.
 */
export async function getUnifiedInvestmentValues(
  userId: string,
  accounts: { id: string; account_type: string }[],
  products: Map<string, InvestmentProduct>,
): Promise<Map<string, number>> {
  const values = new Map<string, number>();

  const dematSummaries = await getDematAccountsWithSummary(userId);
  for (const s of dematSummaries) {
    values.set(s.account.id, (s.latestPortfolioValue ?? 0) + s.latestFundValue);
  }

  const pensionIds = accounts
    .filter((a) => isPensionLikeAccount(a, products.get(a.id)))
    .map((a) => a.id);
  if (pensionIds.length > 0) {
    const balances = await getComputedBalances(pensionIds);
    const month = currentMonthStr();
    for (const id of pensionIds) {
      const balance = balances[id];
      if (balance != null) {
        values.set(id, balance);
      } else {
        const unseeded = await computeUnseededBalance(id, month);
        values.set(id, unseeded.closing);
      }
    }
  }

  for (const a of accounts) {
    const product = products.get(a.id);
    if (product?.valuation === "contract") {
      values.set(a.id, getContractCurrentValue(product));
    }
  }

  return values;
}

export interface InvestmentInstrumentBreakdown {
  label: string;
  value: number;
}

export interface InvestmentSummary {
  totalValue: number;
  accountCount: number;
  breakdown: InvestmentInstrumentBreakdown[];
}

/**
 * Total value + a per-instrument breakdown (e.g. "Equity 3.16L · EPF 8.42L ·
 * FD 48K") across every demat/pension/FD account — the data behind the
 * unified Home Investments card and its equivalent in home-preload.ts.
 * `accounts` should already be filtered to demat/pension/investment-typed
 * rows; pass `getActiveAccounts()`'s result filtered accordingly.
 */
export async function getInvestmentSummary(
  userId: string,
  accounts: { id: string; account_type: string }[],
  products: Map<string, InvestmentProduct>,
): Promise<InvestmentSummary> {
  const values = await getUnifiedInvestmentValues(userId, accounts, products);

  const breakdownMap = new Map<string, number>();
  for (const a of accounts) {
    const product = products.get(a.id);
    const instrument: InvestmentInstrument =
      product?.instrument ?? (a.account_type === "demat" ? "equity" : a.account_type === "pension" ? "epf" : "other");
    const value = values.get(a.id) ?? 0;
    breakdownMap.set(instrument, (breakdownMap.get(instrument) ?? 0) + value);
  }

  const breakdown = Array.from(breakdownMap.entries())
    .filter(([, value]) => value !== 0)
    .sort((a, b) => b[1] - a[1])
    .map(([instrument, value]) => ({ label: INSTRUMENT_LABELS[instrument as InvestmentInstrument] ?? instrument, value }));

  let totalValue = 0;
  for (const v of values.values()) totalValue += v;

  return { totalValue, accountCount: accounts.length, breakdown };
}

// ─── Maturity materialisation ─────────────────────────────

/**
 * Idempotent on-app-open catch-up pass (docs/INVESTMENT_ACCOUNTS_PROPOSAL.md
 * section 8). Materialises every 'scheduled' entry with event_date <= today:
 * principal moves via an account_transfers row (deterministic, not
 * reviewable), interest lands as a nature='credit' expense at
 * status='pending_review' (the one thing that's actually uncertain — TDS and
 * rounding mean the bank's credited interest rarely matches the computed
 * figure). Only ever touches 'scheduled' rows, so running it twice is a
 * no-op the second time.
 */
export async function materialiseMaturedInvestments(userId: string): Promise<number> {
  const db = getDatabase();
  const today = todayIso();
  let materialised = 0;

  const due = await db.getAllAsync<{
    schedule_id: string;
    product_id: string;
    event_date: string;
    kind: string;
    principal_component: number | null;
    interest_component: number | null;
    financial_account_id: string;
    source_account_id: string | null;
    bank_name: string;
  }>(
    `SELECT se.id as schedule_id, se.product_id, se.event_date, se.kind,
            se.principal_component, se.interest_component,
            ip.financial_account_id, ip.source_account_id, fa.bank_name
     FROM investment_schedule_entries se
     JOIN investment_products ip ON ip.id = se.product_id
     JOIN financial_accounts fa ON fa.id = ip.financial_account_id
     WHERE fa.user_id = ? AND fa.is_active = 1
       AND se.status = 'scheduled' AND se.event_date <= ?;`,
    userId,
    today,
  );

  for (const entry of due) {
    try {
      if (!entry.source_account_id) {
        logger.warn(`Investment schedule entry ${entry.schedule_id} has no source account — skipping`);
        continue;
      }

      let transferId: string | null = null;
      if (entry.principal_component && entry.principal_component > 0) {
        transferId = await createTransfer({
          userId,
          fromAccountId: entry.financial_account_id,
          toAccountId: entry.source_account_id,
          amount: entry.principal_component,
          description: `${entry.bank_name} FD maturity — principal`,
          date: entry.event_date,
          source: "manual",
        });
      }

      let expenseId: string | null = null;
      if (entry.interest_component && entry.interest_component > 0) {
        expenseId = generateUUID();
        const now = new Date().toISOString();
        await db.runAsync(
          `INSERT INTO expenses (id, user_id, amount, currency, description, account_id, date, nature, source, status, created_at)
           VALUES (?, ?, ?, 'INR', ?, ?, ?, 'credit', 'manual', 'pending_review', ?);`,
          expenseId,
          userId,
          entry.interest_component,
          `${entry.bank_name} FD maturity — interest`,
          entry.source_account_id,
          entry.event_date,
          now,
        );
      }

      await db.runAsync(
        `UPDATE investment_schedule_entries
         SET status = 'materialised', linked_expense_id = ?, linked_transfer_id = ?
         WHERE id = ?;`,
        expenseId,
        transferId,
        entry.schedule_id,
      );

      if (entry.kind === "maturity") {
        await db.runAsync(
          `UPDATE investment_products SET status = 'matured', updated_at = datetime('now') WHERE id = ?;`,
          entry.product_id,
        );
      }

      materialised++;
    } catch (e) {
      logger.warn(`Failed to materialise investment schedule entry ${entry.schedule_id} (non-fatal):`, e);
    }
  }

  if (materialised > 0) bumpDataVersion();
  return materialised;
}
