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
import { createInvestmentContribution, deleteInvestmentContribution } from "@/services/yearly-plan";
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
  /** v3.6 — links this FD's deposit to a yearly-plan investment bucket, mirroring account_transfers' demat linking (migration 011). */
  investment_bucket_id: string | null;
  linked_contribution_id: string | null;
  /** v3.6 — user-corrected maturity amount, overriding the computed value when the bank's actual payout (TDS/rounding) differs. */
  maturity_amount_override: number | null;
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

interface FDDetails {
  interest_rate_pa?: number;
  interest_method?: InterestMethod;
  compounding_freq?: CompoundingFreq;
  maturity_date?: string;
}

/**
 * Shared by createFDAccount and createFDAccountShell: inserts the
 * investment_products row and, only when both interest_rate_pa and
 * maturity_date are present, generates and inserts the maturity schedule.
 * Does not touch financial_accounts or account_transfers — callers handle
 * those separately, since the shell path (Mark as Fixed Deposit) supplies the
 * deposit via reclassifyExpenseAsTransfer instead of a fresh transfer.
 */
async function insertFDProductAndSchedule(
  financialAccountId: string,
  principal: number,
  startDate: string,
  sourceAccountId: string,
  details: FDDetails,
): Promise<string> {
  const db = getDatabase();
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
    principal,
    details.interest_rate_pa ?? null,
    details.interest_method ?? null,
    details.compounding_freq ?? null,
    startDate,
    details.maturity_date ?? null,
    sourceAccountId,
    now,
    now,
  );

  if (details.interest_rate_pa != null && details.maturity_date != null) {
    const schedule = generateFDSchedule({
      principal,
      interest_rate_pa: details.interest_rate_pa,
      start_date: startDate,
      maturity_date: details.maturity_date,
      interest_method: details.interest_method!,
      compounding_freq: details.compounding_freq,
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
  }

  return productId;
}

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

  await insertFDProductAndSchedule(financialAccountId, input.principal, input.start_date, input.source_account_id, {
    interest_rate_pa: input.interest_rate_pa,
    interest_method: input.interest_method,
    compounding_freq: input.compounding_freq,
    maturity_date: input.maturity_date,
  });

  bumpDataVersion();
  return financialAccountId;
}

export interface CreateFDShellInput {
  user_id: string;
  bank_name: string;
  account_identifier: string;
  account_label?: string;
  principal: number;
  start_date: string;
  source_account_id: string;
  interest_rate_pa?: number;
  interest_method?: InterestMethod;
  compounding_freq?: CompoundingFreq;
  maturity_date?: string;
}

/**
 * Creates an FD account + investment_products row WITHOUT recording the
 * initial deposit as a transfer — for the "Mark as Fixed Deposit" quick-create
 * path (app/expense/[id].tsx), where an SMS-detected debit expense already
 * exists and becomes the deposit via reclassifyExpenseAsTransfer
 * (services/account-transfer.ts) right after this call, instead of a second,
 * duplicate transfer.
 *
 * Unlike createFDAccount, interest_rate_pa/maturity_date are optional here —
 * an SMS debit alert rarely carries them. Provide both or neither (a partial
 * pair is rejected as ambiguous); if omitted, the product has no schedule and
 * currentFDValue reads as the plain principal until completeFDDetails fills
 * them in later.
 */
export async function createFDAccountShell(input: CreateFDShellInput): Promise<string> {
  if (!(Number.isFinite(input.principal) && input.principal > 0)) {
    throw new Error("Principal must be a positive number");
  }
  const hasRate = input.interest_rate_pa != null;
  const hasMaturity = input.maturity_date != null;
  if (hasRate !== hasMaturity) {
    throw new Error("Provide both interest rate and maturity date, or leave both blank");
  }
  if (hasRate && !(input.interest_rate_pa! > 0)) {
    throw new Error("Interest rate must be a positive number");
  }
  if (hasMaturity && input.maturity_date! <= input.start_date) {
    throw new Error("Maturity date must be after the start date");
  }
  if (hasRate && input.interest_method === "compound" && !input.compounding_freq) {
    throw new Error("Compounding frequency is required for compound interest");
  }

  const financialAccountId = await createManualAccount({
    userId: input.user_id,
    bankName: input.bank_name,
    accountType: "investment",
    accountIdentifier: input.account_identifier,
    accountLabel: input.account_label ?? `${input.bank_name} FD`,
    initialBalance: input.principal,
  });

  await insertFDProductAndSchedule(financialAccountId, input.principal, input.start_date, input.source_account_id, {
    interest_rate_pa: input.interest_rate_pa,
    interest_method: input.interest_method,
    compounding_freq: input.compounding_freq,
    maturity_date: input.maturity_date,
  });

  bumpDataVersion();
  return financialAccountId;
}

/**
 * Fills in the interest rate/method/maturity of an FD created without them
 * (createFDAccountShell) and generates its schedule — a no-op-safe one-shot:
 * refuses if the schedule already exists (i.e. this was already completed).
 */
export async function completeFDDetails(
  financialAccountId: string,
  details: {
    interest_rate_pa: number;
    interest_method: InterestMethod;
    compounding_freq?: CompoundingFreq;
    maturity_date: string;
  },
): Promise<void> {
  const db = getDatabase();
  const product = await getInvestmentProduct(financialAccountId);
  if (!product || product.valuation !== "contract") {
    throw new Error("This account is not a fixed deposit");
  }
  if (product.principal == null || !product.start_date) {
    throw new Error("This fixed deposit has no principal or start date recorded");
  }
  if (!(details.interest_rate_pa > 0)) {
    throw new Error("Interest rate must be a positive number");
  }
  if (details.maturity_date <= product.start_date) {
    throw new Error("Maturity date must be after the start date");
  }
  if (details.interest_method === "compound" && !details.compounding_freq) {
    throw new Error("Compounding frequency is required for compound interest");
  }

  const existingSchedule = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM investment_schedule_entries WHERE product_id = ? LIMIT 1;",
    product.id,
  );
  if (existingSchedule) {
    throw new Error("This fixed deposit's schedule has already been generated");
  }

  await db.runAsync(
    `UPDATE investment_products
     SET interest_rate_pa = ?, interest_method = ?, compounding_freq = ?, maturity_date = ?, updated_at = datetime('now')
     WHERE id = ?;`,
    details.interest_rate_pa,
    details.interest_method,
    details.compounding_freq ?? null,
    details.maturity_date,
    product.id,
  );

  const schedule = generateFDSchedule({
    principal: product.principal,
    interest_rate_pa: details.interest_rate_pa,
    start_date: product.start_date,
    maturity_date: details.maturity_date,
    interest_method: details.interest_method,
    compounding_freq: details.compounding_freq,
  });
  for (const entry of schedule) {
    await db.runAsync(
      `INSERT INTO investment_schedule_entries (
        id, product_id, event_num, event_date, kind,
        principal_component, interest_component, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled');`,
      entry.id,
      product.id,
      entry.event_num,
      entry.event_date,
      entry.kind,
      entry.principal_component,
      entry.interest_component,
    );
  }

  bumpDataVersion();
}

/** True when an FD account was created via createFDAccountShell without rate/maturity and hasn't been completed yet. */
export function isFDIncomplete(product: InvestmentProduct): boolean {
  return product.valuation === "contract" && (product.interest_rate_pa == null || product.maturity_date == null);
}

/**
 * True when an FD's schedule can still be safely edited — i.e. no schedule
 * entry has been materialised yet (money hasn't actually moved). Once any
 * entry is materialised, changing rate/maturity would desync the FD account's
 * real transfer history from a freshly regenerated schedule.
 */
export async function isFDEditable(productId: string): Promise<boolean> {
  const db = getDatabase();
  const materialised = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM investment_schedule_entries WHERE product_id = ? AND status = 'materialised' LIMIT 1;",
    productId,
  );
  return !materialised;
}

/**
 * Edits an existing FD's rate/method/compounding/maturity and regenerates its
 * schedule — for FDs already completed (unlike completeFDDetails, which is a
 * one-shot first-fill for a shell). Refuses once any schedule entry has
 * materialised (see isFDEditable) since regenerating at that point would
 * contradict money that has already moved.
 */
export async function updateFDDetails(
  financialAccountId: string,
  details: {
    interest_rate_pa: number;
    interest_method: InterestMethod;
    compounding_freq?: CompoundingFreq;
    maturity_date: string;
  },
): Promise<void> {
  const db = getDatabase();
  const product = await getInvestmentProduct(financialAccountId);
  if (!product || product.valuation !== "contract") {
    throw new Error("This account is not a fixed deposit");
  }
  if (product.principal == null || !product.start_date) {
    throw new Error("This fixed deposit has no principal or start date recorded");
  }
  if (!(await isFDEditable(product.id))) {
    throw new Error("This fixed deposit has already matured and can't be edited");
  }
  if (!(details.interest_rate_pa > 0)) {
    throw new Error("Interest rate must be a positive number");
  }
  if (details.maturity_date <= product.start_date) {
    throw new Error("Maturity date must be after the start date");
  }
  if (details.interest_method === "compound" && !details.compounding_freq) {
    throw new Error("Compounding frequency is required for compound interest");
  }

  await db.runAsync(
    `UPDATE investment_products
     SET interest_rate_pa = ?, interest_method = ?, compounding_freq = ?, maturity_date = ?, updated_at = datetime('now')
     WHERE id = ?;`,
    details.interest_rate_pa,
    details.interest_method,
    details.compounding_freq ?? null,
    details.maturity_date,
    product.id,
  );

  // Drop the previous (never-materialised) schedule and regenerate it —
  // safe because isFDEditable already confirmed nothing has materialised.
  await db.runAsync("DELETE FROM investment_schedule_entries WHERE product_id = ?;", product.id);

  const schedule = generateFDSchedule({
    principal: product.principal,
    interest_rate_pa: details.interest_rate_pa,
    start_date: product.start_date,
    maturity_date: details.maturity_date,
    interest_method: details.interest_method,
    compounding_freq: details.compounding_freq,
  });
  for (const entry of schedule) {
    await db.runAsync(
      `INSERT INTO investment_schedule_entries (
        id, product_id, event_num, event_date, kind,
        principal_component, interest_component, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled');`,
      entry.id,
      product.id,
      entry.event_num,
      entry.event_date,
      entry.kind,
      entry.principal_component,
      entry.interest_component,
    );
  }

  bumpDataVersion();
}

/**
 * Sets (or clears, with null) a manual correction to the FD's maturity
 * amount — used when the bank's actual payout (TDS, rounding) differs from
 * the computed schedule. Doesn't touch investment_schedule_entries; the
 * override is applied at materialisation time (materialiseMaturedInvestments)
 * so the originally computed figures stay visible for comparison.
 */
export async function setFDMaturityOverride(financialAccountId: string, overrideAmount: number | null): Promise<void> {
  const db = getDatabase();
  const product = await getInvestmentProduct(financialAccountId);
  if (!product || product.valuation !== "contract") {
    throw new Error("This account is not a fixed deposit");
  }
  if (overrideAmount != null && !(overrideAmount > 0)) {
    throw new Error("Corrected maturity amount must be a positive number");
  }
  await db.runAsync(
    `UPDATE investment_products SET maturity_amount_override = ?, updated_at = datetime('now') WHERE id = ?;`,
    overrideAmount,
    product.id,
  );
  bumpDataVersion();
}

/**
 * Links an FD's deposit to a yearly-plan investment bucket, the same way a
 * demat transfer optionally does (services/demat-transfer.ts) — the deposit
 * amount counts toward the bucket's current_contributed as of the FD's start
 * date. Reversed automatically at maturity (materialiseMaturedInvestments
 * records a matching withdrawal) or explicitly via unlinkFDFromBucket.
 */
export async function linkFDToBucket(financialAccountId: string, bucketId: string): Promise<void> {
  const product = await getInvestmentProduct(financialAccountId);
  if (!product || product.valuation !== "contract") {
    throw new Error("This account is not a fixed deposit");
  }
  if (product.principal == null || !product.start_date) {
    throw new Error("This fixed deposit has no principal or start date recorded");
  }
  if (product.investment_bucket_id) {
    throw new Error("This fixed deposit is already linked to a bucket");
  }

  const contributionId = await createInvestmentContribution({
    investment_bucket_id: bucketId,
    month: product.start_date.slice(0, 7),
    amount: product.principal,
    date: product.start_date,
    notes: "Auto from Fixed Deposit",
  });

  const db = getDatabase();
  await db.runAsync(
    `UPDATE investment_products SET investment_bucket_id = ?, linked_contribution_id = ?, updated_at = datetime('now') WHERE id = ?;`,
    bucketId,
    contributionId,
    product.id,
  );
  bumpDataVersion();
}

/** Reverses linkFDToBucket — deletes the contribution and clears the stamp. */
export async function unlinkFDFromBucket(financialAccountId: string): Promise<void> {
  const product = await getInvestmentProduct(financialAccountId);
  if (!product || !product.investment_bucket_id) return;

  if (product.linked_contribution_id) {
    await deleteInvestmentContribution(product.linked_contribution_id, product.investment_bucket_id);
  }

  const db = getDatabase();
  await db.runAsync(
    `UPDATE investment_products SET investment_bucket_id = NULL, linked_contribution_id = NULL, updated_at = datetime('now') WHERE id = ?;`,
    product.id,
  );
  bumpDataVersion();
}

/**
 * Reverses "Mark as Fixed Deposit" entirely — the FD-specific counterpart to
 * services/account-transfer.ts's undoTransfer. The caller is responsible for
 * calling undoTransfer() on the deposit transfer FIRST (restores the original
 * expense); this then cleans up everything Mark-as-FD created on top of that
 * transfer: any bucket link, the schedule, the investment_products row, and
 * finally deactivates the shell financial_accounts row it created — mirroring
 * how "Remove account" elsewhere in the app deactivates rather than
 * hard-deletes, so it stays recoverable rather than vanishing outright.
 *
 * Refused once any schedule entry has materialised (isFDEditable) — at that
 * point real money has moved via a second, separate transfer, and un-doing
 * the original deposit would leave that maturity transfer dangling.
 */
export async function undoMarkAsFD(financialAccountId: string): Promise<void> {
  const db = getDatabase();
  const product = await getInvestmentProduct(financialAccountId);
  if (!product || product.valuation !== "contract") {
    throw new Error("This account is not a fixed deposit");
  }
  if (!(await isFDEditable(product.id))) {
    throw new Error("This fixed deposit has already matured and can't be undone");
  }
  if (product.investment_bucket_id) {
    await unlinkFDFromBucket(financialAccountId);
  }
  // A maturity credit the app queued (and the user hasn't approved yet)
  // would be left pointing at nothing — remove it with the schedule.
  await db.runAsync(
    `UPDATE expenses SET deleted_at = datetime('now')
     WHERE status = 'pending_review' AND source = 'manual'
       AND id IN (SELECT linked_expense_id FROM investment_schedule_entries
                  WHERE product_id = ? AND status = 'scheduled' AND linked_expense_id IS NOT NULL);`,
    product.id,
  );
  await db.runAsync("DELETE FROM investment_schedule_entries WHERE product_id = ?;", product.id);
  await db.runAsync("DELETE FROM investment_products WHERE id = ?;", product.id);
  await db.runAsync(
    `UPDATE financial_accounts SET is_active = 0, updated_at = datetime('now') WHERE id = ?;`,
    financialAccountId,
  );
  bumpDataVersion();
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
 * Single-account async convenience wrapper for isDematLikeAccount, for call
 * sites checking one account at a time (e.g. a transfer's from/to account)
 * where batching isn't worth the ceremony.
 */
export async function isDematLikeAccountById(account: { id: string; account_type: string }): Promise<boolean> {
  if (account.account_type !== "investment") return isDematLikeAccount(account);
  return isDematLikeAccount(account, await getInvestmentProduct(account.id));
}

export async function getInvestmentProduct(financialAccountId: string): Promise<InvestmentProduct | null> {
  const db = getDatabase();
  return db.getFirstAsync<InvestmentProduct>(
    "SELECT * FROM investment_products WHERE financial_account_id = ?;",
    financialAccountId,
  );
}

export interface UpcomingFDMaturity {
  financialAccountId: string;
  label: string;
  maturityDate: string;
  /** The corrected amount when set (setFDMaturityOverride), else the computed schedule figure. */
  maturityAmount: number;
  /** Interest only — maturityAmount minus principal, override-aware. Feeds the "total interest earned" summary. */
  interestAmount: number;
}

/**
 * The next `limit` FD maturities still scheduled (not yet materialised) for
 * this user, soonest first — feeds the "Upcoming maturities" card on
 * /investments. No maturity-timeline visibility existed anywhere before this;
 * an FD's date only ever showed up buried in its own account-detail screen.
 */
export async function getUpcomingFDMaturities(userId: string, limit = 5): Promise<UpcomingFDMaturity[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{
    financial_account_id: string;
    account_label: string | null;
    bank_name: string;
    account_identifier: string;
    event_date: string;
    principal_component: number | null;
    interest_component: number | null;
    maturity_amount_override: number | null;
  }>(
    `SELECT ip.financial_account_id, fa.account_label, fa.bank_name, fa.account_identifier,
            se.event_date, se.principal_component, se.interest_component, ip.maturity_amount_override
     FROM investment_schedule_entries se
     JOIN investment_products ip ON ip.id = se.product_id
     JOIN financial_accounts fa ON fa.id = ip.financial_account_id
     WHERE fa.user_id = ? AND fa.is_active = 1
       AND se.kind = 'maturity' AND se.status = 'scheduled'
     ORDER BY se.event_date ASC
     LIMIT ?;`,
    userId,
    limit,
  );
  return rows.map((r) => {
    const principal = r.principal_component ?? 0;
    const maturityAmount = r.maturity_amount_override ?? principal + (r.interest_component ?? 0);
    return {
      financialAccountId: r.financial_account_id,
      label: r.account_label ?? `${r.bank_name} ••${r.account_identifier}`,
      maturityDate: r.event_date,
      maturityAmount,
      interestAmount: Math.round((maturityAmount - principal) * 100) / 100,
    };
  });
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
/**
 * True for an investment that's finished - its account is closed, or its product has matured or
 * been closed (e.g. an FD whose payout was credited). These aren't shown on the Investments
 * screen and don't count toward the Investments total.
 */
export function isFinishedInvestment(
  account: { id: string; closed_at?: string | null },
  product?: InvestmentProduct | null,
): boolean {
  return account.closed_at != null || product?.status === "matured" || product?.status === "closed";
}

/** Drop finished investments (see isFinishedInvestment). */
export function withoutFinishedInvestments<T extends { id: string; closed_at?: string | null }>(
  accounts: T[],
  products: Map<string, InvestmentProduct>,
): T[] {
  return accounts.filter((a) => !isFinishedInvestment(a, products.get(a.id)));
}

export async function getInvestmentSummary(
  userId: string,
  allAccounts: { id: string; account_type: string; closed_at?: string | null }[],
  products: Map<string, InvestmentProduct>,
): Promise<InvestmentSummary> {
  // A matured / closed FD's money is back in the bank - don't count it twice.
  const accounts = withoutFinishedInvestments(allAccounts, products);
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
 * section 8). For every 'scheduled' entry with event_date <= today, queues
 * ONE nature='credit' expense for the full payout (principal + interest,
 * override-aware) on the source account at status='pending_review'. Nothing
 * moves automatically — the entry stays 'scheduled' with linked_expense_id
 * set, and approving that credit finalises it (finaliseFDMaturityForExpenses:
 * product → matured, FD account closed).
 *
 * If the bank's own maturity-credit SMS already landed on the source account
 * (amount within ±0.5%, dated around the maturity date), that credit is
 * linked instead of creating a duplicate. Entries with a linked_expense_id
 * are skipped, so running the pass twice is a no-op.
 */
export async function materialiseMaturedInvestments(userId: string): Promise<number> {
  const db = getDatabase();
  const today = todayIso();
  // Match real payout credits first (single, or principal + interest, from the bank's SMS) and
  // close FDs whose payout is already approved. Entries it links are skipped below.
  let materialised = await settleMaturedFDs(userId);

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
    maturity_amount_override: number | null;
    investment_bucket_id: string | null;
  }>(
    `SELECT se.id as schedule_id, se.product_id, se.event_date, se.kind,
            se.principal_component, se.interest_component,
            ip.financial_account_id, ip.source_account_id, fa.bank_name,
            ip.maturity_amount_override, ip.investment_bucket_id
     FROM investment_schedule_entries se
     JOIN investment_products ip ON ip.id = se.product_id
     JOIN financial_accounts fa ON fa.id = ip.financial_account_id
     WHERE fa.user_id = ? AND fa.is_active = 1
       AND se.status = 'scheduled' AND se.linked_expense_id IS NULL AND se.event_date <= ?;`,
    userId,
    today,
  );

  for (const entry of due) {
    try {
      if (!entry.source_account_id) {
        logger.warn(`Investment schedule entry ${entry.schedule_id} has no source account — skipping`);
        continue;
      }

      const principalComponent = entry.principal_component ?? 0;
      // A manual correction (setFDMaturityOverride) replaces the computed
      // payout for a 'maturity' event only — interest payout events (future
      // RD/periodic instruments) always use the computed interest.
      const payout =
        entry.kind === "maturity"
          ? (entry.maturity_amount_override ?? principalComponent + (entry.interest_component ?? 0))
          : (entry.interest_component ?? 0);
      const amount = Math.round(payout * 100) / 100;

      if (amount <= 0) {
        // Nothing to review (zero-value placeholder) — finalise straight away.
        await finaliseScheduleEntry(entry.schedule_id);
        materialised++;
        continue;
      }

      // The bank's maturity-credit SMS may have been scanned first — reuse
      // that credit rather than queueing a second one for the same money.
      const tolerance = Math.max(amount * 0.005, 1);
      const existing = await db.getFirstAsync<{ id: string; status: string }>(
        `SELECT e.id, e.status FROM expenses e
         WHERE e.user_id = ? AND e.account_id = ? AND e.nature = 'credit'
           AND e.status IN ('pending_review', 'approved') AND e.deleted_at IS NULL
           AND e.amount >= ? AND e.amount <= ?
           AND e.date >= date(?, '-3 day') AND e.date <= date(?, '+7 day')
           AND NOT EXISTS (SELECT 1 FROM investment_schedule_entries x WHERE x.linked_expense_id = e.id)
         ORDER BY ABS(e.amount - ?) ASC, ABS(julianday(e.date) - julianday(?)) ASC
         LIMIT 1;`,
        userId,
        entry.source_account_id,
        amount - tolerance,
        amount + tolerance,
        entry.event_date,
        entry.event_date,
        amount,
        entry.event_date,
      );

      let expenseId: string;
      if (existing) {
        expenseId = existing.id;
      } else {
        expenseId = generateUUID();
        await db.runAsync(
          `INSERT INTO expenses (id, user_id, amount, currency, description, account_id, date, nature, source, status, created_at)
           VALUES (?, ?, ?, 'INR', ?, ?, ?, 'credit', 'manual', 'pending_review', ?);`,
          expenseId,
          userId,
          amount,
          `${entry.bank_name} FD maturity`,
          entry.source_account_id,
          entry.event_date,
          new Date().toISOString(),
        );
      }

      await db.runAsync(
        `UPDATE investment_schedule_entries SET linked_expense_id = ? WHERE id = ?;`,
        expenseId,
        entry.schedule_id,
      );

      // An SMS credit the user already approved counts as the review step.
      if (existing?.status === "approved") {
        await finaliseScheduleEntry(entry.schedule_id);
      }

      materialised++;
    } catch (e) {
      logger.warn(`Failed to materialise investment schedule entry ${entry.schedule_id} (non-fatal):`, e);
    }
  }

  if (materialised > 0) bumpDataVersion();
  return materialised;
}

/**
 * Completes a still-'scheduled' entry once its payout credit is approved:
 * marks it materialised and, for a maturity event, flips the product to
 * 'matured', records the bucket withdrawal, and closes the FD account.
 */
async function finaliseScheduleEntry(scheduleId: string): Promise<void> {
  const db = getDatabase();
  const entry = await db.getFirstAsync<{
    product_id: string;
    event_date: string;
    kind: string;
    principal_component: number | null;
    financial_account_id: string;
    investment_bucket_id: string | null;
  }>(
    `SELECT se.product_id, se.event_date, se.kind, se.principal_component,
            ip.financial_account_id, ip.investment_bucket_id
     FROM investment_schedule_entries se
     JOIN investment_products ip ON ip.id = se.product_id
     WHERE se.id = ? AND se.status = 'scheduled';`,
    scheduleId,
  );
  if (!entry) return;

  await db.runAsync(`UPDATE investment_schedule_entries SET status = 'materialised' WHERE id = ?;`, scheduleId);
  if (entry.kind !== "maturity") return;

  await db.runAsync(
    `UPDATE investment_products SET status = 'matured', updated_at = datetime('now') WHERE id = ?;`,
    entry.product_id,
  );

  // The deposit was counted as a bucket contribution when linked
  // (linkFDToBucket); record the mirror-image withdrawal so the bucket's
  // current_contributed reflects money that's no longer invested.
  const principal = entry.principal_component ?? 0;
  if (entry.investment_bucket_id && principal > 0) {
    await createInvestmentContribution({
      investment_bucket_id: entry.investment_bucket_id,
      month: entry.event_date.slice(0, 7),
      amount: -principal,
      date: entry.event_date,
      notes: "Withdrawn — Fixed Deposit matured",
    });
  }

  await db.runAsync(
    `UPDATE financial_accounts SET closed_at = datetime('now'), closed_note = 'Fixed deposit matured', updated_at = datetime('now')
     WHERE id = ? AND closed_at IS NULL;`,
    entry.financial_account_id,
  );
}

/**
 * Called after credits are approved (services/expense-crud.ts). Any approved
 * credit that is the queued payout of an FD schedule entry finalises it —
 * this is what closes a matured FD. No-op for ordinary credits.
 */
export async function finaliseFDMaturityForExpenses(expenseIds: string[]): Promise<void> {
  if (expenseIds.length === 0) return;
  const db = getDatabase();
  const placeholders = expenseIds.map(() => "?").join(",");
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT se.id FROM investment_schedule_entries se
     JOIN expenses e ON e.id = se.linked_expense_id
     WHERE se.linked_expense_id IN (${placeholders})
       AND se.status = 'scheduled' AND e.status = 'approved';`,
    ...expenseIds,
  );
  for (const row of rows) {
    try {
      await finaliseScheduleEntry(row.id);
    } catch (e) {
      logger.warn(`Failed to finalise investment schedule entry ${row.id} (non-fatal):`, e);
    }
  }
  if (rows.length > 0) bumpDataVersion();

  // The approved credit may be the bank's own payout (or half of a principal + interest pair)
  // rather than Arth's queued placeholder - match those too.
  const users = await db.getAllAsync<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM expenses
      WHERE id IN (${placeholders}) AND nature = 'credit' AND status = 'approved';`,
    ...expenseIds,
  );
  for (const u of users) {
    try {
      await settleMaturedFDs(u.user_id);
    } catch (e) {
      logger.warn("settleMaturedFDs after approval failed (non-fatal):", e);
    }
  }
}

// ─── Settling matured FDs by their actual payout ─────────────

export interface PayoutCredit {
  id: string;
  amount: number;
  date: string;
  status: string;
}

export interface ExpectedPayout {
  /** What the FD pays out in total (override-aware). */
  maturity: number;
  principal: number;
  interest: number;
}

/** Interest can arrive net of TDS (10%, or 20% without PAN): accept down to this share of it. */
export const MIN_NET_INTEREST_SHARE = 0.75;

const tol = (x: number) => Math.max(Math.abs(x) * 0.005, 1);

/**
 * Which credit(s) are this FD's payout, or null. Banks pay a maturity either as ONE credit
 * (principal + interest, possibly net of TDS) or as TWO: the principal, and the interest
 * separately (again possibly net of TDS). Pure.
 */
export function matchMaturityPayout(credits: PayoutCredit[], exp: ExpectedPayout): PayoutCredit[] | null {
  const interest = Math.max(exp.interest, 0);
  const minSingle = exp.principal + interest * MIN_NET_INTEREST_SHARE - tol(exp.maturity);
  const maxSingle = exp.maturity + tol(exp.maturity);
  const singles = credits
    .filter((c) => c.amount >= minSingle && c.amount <= maxSingle)
    .sort((a, b) => Math.abs(a.amount - exp.maturity) - Math.abs(b.amount - exp.maturity));
  if (singles.length > 0) return [singles[0]];

  if (interest <= 0) return null;
  const principals = credits
    .filter((c) => Math.abs(c.amount - exp.principal) <= tol(exp.principal))
    .sort((a, b) => Math.abs(a.amount - exp.principal) - Math.abs(b.amount - exp.principal));
  if (principals.length === 0) return null;
  const p = principals[0];
  const interests = credits
    .filter(
      (c) =>
        c.id !== p.id &&
        c.amount >= interest * MIN_NET_INTEREST_SHARE - tol(interest) &&
        c.amount <= interest + tol(interest),
    )
    .sort((a, b) => Math.abs(a.amount - interest) - Math.abs(b.amount - interest));
  return interests.length > 0 ? [p, interests[0]] : null;
}

/**
 * Closes every matured FD whose payout has been credited AND approved.
 *
 * For each maturity event that's due and not finalised, looks for the payout among credits on
 * the FD's source account (or any savings account when none is recorded), dated from 3 days
 * before to 10 days after maturity:
 *   - the bank's real credit(s) win over Arth's own queued "FD maturity" placeholder; if the
 *     placeholder is still unapproved it's withdrawn, so the same money isn't counted twice
 *   - once every matched credit is approved, the FD is finalised: product -> matured, bucket
 *     withdrawal recorded, FD account closed
 * Also closes the account of any FD already marked matured but left open.
 * Idempotent. Returns how many FDs it closed.
 */
export async function settleMaturedFDs(userId: string): Promise<number> {
  const db = getDatabase();
  const today = todayIso();
  let closed = 0;

  const entries = await db.getAllAsync<{
    schedule_id: string;
    event_date: string;
    principal_component: number | null;
    interest_component: number | null;
    maturity_amount_override: number | null;
    source_account_id: string | null;
    linked_expense_id: string | null;
  }>(
    `SELECT se.id AS schedule_id, se.event_date, se.principal_component, se.interest_component,
            ip.maturity_amount_override, ip.source_account_id, se.linked_expense_id
       FROM investment_schedule_entries se
       JOIN investment_products ip ON ip.id = se.product_id
       JOIN financial_accounts fa ON fa.id = ip.financial_account_id
      WHERE fa.user_id = ? AND fa.is_active = 1
        AND se.kind = 'maturity' AND se.status = 'scheduled' AND se.event_date <= ?;`,
    userId,
    today,
  );

  for (const e of entries) {
    try {
      const principal = e.principal_component ?? 0;
      const interest = e.interest_component ?? 0;
      const expected = { principal, interest, maturity: e.maturity_amount_override ?? principal + interest };
      if (expected.maturity <= 0) continue;

      const accountIds = e.source_account_id
        ? [e.source_account_id]
        : (
            await db.getAllAsync<{ id: string }>(
              `SELECT id FROM financial_accounts
                WHERE user_id = ? AND is_active = 1 AND account_type = 'savings';`,
              userId,
            )
          ).map((r) => r.id);
      if (accountIds.length === 0) continue;

      // Arth's own queued payout (see materialiseMaturedInvestments) - not a real credit.
      const placeholder = e.linked_expense_id
        ? await db.getFirstAsync<{ id: string; status: string; source: string; description: string | null }>(
            `SELECT id, status, source, description FROM expenses WHERE id = ? AND deleted_at IS NULL;`,
            e.linked_expense_id,
          )
        : null;
      const isArthPlaceholder =
        placeholder != null && placeholder.source === "manual" && (placeholder.description ?? "").endsWith("FD maturity");

      // An approved placeholder IS the reviewed payout - finalise on it as before.
      if (placeholder && isArthPlaceholder && placeholder.status === "approved") {
        await finaliseScheduleEntry(e.schedule_id);
        closed++;
        continue;
      }

      const ph = accountIds.map(() => "?").join(",");
      const credits = await db.getAllAsync<PayoutCredit>(
        `SELECT c.id, c.amount, c.date, c.status FROM expenses c
          WHERE c.user_id = ? AND c.account_id IN (${ph}) AND c.nature = 'credit'
            AND c.status IN ('pending_review', 'approved') AND c.deleted_at IS NULL
            AND c.date >= date(?, '-3 day') AND c.date <= date(?, '+10 day')
            AND c.id != ?
            AND NOT EXISTS (
              SELECT 1 FROM investment_schedule_entries x
               WHERE x.linked_expense_id = c.id AND x.id != ?
            );`,
        userId,
        ...accountIds,
        e.event_date,
        e.event_date,
        isArthPlaceholder && placeholder ? placeholder.id : "",
        e.schedule_id,
      );
      const match = matchMaturityPayout(credits, expected);
      if (!match) continue;

      // The real credit replaces Arth's unapproved placeholder, so the money isn't in twice.
      if (isArthPlaceholder && placeholder && placeholder.status === "pending_review") {
        await db.runAsync(
          `UPDATE expenses SET status = 'rejected', deleted_at = datetime('now') WHERE id = ?;`,
          placeholder.id,
        );
      }
      await db.runAsync(
        `UPDATE investment_schedule_entries SET linked_expense_id = ? WHERE id = ?;`,
        match[0].id,
        e.schedule_id,
      );

      if (match.every((c) => c.status === "approved")) {
        await finaliseScheduleEntry(e.schedule_id);
        closed++;
      }
    } catch (err) {
      logger.warn(`settleMaturedFDs: entry ${e.schedule_id} failed (non-fatal):`, err);
    }
  }

  // Repair: an FD already marked matured but whose account was never closed.
  const openMatured = await db.getAllAsync<{ id: string }>(
    `SELECT fa.id FROM financial_accounts fa
       JOIN investment_products ip ON ip.financial_account_id = fa.id
      WHERE fa.user_id = ? AND ip.status = 'matured' AND fa.closed_at IS NULL;`,
    userId,
  );
  for (const a of openMatured) {
    await db.runAsync(
      `UPDATE financial_accounts SET closed_at = datetime('now'), closed_note = 'Fixed deposit matured', updated_at = datetime('now')
        WHERE id = ? AND closed_at IS NULL;`,
      a.id,
    );
    closed++;
  }

  if (closed > 0) bumpDataVersion();
  return closed;
}
