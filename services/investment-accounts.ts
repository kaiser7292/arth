/**
 * Investment accounts service (docs/INVESTMENT_ACCOUNTS_PROPOSAL.md).
 *
 * Wraps DB ops for `investment_products` / `investment_schedule_entries`.
 * FD math lives in services/investment-engine.ts (pure, no DB).
 *
 * Creation flow, mirroring services/loan-accounts.ts:
 *   1. createManualAccount() creates a financial_accounts row (account_type='investment').
 *   2. createFDAccount() creates the investment_products sibling + generates the
 *      (single-row, v1) maturity schedule.
 *
 * v1 scope is FD only (valuation='contract'). 'market' (demat) and
 * 'contribution' (pension) products are not created through this service —
 * they migrate in under their existing demat/pension code paths per the
 * proposal's Phase 2, and don't need a schedule at all.
 */

import { getDatabase } from "@/database";
import { createManualAccount } from "@/services/financial-account";
import { createTransfer } from "@/services/account-transfer";
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

// ─── Read ─────────────────────────────────────────────────

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
