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
import { DEFAULT_USER_ID } from "@/constants/app";
import { round2 } from "@/utils/math";
import { createManualAccount, getActiveAccounts, getDematAccountsWithSummary } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import { createTransfer } from "@/services/account-transfer";
import { getComputedBalances, computeUnseededBalance } from "@/services/account-balance";
import {
  addFDTerm,
  computeFDInterest,
  currentFDValue,
  fdTermBetween,
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

export type InvestmentInstrument = "equity" | "mutual_fund" | "gold" | "fd" | "bond" | "epf" | "nps" | "ppf" | "crypto" | "other";
export type InvestmentValuation = "market" | "contract" | "contribution";
export type InvestmentProductStatus = "active" | "matured" | "closed";
/**
 * What an FD does at maturity (migration 094, docs/FD_IMPROVEMENTS_PROPOSAL.md point 4):
 *   none               - pays principal + interest out to the funding account and closes
 *   principal          - pays the interest out and renews the principal for the same term
 *   principal_interest - renews the whole maturity amount for the same term
 */
export type FDRenewalMode = "none" | "principal" | "principal_interest";

export const RENEWAL_MODE_LABELS: Record<FDRenewalMode, string> = {
  none: "No auto-renew",
  principal: "Renew principal only",
  principal_interest: "Renew principal + interest",
};

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
  crypto: "Crypto",
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
  /** v4.49 — see FDRenewalMode. */
  renewal_mode: FDRenewalMode;
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
  renewal_mode?: FDRenewalMode;
  /** The bank's maturity figure when it differs from Arth's (same as setFDMaturityOverride). */
  maturity_amount_override?: number | null;
}

// ─── Create ───────────────────────────────────────────────

interface FDDetails {
  interest_rate_pa?: number;
  interest_method?: InterestMethod;
  compounding_freq?: CompoundingFreq;
  maturity_date?: string;
  renewal_mode?: FDRenewalMode;
  maturity_amount_override?: number | null;
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
      auto_credit_on_maturity, status, created_at, updated_at,
      renewal_mode, maturity_amount_override
    ) VALUES (?, ?, 'fd', 'contract', ?, ?, ?, ?, ?, ?, 'cumulative', ?, 1, 'active', ?, ?, ?, ?);`,
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
    details.renewal_mode ?? "none",
    details.maturity_amount_override ?? null,
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
  if (input.maturity_amount_override != null && !(input.maturity_amount_override > 0)) {
    throw new Error("Corrected maturity amount must be a positive number");
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
    renewal_mode: input.renewal_mode,
    maturity_amount_override: input.maturity_amount_override,
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
  renewal_mode?: FDRenewalMode;
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
    renewal_mode: input.renewal_mode,
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
    renewal_mode?: FDRenewalMode;
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
     SET interest_rate_pa = ?, interest_method = ?, compounding_freq = ?, maturity_date = ?, renewal_mode = ?,
         updated_at = datetime('now')
     WHERE id = ?;`,
    details.interest_rate_pa,
    details.interest_method,
    details.compounding_freq ?? null,
    details.maturity_date,
    details.renewal_mode ?? product.renewal_mode ?? "none",
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
 * True when an FD's schedule can still be safely edited — i.e. the current
 * term's maturity hasn't been materialised yet (money hasn't actually moved).
 * Once it has, changing rate/maturity would desync the FD account's real
 * transfer history from a freshly regenerated schedule. A renewed FD's earlier
 * terms are materialised too, but they end on the current start date, so they
 * don't lock the new term.
 */
export async function isFDEditable(productId: string): Promise<boolean> {
  const db = getDatabase();
  const materialised = await db.getFirstAsync<{ id: string }>(
    `SELECT se.id FROM investment_schedule_entries se
       JOIN investment_products ip ON ip.id = se.product_id
      WHERE se.product_id = ? AND se.status = 'materialised'
        AND (ip.start_date IS NULL OR se.event_date > ip.start_date)
      LIMIT 1;`,
    productId,
  );
  return !materialised;
}

/** When the FD was last renewed (its current start date), or null if it never was. */
export async function getFDRenewedOn(productId: string): Promise<string | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ start_date: string }>(
    `SELECT ip.start_date FROM investment_products ip
      WHERE ip.id = ? AND ip.status = 'active' AND EXISTS (
        SELECT 1 FROM investment_schedule_entries se
         WHERE se.product_id = ip.id AND se.kind = 'maturity' AND se.status = 'materialised'
           AND se.event_date = ip.start_date);`,
    productId,
  );
  return row?.start_date ?? null;
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
    renewal_mode?: FDRenewalMode;
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
     SET interest_rate_pa = ?, interest_method = ?, compounding_freq = ?, maturity_date = ?, renewal_mode = ?,
         updated_at = datetime('now')
     WHERE id = ?;`,
    details.interest_rate_pa,
    details.interest_method,
    details.compounding_freq ?? null,
    details.maturity_date,
    details.renewal_mode ?? product.renewal_mode ?? "none",
    product.id,
  );

  // Drop the current term's (never-materialised) schedule and regenerate it —
  // safe because isFDEditable already confirmed it hasn't materialised. A
  // renewed FD's earlier, materialised terms stay as history.
  await db.runAsync("DELETE FROM investment_schedule_entries WHERE product_id = ? AND status != 'materialised';", product.id);
  const lastEvent = await db.getFirstAsync<{ n: number | null }>(
    "SELECT MAX(event_num) AS n FROM investment_schedule_entries WHERE product_id = ?;",
    product.id,
  );
  const eventOffset = lastEvent?.n ?? 0;

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
      entry.event_num + eventOffset,
      entry.event_date,
      entry.kind,
      entry.principal_component,
      entry.interest_component,
    );
  }

  bumpDataVersion();
}

/**
 * Redoes the current term's (never-materialised) schedule for a new principal. The schedule runs
 * from the FD's start date, so money taken out partway earns nothing at all: only what stays in
 * accrues interest. Callers check isFDEditable first.
 */
async function regenerateFDScheduleForPrincipal(product: InvestmentProduct, principal: number): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "UPDATE investment_products SET principal = ?, updated_at = datetime('now') WHERE id = ?;",
    principal,
    product.id,
  );
  // A shell FD without rate / maturity has no schedule yet: the principal is all there is.
  if (product.interest_rate_pa == null || !product.maturity_date || !product.start_date || !product.interest_method) return;
  await db.runAsync("DELETE FROM investment_schedule_entries WHERE product_id = ? AND status != 'materialised';", product.id);
  const lastEvent = await db.getFirstAsync<{ n: number | null }>(
    "SELECT MAX(event_num) AS n FROM investment_schedule_entries WHERE product_id = ?;",
    product.id,
  );
  const eventOffset = lastEvent?.n ?? 0;
  const schedule = generateFDSchedule({
    principal,
    interest_rate_pa: product.interest_rate_pa,
    start_date: product.start_date,
    maturity_date: product.maturity_date,
    interest_method: product.interest_method,
    compounding_freq: product.compounding_freq ?? undefined,
  });
  for (const entry of schedule) {
    await db.runAsync(
      `INSERT INTO investment_schedule_entries (
        id, product_id, event_num, event_date, kind,
        principal_component, interest_component, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled');`,
      entry.id,
      product.id,
      entry.event_num + eventOffset,
      entry.event_date,
      entry.kind,
      entry.principal_component,
      entry.interest_component,
    );
  }
}

/**
 * Money taken out of an FD before maturity: transfers out of the FD account that no schedule
 * entry (interest payout, maturity) made.
 */
async function getFDPartialWithdrawals(financialAccountId: string, productId: string): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(t.amount) AS total FROM account_transfers t
      WHERE t.from_account_id = ? AND t.deleted_at IS NULL
        AND t.id NOT IN (SELECT linked_transfer_id FROM investment_schedule_entries
                          WHERE product_id = ? AND linked_transfer_id IS NOT NULL);`,
    financialAccountId,
    productId,
  );
  return row?.total ?? 0;
}

/** What was deposited in an FD: the principal now plus any partial withdrawals. */
export async function getFDDeposit(financialAccountId: string): Promise<number | null> {
  const product = await getInvestmentProduct(financialAccountId);
  if (!product || product.principal == null) return null;
  return round2(product.principal + (await getFDPartialWithdrawals(financialAccountId, product.id)));
}

/**
 * Changes how much was deposited in an FD (owner, Nov 2026: "option to edit principal"). The
 * deposit transfer into the FD changes to match, and the interest schedule is redone on what's in
 * the FD now (the deposit less any partial withdrawals). Only before anything has matured.
 */
export async function updateFDPrincipal(financialAccountId: string, deposit: number): Promise<void> {
  const db = getDatabase();
  const product = await getInvestmentProduct(financialAccountId);
  if (!product || product.valuation !== "contract") throw new Error("This account is not a fixed deposit");
  if (!(Number.isFinite(deposit) && deposit > 0)) throw new Error("Principal must be a positive number");
  if (!(await isFDEditable(product.id))) throw new Error("This fixed deposit has already matured, so its principal can't change");
  const withdrawn = await getFDPartialWithdrawals(financialAccountId, product.id);
  const remaining = round2(deposit - withdrawn);
  if (!(remaining > 0)) throw new Error("The principal must be more than what was already withdrawn");

  await db.withTransactionAsync(async () => {
    // The deposit: the first transfer into the FD account.
    const depositTransfer = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM account_transfers WHERE to_account_id = ? AND deleted_at IS NULL
        ORDER BY date ASC, created_at ASC LIMIT 1;`,
      financialAccountId,
    );
    if (depositTransfer) {
      await db.runAsync(
        "UPDATE account_transfers SET amount = ?, updated_at = datetime('now') WHERE id = ?;",
        deposit,
        depositTransfer.id,
      );
    }
    await regenerateFDScheduleForPrincipal(product, remaining);
  });
  bumpDataVersion();
}

/**
 * Takes part of an FD out before maturity (owner, Nov 2026). The amount goes back to the savings
 * account the FD was funded from, on the given date; what stays in is the new principal, and the
 * interest schedule is redone on it from the start date, so the withdrawn part earns no interest.
 */
export async function partialWithdrawFD(financialAccountId: string, amount: number, date: string, toAccountId?: string): Promise<void> {
  const db = getDatabase();
  const product = await getInvestmentProduct(financialAccountId);
  if (!product || product.valuation !== "contract" || product.principal == null) throw new Error("This account is not a fixed deposit");
  if (product.status !== "active") throw new Error("This fixed deposit is no longer active");
  if (!(await isFDEditable(product.id))) throw new Error("This fixed deposit has already matured");
  if (!(Number.isFinite(amount) && amount > 0)) throw new Error("Enter how much to withdraw");
  if (!(amount < product.principal)) throw new Error("To take it all out, close the fixed deposit instead");
  if (product.start_date && date < product.start_date) throw new Error("The withdrawal can't be before the FD started");
  if (product.maturity_date && date >= product.maturity_date) throw new Error("The withdrawal must be before the maturity date");
  const to = toAccountId ?? product.source_account_id;
  if (!to) throw new Error("Pick the account the money goes to");
  const account = await db.getFirstAsync<{ bank_name: string; account_label: string | null }>(
    "SELECT bank_name, account_label FROM financial_accounts WHERE id = ?;",
    financialAccountId,
  );
  const name = account?.account_label ?? `${account?.bank_name ?? ""} FD`;

  await createTransfer({
    userId: DEFAULT_USER_ID,
    fromAccountId: financialAccountId,
    toAccountId: to,
    amount: round2(amount),
    description: `${name} — partial withdrawal`,
    date,
    source: "manual",
  });
  await regenerateFDScheduleForPrincipal(product, round2(product.principal - amount));
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
        // A demat linked to Zebpay holds crypto, which is taxed differently from equity.
        await convertLegacyAccountToInvestment(row.id, isZebpayLinked(row.id) ? "crypto" : "equity", "market");
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

// ─── Keeping figures current, and renewals ─────────────────

/**
 * Brings each upcoming FD's stored interest in line with the current maths
 * (services/investment-engine.ts). Arth used a days / 365.25 formula before
 * 4.49, which left most FDs a few rupees off the bank's figure; this fixes
 * those, and any restored from an older backup. Only touches a schedule entry
 * that is still the FD's own computed figure: not yet linked to a credit, on
 * the product's maturity date, and on an FD with no manual correction (the
 * user's own figure always wins). Idempotent. Returns how many changed.
 */
export async function refreshFDScheduleFigures(userId: string): Promise<number> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{
    schedule_id: string;
    interest_component: number | null;
    principal: number;
    interest_rate_pa: number;
    interest_method: InterestMethod;
    compounding_freq: CompoundingFreq | null;
    start_date: string;
    maturity_date: string;
  }>(
    `SELECT se.id AS schedule_id, se.interest_component, ip.principal, ip.interest_rate_pa,
            ip.interest_method, ip.compounding_freq, ip.start_date, ip.maturity_date
       FROM investment_schedule_entries se
       JOIN investment_products ip ON ip.id = se.product_id
       JOIN financial_accounts fa ON fa.id = ip.financial_account_id
      WHERE fa.user_id = ? AND ip.valuation = 'contract' AND ip.status = 'active'
        AND ip.maturity_amount_override IS NULL
        AND ip.principal IS NOT NULL AND ip.interest_rate_pa IS NOT NULL AND ip.interest_method IS NOT NULL
        AND ip.start_date IS NOT NULL AND ip.maturity_date IS NOT NULL
        AND se.kind = 'maturity' AND se.status = 'scheduled' AND se.linked_expense_id IS NULL
        AND se.event_date = ip.maturity_date;`,
    userId,
  );
  let changed = 0;
  for (const r of rows) {
    const interest = computeFDInterest({
      principal: r.principal,
      interest_rate_pa: r.interest_rate_pa,
      start_date: r.start_date,
      maturity_date: r.maturity_date,
      interest_method: r.interest_method,
      compounding_freq: r.compounding_freq ?? undefined,
    });
    if (r.interest_component != null && Math.abs(r.interest_component - interest) < 0.005) continue;
    await db.runAsync(`UPDATE investment_schedule_entries SET interest_component = ? WHERE id = ?;`, interest, r.schedule_id);
    changed++;
  }
  if (changed > 0) bumpDataVersion();
  return changed;
}

interface RenewalRow {
  schedule_id: string;
  event_num: number;
  event_date: string;
  principal_component: number | null;
  interest_component: number | null;
  product_id: string;
  financial_account_id: string;
  source_account_id: string | null;
  renewal_mode: FDRenewalMode;
  maturity_amount_override: number | null;
  start_date: string;
  interest_rate_pa: number;
  interest_method: InterestMethod;
  compounding_freq: CompoundingFreq | null;
  bank_name: string;
}

/**
 * Renews every auto-renewing FD whose maturity date has passed
 * (docs/FD_IMPROVEMENTS_PROPOSAL.md point 4):
 *   - 'principal': the interest is queued as a credit on the funding account
 *     for review (or the bank's own interest credit from SMS is used, if it's
 *     already there, net of TDS allowed); the principal stays in the FD.
 *   - 'principal_interest': nothing reaches the bank account; the interest is
 *     queued as a credit on the FD account itself, so its balance grows to the
 *     maturity amount, which becomes the new principal.
 * Either way the finished term's entry is materialised, the FD is re-dated for
 * the same term from the old maturity date, at the same rate (banks renew at
 * their rate on the day, which Arth can't know; getFDRenewedOn lets the UI ask
 * the user to check it), and a manual maturity correction is cleared since it
 * belonged to the old term. Catches up several terms if the app wasn't opened.
 * Idempotent. Returns how many terms it renewed.
 */
export async function renewMaturedFDs(userId: string): Promise<number> {
  const db = getDatabase();
  const today = todayIso();
  let renewed = 0;
  // One term per FD per pass; more passes catch up FDs that renewed more than once while the app was closed.
  for (let pass = 0; pass < 50; pass++) {
    const rows = await db.getAllAsync<RenewalRow>(
      `SELECT se.id AS schedule_id, se.event_num, se.event_date, se.principal_component, se.interest_component,
              ip.id AS product_id, ip.financial_account_id, ip.source_account_id, ip.renewal_mode,
              ip.maturity_amount_override, ip.start_date, ip.interest_rate_pa, ip.interest_method,
              ip.compounding_freq, fa.bank_name
         FROM investment_schedule_entries se
         JOIN investment_products ip ON ip.id = se.product_id
         JOIN financial_accounts fa ON fa.id = ip.financial_account_id
        WHERE fa.user_id = ? AND fa.is_active = 1 AND fa.closed_at IS NULL
          AND ip.valuation = 'contract' AND ip.status = 'active'
          AND ip.renewal_mode IN ('principal', 'principal_interest')
          AND ip.interest_rate_pa IS NOT NULL AND ip.interest_method IS NOT NULL AND ip.start_date IS NOT NULL
          AND se.kind = 'maturity' AND se.status = 'scheduled' AND se.linked_expense_id IS NULL
          AND se.event_date <= ? AND se.event_date > ip.start_date;`,
      userId,
      today,
    );
    if (rows.length === 0) break;
    let progressed = 0;
    for (const row of rows) {
      try {
        if (await renewOneTerm(userId, row)) {
          renewed++;
          progressed++;
        }
      } catch (e) {
        logger.warn(`Failed to renew FD ${row.financial_account_id} (non-fatal):`, e);
      }
    }
    if (progressed === 0) break;
  }
  if (renewed > 0) bumpDataVersion();
  return renewed;
}

async function renewOneTerm(userId: string, row: RenewalRow): Promise<boolean> {
  const db = getDatabase();
  const term = fdTermBetween(row.start_date, row.event_date);
  if (term.years === 0 && term.months === 0 && term.days === 0) return false;

  const principal = row.principal_component ?? 0;
  const maturity = row.maturity_amount_override ?? principal + (row.interest_component ?? 0);
  const interest = Math.max(Math.round((maturity - principal) * 100) / 100, 0);
  const newStart = row.event_date;
  const newMaturity = addFDTerm(newStart, term);
  const newPrincipal =
    row.renewal_mode === "principal_interest" ? Math.round((principal + interest) * 100) / 100 : principal;

  let creditId: string | null = null;
  if (interest > 0) {
    const creditAccount = row.renewal_mode === "principal_interest" ? row.financial_account_id : row.source_account_id;
    if (row.renewal_mode === "principal" && creditAccount) {
      // The bank's own interest credit may already have been read from SMS - use it instead of a second one.
      const t = Math.max(interest * 0.005, 1);
      const existing = await db.getFirstAsync<{ id: string }>(
        `SELECT e.id FROM expenses e
          WHERE e.user_id = ? AND e.account_id = ? AND e.nature = 'credit'
            AND e.status IN ('pending_review', 'approved') AND e.deleted_at IS NULL
            AND e.amount >= ? AND e.amount <= ?
            AND e.date >= date(?, '-3 day') AND e.date <= date(?, '+10 day')
            AND NOT EXISTS (SELECT 1 FROM investment_schedule_entries x WHERE x.linked_expense_id = e.id)
          ORDER BY ABS(e.amount - ?) ASC, ABS(julianday(e.date) - julianday(?)) ASC
          LIMIT 1;`,
        userId,
        creditAccount,
        interest * MIN_NET_INTEREST_SHARE - t,
        interest + t,
        newStart,
        newStart,
        interest,
        newStart,
      );
      creditId = existing?.id ?? null;
    }
    if (!creditId && creditAccount) {
      creditId = generateUUID();
      await db.runAsync(
        `INSERT INTO expenses (id, user_id, amount, currency, description, account_id, date, nature, source, status, created_at)
         VALUES (?, ?, ?, 'INR', ?, ?, ?, 'credit', 'manual', 'pending_review', ?);`,
        creditId,
        userId,
        interest,
        `${row.bank_name} FD interest (renewed)`,
        creditAccount,
        newStart,
        new Date().toISOString(),
      );
    } else if (!creditAccount) {
      logger.warn(`FD ${row.financial_account_id} renewed without a funding account - its interest wasn't recorded`);
    }
  }

  await db.runAsync(
    `UPDATE investment_schedule_entries SET status = 'materialised', linked_expense_id = ? WHERE id = ?;`,
    creditId,
    row.schedule_id,
  );
  await db.runAsync(
    `UPDATE investment_products
        SET principal = ?, start_date = ?, maturity_date = ?, maturity_amount_override = NULL, updated_at = datetime('now')
      WHERE id = ?;`,
    newPrincipal,
    newStart,
    newMaturity,
    row.product_id,
  );
  const schedule = generateFDSchedule({
    principal: newPrincipal,
    interest_rate_pa: row.interest_rate_pa,
    start_date: newStart,
    maturity_date: newMaturity,
    interest_method: row.interest_method,
    compounding_freq: row.compounding_freq ?? undefined,
  });
  for (const entry of schedule) {
    await db.runAsync(
      `INSERT INTO investment_schedule_entries (
        id, product_id, event_num, event_date, kind,
        principal_component, interest_component, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled');`,
      entry.id,
      row.product_id,
      row.event_num + entry.event_num,
      entry.event_date,
      entry.kind,
      entry.principal_component,
      entry.interest_component,
    );
  }
  return true;
}

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
  // Upcoming FDs' figures follow the current maths (unless corrected by hand).
  try {
    await refreshFDScheduleFigures(userId);
  } catch (e) {
    logger.warn("refreshFDScheduleFigures failed (non-fatal):", e);
  }
  // Auto-renewing FDs roll over instead of paying out.
  let materialised = await renewMaturedFDs(userId);
  // Match real payout credits first (single, or principal + interest, from the bank's SMS) and
  // close FDs whose payout is already approved. Entries it links are skipped below.
  materialised += await settleMaturedFDs(userId);

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
       AND se.status = 'scheduled' AND se.linked_expense_id IS NULL AND se.event_date <= ?
       AND ip.renewal_mode = 'none';`,
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

/**
 * Use this credit as the FD's payout — on its maturity date or early (premature closure, which
 * never lines up with the schedule, so settleMaturedFDs can't find it). The maturity schedule
 * entry is re-dated to the credit and its principal/interest set to what was actually paid; an
 * unapproved Arth "FD maturity" placeholder is withdrawn so the money isn't in twice. If the
 * credit is already approved the FD closes now, otherwise when the credit is approved
 * (finaliseFDMaturityForExpenses).
 */
export async function linkClosureCreditToFD(financialAccountId: string, creditId: string): Promise<void> {
  const db = getDatabase();
  const product = await db.getFirstAsync<{ id: string; principal: number | null }>(
    `SELECT id, principal FROM investment_products
      WHERE financial_account_id = ? AND instrument = 'fd' AND status = 'active';`,
    financialAccountId,
  );
  if (!product) throw new Error("No active fixed deposit on this account");
  const credit = await db.getFirstAsync<{ amount: number; date: string; status: string }>(
    `SELECT amount, date, status FROM expenses WHERE id = ? AND nature = 'credit' AND deleted_at IS NULL;`,
    creditId,
  );
  if (!credit) throw new Error("Credit not found");

  const principal = product.principal ?? credit.amount;
  const interest = Math.max(Math.round((credit.amount - principal) * 100) / 100, 0);

  const entry = await db.getFirstAsync<{ id: string; linked_expense_id: string | null }>(
    `SELECT id, linked_expense_id FROM investment_schedule_entries
      WHERE product_id = ? AND kind = 'maturity' AND status = 'scheduled'
      ORDER BY event_num ASC LIMIT 1;`,
    product.id,
  );

  let entryId: string;
  if (entry) {
    if (entry.linked_expense_id && entry.linked_expense_id !== creditId) {
      await db.runAsync(
        `UPDATE expenses SET status = 'rejected', deleted_at = datetime('now')
          WHERE id = ? AND source = 'manual' AND status = 'pending_review' AND description LIKE '%FD maturity';`,
        entry.linked_expense_id,
      );
    }
    await db.runAsync(
      `UPDATE investment_schedule_entries
          SET linked_expense_id = ?, event_date = ?, principal_component = ?, interest_component = ?
        WHERE id = ?;`,
      creditId,
      credit.date,
      principal,
      interest,
      entry.id,
    );
    entryId = entry.id;
  } else {
    const next = await db.getFirstAsync<{ n: number | null }>(
      `SELECT MAX(event_num) AS n FROM investment_schedule_entries WHERE product_id = ?;`,
      product.id,
    );
    entryId = generateUUID();
    await db.runAsync(
      `INSERT INTO investment_schedule_entries
         (id, product_id, event_num, event_date, kind, principal_component, interest_component, status, linked_expense_id)
       VALUES (?, ?, ?, ?, 'maturity', ?, ?, 'scheduled', ?);`,
      entryId,
      product.id,
      (next?.n ?? 0) + 1,
      credit.date,
      principal,
      interest,
      creditId,
    );
  }

  await db.runAsync(
    `UPDATE investment_products SET maturity_date = ?, updated_at = datetime('now') WHERE id = ?;`,
    credit.date,
    product.id,
  );

  if (credit.status === "approved") await finaliseScheduleEntry(entryId);
  bumpDataVersion();
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

function isZebpayLinked(accountId: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getBrokerLinkedAccount } = require("@/services/broker-link") as typeof import("@/services/broker-link");
    return getBrokerLinkedAccount("zebpay") === accountId;
  } catch {
    return false;
  }
}

/**
 * Mark an account as crypto (when it's linked to Zebpay). Only changes an account still on the
 * default "equity" type, so a type the user picked themselves is never overridden.
 */
export async function markAccountCrypto(accountId: string): Promise<void> {
  const db = getDatabase();
  const res = await db.runAsync(
    `UPDATE investment_products SET instrument = 'crypto', updated_at = datetime('now')
      WHERE financial_account_id = ? AND instrument = 'equity';`,
    accountId,
  );
  if (res.changes > 0) bumpDataVersion();
}

/** Set the investment type of a market account (the tax treatment of its gains). */
export async function setInvestmentInstrument(accountId: string, instrument: InvestmentInstrument): Promise<void> {
  const db = getDatabase();
  const res = await db.runAsync(
    `UPDATE investment_products SET instrument = ?, updated_at = datetime('now') WHERE financial_account_id = ?;`,
    instrument,
    accountId,
  );
  if (res.changes === 0) await createInvestmentProductForAccount(accountId, instrument, "market");
  bumpDataVersion();
}

