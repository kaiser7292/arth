/**
 * Loan Accounts service (v17.0.0).
 *
 * Wraps DB ops for `loan_accounts` / `loan_schedule_entries` / `loan_prepayments`.
 * Amortization math lives in services/loan-engine.ts (pure, no DB).
 *
 * Creation flow:
 *   1. createManualAccount() creates a financial_accounts row (account_type='loan').
 *   2. createLoan() creates the loan_accounts sibling + generates schedule entries.
 *
 * Soft-delete via status='closed'; hard-delete deferred to v17.1.0+.
 */

import { getDatabase } from "@/database";
import { createManualAccount } from "@/services/financial-account";
import {
    applyPrepayment,
    computeEMI,
    computeOutstandingAt,
    generateSchedule,
    type Correction,
    type LoanParams,
    type LoanTerms,
    type Prepayment,
    type ScheduleEntry,
} from "@/services/loan-engine";
import { bumpDataVersion } from "@/services/settings";
import { logger } from "@/utils/logger";
import { generateUUID } from "@/utils/uuid";

// ─── Types ────────────────────────────────────────────────

export type LoanType =
  | "personal"
  | "home"
  | "auto"
  | "education"
  | "business"
  | "gold"
  | "against_fd"
  | "other";

export type LoanStatus = "active" | "closed" | "foreclosed" | "written_off";
export type InterestType = "fixed" | "floating";
export type InterestMethod = "reducing" | "flat" | "simple";
export type RepaymentMode = "si" | "nach" | "pdc" | "manual";

export interface LoanAccount {
  id: string;
  financial_account_id: string;
  agreement_id: string | null;
  loan_type: LoanType;
  currency: string;
  principal_sanctioned: number;
  principal_disbursed: number;
  disbursement_date: string;
  emi_start_date: string;
  emi_day_of_month: number;
  interest_rate_pa: number;
  interest_type: InterestType;
  interest_method: InterestMethod;
  tenure_months: number;
  emi_amount: number;
  repayment_mode: RepaymentMode | null;
  processing_fee: number;
  stamp_duty: number;
  insurance_premium: number;
  prepayment_charge_pct_early: number;
  prepayment_charge_pct_late: number;
  prepayment_charge_threshold_emis: number | null;
  foreclosure_waiver_months: number | null;
  foreclosure_waiver_min_amount: number | null;
  penal_rate_pa: number;
  penal_rate_cap_pa: number;
  gst_pct: number;
  fx_rate: number | null;
  fx_rate_date: string | null;
  status: LoanStatus;
  closed_date: string | null;
  notes: string | null;
  /** v17.5.2 — rupee rounding matches Indian bank statements; paise for non-INR. */
  round_mode: "rupee" | "paise";
  /** v17.6.0 — 'generated' (engine-computed) | 'manual_csv' (user-uploaded CSV schedule). */
  schedule_source: "generated" | "manual_csv";
  /** v17.6.0 — last EMI-reminder SMS metadata (used for the loan detail banner). */
  last_sms_reminder_at: string | null;
  last_sms_reminder_due_date: string | null;
  last_sms_reminder_amount: number | null;
  created_at: string;
  updated_at: string;
}

export interface LoanScheduleEntry {
  id: string;
  loan_account_id: string;
  installment_num: number;
  due_date: string;
  opening_principal: number;
  emi_amount: number;
  principal_component: number;
  interest_component: number;
  closing_principal: number;
  status: "scheduled" | "paid" | "overdue" | "prepaid" | "skipped";
  linked_expense_id: string | null;
  paid_date: string | null;
  paid_amount: number | null;
}

export interface LoanPrepaymentRow {
  id: string;
  loan_account_id: string;
  prepayment_date: string;
  amount: number;
  prepayment_charge: number;
  gst_on_charge: number;
  kind: "part_payment" | "foreclosure";
  strategy: "reduce_tenure" | "reduce_emi" | null;
  linked_expense_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface LoanCorrectionRow {
  id: string;
  loan_account_id: string;
  effective_date: string;
  outstanding_principal: number;
  emi_amount: number;
  tenure_remaining_months: number | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateLoanInput {
  user_id: string;
  bank_name: string;
  /**
   * v17.6.0 — last-N digits of the bank account / loan agreement number as
   * shown in EMI SMS or NACH mandate. Stored on financial_accounts.account_identifier.
   * Enables dedup matching against SMS-auto-created loan accounts and hooks
   * up the EMI reminder SMS → loan linking path.
   */
  account_identifier?: string;
  agreement_id?: string;
  loan_type: LoanType;
  currency?: string;
  principal_sanctioned: number;
  principal_disbursed: number;
  disbursement_date: string;
  emi_start_date: string;
  emi_day_of_month: number;
  interest_rate_pa: number;
  interest_type: InterestType;
  interest_method?: InterestMethod;
  tenure_months: number;
  emi_amount?: number;
  repayment_mode?: RepaymentMode;
  processing_fee?: number;
  stamp_duty?: number;
  insurance_premium?: number;
  prepayment_charge_pct_early?: number;
  prepayment_charge_pct_late?: number;
  prepayment_charge_threshold_emis?: number;
  foreclosure_waiver_months?: number;
  foreclosure_waiver_min_amount?: number;
  penal_rate_pa?: number;
  penal_rate_cap_pa?: number;
  gst_pct?: number;
  notes?: string;
  account_label?: string;
}

// ─── Create ───────────────────────────────────────────────

export async function createLoan(input: CreateLoanInput): Promise<string> {
  const db = getDatabase();

  const emi =
    input.emi_amount && input.emi_amount > 0
      ? input.emi_amount
      : computeEMI(input.principal_disbursed, input.interest_rate_pa, input.tenure_months);

  // v17.6.0 — prefer user-entered bank account number over agreement_id for
  // financial_accounts.account_identifier. This is the field SMS matching uses.
  const acctIdDigits = (input.account_identifier ?? "").replace(/\D/g, "");
  const resolvedIdentifier =
    acctIdDigits.length > 0
      ? acctIdDigits
      : input.agreement_id ?? `loan-${Date.now().toString().slice(-6)}`;

  // v17.6.0 — dedup Tier 1: exact (bank_name, account_identifier) match on
  // another loan-type FA. If found, reuse that FA instead of creating a new
  // one — silently merges an SMS-auto-created loan card into the manually
  // added loan. Skip the placeholder identifier class (loan-<timestamp>).
  const placeholderRegex = /^loan-\d+$/;
  let financialAccountId: string | null = null;
  if (!placeholderRegex.test(resolvedIdentifier)) {
    const existing = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM financial_accounts
        WHERE user_id = ?
          AND is_active = 1
          AND account_type = 'loan'
          AND LOWER(TRIM(bank_name)) = LOWER(TRIM(?))
          AND account_identifier = ?
        ORDER BY created_at ASC
        LIMIT 1;`,
      input.user_id,
      input.bank_name,
      resolvedIdentifier,
    );
    // Only reuse when it's not already bound to another loan_accounts row —
    // otherwise we'd attach a second loan to a single FA.
    if (existing) {
      const alreadyBound = await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM loan_accounts WHERE financial_account_id = ? LIMIT 1;",
        existing.id,
      );
      if (!alreadyBound) {
        financialAccountId = existing.id;
        // Refresh label to the user-chosen one, since the SMS-created FA
        // would've had an auto-generated label.
        if (input.account_label) {
          await db.runAsync(
            "UPDATE financial_accounts SET account_label = ?, updated_at = datetime('now') WHERE id = ?;",
            input.account_label,
            existing.id,
          );
        }
      }
    }
  }

  // No exact-match reuse → create the FA row fresh.
  if (!financialAccountId) {
    financialAccountId = await createManualAccount({
      userId: input.user_id,
      bankName: input.bank_name,
      accountType: "loan",
      accountIdentifier: resolvedIdentifier,
      accountLabel: input.account_label ?? `${input.bank_name} ${input.loan_type}`,
      initialBalance: input.principal_disbursed,
    });
  }

  // 2. Create the loan_accounts row
  const loanId = generateUUID();
  const now = new Date().toISOString();
  const currency = input.currency ?? "INR";
  const roundMode: "rupee" | "paise" = currency === "INR" ? "rupee" : "paise";
  await db.runAsync(
    `INSERT INTO loan_accounts (
      id, financial_account_id, agreement_id, loan_type, currency,
      principal_sanctioned, principal_disbursed, disbursement_date, emi_start_date, emi_day_of_month,
      interest_rate_pa, interest_type, interest_method, tenure_months, emi_amount,
      repayment_mode, processing_fee, stamp_duty, insurance_premium,
      prepayment_charge_pct_early, prepayment_charge_pct_late, prepayment_charge_threshold_emis,
      foreclosure_waiver_months, foreclosure_waiver_min_amount,
      penal_rate_pa, penal_rate_cap_pa, gst_pct, status, notes, round_mode, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    loanId,
    financialAccountId,
    input.agreement_id ?? null,
    input.loan_type,
    currency,
    input.principal_sanctioned,
    input.principal_disbursed,
    input.disbursement_date,
    input.emi_start_date,
    input.emi_day_of_month,
    input.interest_rate_pa,
    input.interest_type,
    input.interest_method ?? "reducing",
    input.tenure_months,
    emi,
    input.repayment_mode ?? null,
    input.processing_fee ?? 0,
    input.stamp_duty ?? 0,
    input.insurance_premium ?? 0,
    input.prepayment_charge_pct_early ?? 0,
    input.prepayment_charge_pct_late ?? 0,
    input.prepayment_charge_threshold_emis ?? null,
    input.foreclosure_waiver_months ?? null,
    input.foreclosure_waiver_min_amount ?? null,
    input.penal_rate_pa ?? 0,
    input.penal_rate_cap_pa ?? 0,
    input.gst_pct ?? 18,
    "active",
    input.notes ?? null,
    roundMode,
    now,
    now,
  );

  // 3. Generate + insert the amortization schedule
  const params: LoanParams = {
    principal_disbursed: input.principal_disbursed,
    interest_rate_pa: input.interest_rate_pa,
    tenure_months: input.tenure_months,
    emi_amount: emi,
    disbursement_date: input.disbursement_date,
    emi_start_date: input.emi_start_date,
    emi_day_of_month: input.emi_day_of_month,
    interest_method: input.interest_method ?? "reducing",
    round_mode: roundMode,
  };
  const schedule = generateSchedule(params);
  await batchInsertScheduleEntries(db, loanId, schedule);

  bumpDataVersion();
  return loanId;
}

/**
 * Bulk-insert schedule entries in chunks of 50 to amortize fsync cost.
 * Caller owns transaction boundaries.
 */
async function batchInsertScheduleEntries(
  db: ReturnType<typeof getDatabase>,
  loanId: string,
  schedule: ScheduleEntry[],
): Promise<void> {
  const CHUNK = 50;
  for (let i = 0; i < schedule.length; i += CHUNK) {
    const chunk = schedule.slice(i, i + CHUNK);
    const placeholders = chunk
      .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .join(", ");
    const values: (string | number | null)[] = [];
    for (const entry of chunk) {
      values.push(
        entry.id,
        loanId,
        entry.installment_num,
        entry.due_date,
        entry.opening_principal,
        entry.emi_amount,
        entry.principal_component,
        entry.interest_component,
        entry.closing_principal,
        entry.status,
      );
    }
    await db.runAsync(
      `INSERT INTO loan_schedule_entries (
        id, loan_account_id, installment_num, due_date, opening_principal, emi_amount,
        principal_component, interest_component, closing_principal, status
      ) VALUES ${placeholders};`,
      ...values,
    );
  }
}

// ─── Read ─────────────────────────────────────────────────

export async function getLoanById(id: string): Promise<LoanAccount | null> {
  const db = getDatabase();
  return db.getFirstAsync<LoanAccount>(
    "SELECT * FROM loan_accounts WHERE id = ?;",
    id,
  );
}

export async function getLoanByFinancialAccountId(
  financialAccountId: string,
): Promise<LoanAccount | null> {
  const db = getDatabase();
  return db.getFirstAsync<LoanAccount>(
    "SELECT * FROM loan_accounts WHERE financial_account_id = ?;",
    financialAccountId,
  );
}

export async function listActiveLoans(userId: string): Promise<LoanAccount[]> {
  const db = getDatabase();
  return db.getAllAsync<LoanAccount>(
    `SELECT la.* FROM loan_accounts la
     JOIN financial_accounts fa ON fa.id = la.financial_account_id
     WHERE fa.user_id = ? AND la.status = 'active'
     ORDER BY la.created_at DESC;`,
    userId,
  );
}

export async function listAllLoans(userId: string): Promise<LoanAccount[]> {
  const db = getDatabase();
  return db.getAllAsync<LoanAccount>(
    `SELECT la.* FROM loan_accounts la
     JOIN financial_accounts fa ON fa.id = la.financial_account_id
     WHERE fa.user_id = ?
     ORDER BY la.created_at DESC;`,
    userId,
  );
}

/**
 * v17.5.2 — one-query list of all loans joined with their bank names.
 * Replaces the N+1 pattern on /goals/loans (listAllLoans + per-loan
 * SELECT bank_name).
 */
export async function listAllLoansWithBankName(
  userId: string,
): Promise<Array<LoanAccount & { bank_name: string }>> {
  const db = getDatabase();
  return db.getAllAsync<LoanAccount & { bank_name: string }>(
    `SELECT la.*, fa.bank_name FROM loan_accounts la
     JOIN financial_accounts fa ON fa.id = la.financial_account_id
     WHERE fa.user_id = ?
     ORDER BY la.created_at DESC;`,
    userId,
  );
}

export async function getSchedule(loanId: string): Promise<LoanScheduleEntry[]> {
  const db = getDatabase();
  return db.getAllAsync<LoanScheduleEntry>(
    "SELECT * FROM loan_schedule_entries WHERE loan_account_id = ? ORDER BY installment_num ASC;",
    loanId,
  );
}

export async function getPrepayments(loanId: string): Promise<LoanPrepaymentRow[]> {
  const db = getDatabase();
  return db.getAllAsync<LoanPrepaymentRow>(
    "SELECT * FROM loan_prepayments WHERE loan_account_id = ? ORDER BY prepayment_date ASC;",
    loanId,
  );
}

export async function getCorrections(loanId: string): Promise<LoanCorrectionRow[]> {
  const db = getDatabase();
  return db.getAllAsync<LoanCorrectionRow>(
    "SELECT * FROM loan_corrections WHERE loan_account_id = ? ORDER BY effective_date ASC;",
    loanId,
  );
}

/**
 * Get active (non-deleted) corrections for a loan.
 * Used by the loan engine to determine the latest valid correction.
 */
export async function getActiveCorrections(loanId: string): Promise<LoanCorrectionRow[]> {
  const db = getDatabase();
  return db.getAllAsync<LoanCorrectionRow>(
    "SELECT * FROM loan_corrections WHERE loan_account_id = ? AND deleted_at IS NULL ORDER BY effective_date DESC;",
    loanId,
  );
}

/**
 * Soft delete a correction (set deleted_at timestamp).
 * Allows historical corrections to be preserved but excluded from active calculations.
 */
export async function deactivateCorrection(correctionId: string): Promise<void> {
  const db = getDatabase();
  const existing = await db.getFirstAsync<LoanCorrectionRow>(
    "SELECT * FROM loan_corrections WHERE id = ?;",
    correctionId,
  );
  if (!existing) return;

  try {
    await db.runAsync(
      "UPDATE loan_corrections SET deleted_at = datetime('now') WHERE id = ?;",
      correctionId,
    );
    await rebuildLoanSchedule(existing.loan_account_id);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Deactivate correction — ${reason}`);
  }
  try {
    const { onLoanPrepayment } = await import("./yearly-plan");
    await onLoanPrepayment(existing.loan_account_id);
  } catch (e) {
    logger.warn("onLoanPrepayment bucket recompute failed (non-fatal)", e);
  }
  bumpDataVersion();
}

/**
 * v17.5.9 — batched schedule-entry fetch for N loans in one query.
 * Replaces the per-loan `getSchedule` fan-out on the Yearly Plan screen.
 */
export async function getSchedulesByLoanIds(
  loanIds: readonly string[],
): Promise<Map<string, LoanScheduleEntry[]>> {
  const out = new Map<string, LoanScheduleEntry[]>();
  if (loanIds.length === 0) return out;
  const db = getDatabase();
  const placeholders = loanIds.map(() => "?").join(",");
  const rows = await db.getAllAsync<LoanScheduleEntry>(
    `SELECT * FROM loan_schedule_entries
     WHERE loan_account_id IN (${placeholders})
     ORDER BY loan_account_id ASC, installment_num ASC;`,
    ...loanIds,
  );
  for (const id of loanIds) out.set(id, []);
  for (const row of rows) {
    const bucket = out.get(row.loan_account_id);
    if (bucket) bucket.push(row);
  }
  return out;
}

/**
 * v17.5.9 — batched prepayment fetch for N loans in one query.
 */
export async function getPrepaymentsByLoanIds(
  loanIds: readonly string[],
): Promise<Map<string, LoanPrepaymentRow[]>> {
  const out = new Map<string, LoanPrepaymentRow[]>();
  if (loanIds.length === 0) return out;
  const db = getDatabase();
  const placeholders = loanIds.map(() => "?").join(",");
  const rows = await db.getAllAsync<LoanPrepaymentRow>(
    `SELECT * FROM loan_prepayments
     WHERE loan_account_id IN (${placeholders})
     ORDER BY loan_account_id ASC, prepayment_date ASC;`,
    ...loanIds,
  );
  for (const id of loanIds) out.set(id, []);
  for (const row of rows) {
    const bucket = out.get(row.loan_account_id);
    if (bucket) bucket.push(row);
  }
  return out;
}

/**
 * Live outstanding principal for a loan as of a given date.
 * Uses the engine's computeOutstandingAt. Returns 0 for unknown loan.
 */
export async function getLoanOutstandingAt(
  loanId: string,
  asOfDate: string,
): Promise<number> {
  const loan = await getLoanById(loanId);
  if (!loan) return 0;
  const [schedule, prepayments, corrections] = await Promise.all([
    getSchedule(loanId),
    getPrepayments(loanId),
    getCorrections(loanId),
  ]);
  return computeOutstandingAt(
    toScheduleEngineType(schedule),
    toPrepaymentEngineType(prepayments),
    asOfDate,
    loan.principal_disbursed,
    toCorrectionEngineType(corrections),
  );
}

/**
 * v17.5.2 — native-currency outstandings keyed by loan id. Used by list
 * screens that render native currency (no FX conversion). Batches the
 * schedule+prepayment reads via IN-clause queries.
 */
export async function getLoanOutstandingsByLoanId(
  userId: string,
  asOfDate: string,
): Promise<Map<string, number>> {
  const db = getDatabase();
  const loans = await db.getAllAsync<{
    id: string;
    principal_disbursed: number;
  }>(
    `SELECT la.id, la.principal_disbursed
     FROM loan_accounts la
     JOIN financial_accounts fa ON fa.id = la.financial_account_id
     WHERE fa.user_id = ?;`,
    userId,
  );
  if (loans.length === 0) return new Map();

  const ids = loans.map((l) => l.id);
  const placeholders = ids.map(() => "?").join(",");
  const [schedules, prepayments, corrections] = await Promise.all([
    db.getAllAsync<LoanScheduleEntry>(
      `SELECT * FROM loan_schedule_entries
       WHERE loan_account_id IN (${placeholders})
       ORDER BY loan_account_id ASC, installment_num ASC;`,
      ...ids,
    ),
    db.getAllAsync<LoanPrepaymentRow>(
      `SELECT * FROM loan_prepayments
       WHERE loan_account_id IN (${placeholders})
       ORDER BY loan_account_id ASC, prepayment_date ASC;`,
      ...ids,
    ),
    db.getAllAsync<LoanCorrectionRow>(
      `SELECT * FROM loan_corrections
       WHERE loan_account_id IN (${placeholders})
       ORDER BY loan_account_id ASC, effective_date ASC;`,
      ...ids,
    ),
  ]);

  const schedByLoan = new Map<string, LoanScheduleEntry[]>();
  for (const s of schedules) {
    const arr = schedByLoan.get(s.loan_account_id) ?? [];
    arr.push(s);
    schedByLoan.set(s.loan_account_id, arr);
  }
  const prepayByLoan = new Map<string, LoanPrepaymentRow[]>();
  for (const p of prepayments) {
    const arr = prepayByLoan.get(p.loan_account_id) ?? [];
    arr.push(p);
    prepayByLoan.set(p.loan_account_id, arr);
  }
  const correctionsByLoan = new Map<string, LoanCorrectionRow[]>();
  for (const c of corrections) {
    const arr = correctionsByLoan.get(c.loan_account_id) ?? [];
    arr.push(c);
    correctionsByLoan.set(c.loan_account_id, arr);
  }

  const map = new Map<string, number>();
  for (const loan of loans) {
    map.set(
      loan.id,
      computeOutstandingAt(
        toScheduleEngineType(schedByLoan.get(loan.id) ?? []),
        toPrepaymentEngineType(prepayByLoan.get(loan.id) ?? []),
        asOfDate,
        loan.principal_disbursed,
        toCorrectionEngineType(correctionsByLoan.get(loan.id) ?? []),
      ),
    );
  }
  return map;
}

/**
 * v17.5.5 — "Current" EMI per loan = the EMI on the next scheduled
 * installment (the one the user will pay next). Reflects post-prepayment
 * reductions. Falls back to the most recent installment on or before
 * asOfDate (useful for loans where user hasn't kept the schedule
 * up-to-date). Caller can default to `loan.emi_amount` for loans not in
 * the map.
 */
export async function getCurrentEMIsByLoanId(
  userId: string,
  asOfDate: string,
): Promise<Map<string, number>> {
  const db = getDatabase();
  const loans = await db.getAllAsync<{ id: string }>(
    `SELECT la.id FROM loan_accounts la
     JOIN financial_accounts fa ON fa.id = la.financial_account_id
     WHERE fa.user_id = ?;`,
    userId,
  );
  if (loans.length === 0) return new Map();
  const ids = loans.map((l) => l.id);
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.getAllAsync<{
    loan_account_id: string;
    emi_amount: number;
    due_date: string;
    status: string;
  }>(
    `SELECT loan_account_id, emi_amount, due_date, status
     FROM loan_schedule_entries
     WHERE loan_account_id IN (${placeholders})
     ORDER BY loan_account_id ASC, installment_num ASC;`,
    ...ids,
  );
  const byLoan = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byLoan.get(r.loan_account_id) ?? [];
    arr.push(r);
    byLoan.set(r.loan_account_id, arr);
  }
  const map = new Map<string, number>();
  for (const [loanId, list] of byLoan) {
    // Prefer the next scheduled installment on or after asOfDate.
    const upcoming = list.find(
      (r) => r.status === "scheduled" && r.due_date >= asOfDate,
    );
    if (upcoming) {
      map.set(loanId, upcoming.emi_amount);
      continue;
    }
    // Fallback: last installment within asOfDate (captures closed loans too).
    const lastInRange = list
      .filter((r) => r.due_date <= asOfDate)
      .pop();
    if (lastInRange) {
      map.set(loanId, lastInRange.emi_amount);
    }
  }
  return map;
}

/**
 * Get all live loan outstandings as of a date, indexed by financial_account_id.
 * Used by balance-sheet to replace the last_known_balance scalar.
 */
export async function getLoanOutstandingsByFA(
  userId: string,
  asOfDate: string,
): Promise<Map<string, number>> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{
    financial_account_id: string;
    id: string;
    principal_disbursed: number;
    currency: string;
    fx_rate: number | null;
  }>(
    `SELECT la.id, la.financial_account_id, la.principal_disbursed, la.currency, la.fx_rate
     FROM loan_accounts la
     JOIN financial_accounts fa ON fa.id = la.financial_account_id
     WHERE fa.user_id = ?;`,
    userId,
  );
  if (rows.length === 0) return new Map();

  // v17.5.2 — batch schedule+prepayment reads via IN-clause (was N+1).
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const [schedules, prepayments, corrections] = await Promise.all([
    db.getAllAsync<LoanScheduleEntry>(
      `SELECT * FROM loan_schedule_entries
       WHERE loan_account_id IN (${placeholders})
       ORDER BY loan_account_id ASC, installment_num ASC;`,
      ...ids,
    ),
    db.getAllAsync<LoanPrepaymentRow>(
      `SELECT * FROM loan_prepayments
       WHERE loan_account_id IN (${placeholders})
       ORDER BY loan_account_id ASC, prepayment_date ASC;`,
      ...ids,
    ),
    db.getAllAsync<LoanCorrectionRow>(
      `SELECT * FROM loan_corrections
       WHERE loan_account_id IN (${placeholders})
       ORDER BY loan_account_id ASC, effective_date ASC;`,
      ...ids,
    ),
  ]);
  const schedByLoan = new Map<string, LoanScheduleEntry[]>();
  for (const s of schedules) {
    const arr = schedByLoan.get(s.loan_account_id) ?? [];
    arr.push(s);
    schedByLoan.set(s.loan_account_id, arr);
  }
  const prepayByLoan = new Map<string, LoanPrepaymentRow[]>();
  for (const p of prepayments) {
    const arr = prepayByLoan.get(p.loan_account_id) ?? [];
    arr.push(p);
    prepayByLoan.set(p.loan_account_id, arr);
  }
  const correctionsByLoan = new Map<string, LoanCorrectionRow[]>();
  for (const c of corrections) {
    const arr = correctionsByLoan.get(c.loan_account_id) ?? [];
    arr.push(c);
    correctionsByLoan.set(c.loan_account_id, arr);
  }

  const map = new Map<string, number>();
  for (const row of rows) {
    const outstanding = computeOutstandingAt(
      toScheduleEngineType(schedByLoan.get(row.id) ?? []),
      toPrepaymentEngineType(prepayByLoan.get(row.id) ?? []),
      asOfDate,
      row.principal_disbursed,
      toCorrectionEngineType(correctionsByLoan.get(row.id) ?? []),
    );
    // v17.3.0 — convert to INR if currency isn't INR and a fx_rate is set.
    // Balance Sheet is INR-total only; non-INR loans without a rate stay
    // visible on the account detail (native currency) but don't contribute
    // to the Balance Sheet total.
    const outstandingInr =
      row.currency === "INR"
        ? outstanding
        : row.fx_rate && row.fx_rate > 0
          ? outstanding * row.fx_rate
          : 0;
    map.set(row.financial_account_id, outstandingInr);
  }
  return map;
}

export interface LoansSummary {
  activeCount: number;
  totalOutstandingINR: number;
  totalMonthlyEMI: number;
  nonInrCount: number;
  nextDue: { loanId: string; bankName: string; dueDate: string; amount: number } | null;
}

/**
 * Summary for Home card: next EMI due + total outstanding.
 * Returns null when no active loans.
 */
export async function getLoansSummary(
  userId: string,
): Promise<LoansSummary | null> {
  const loans = await listActiveLoans(userId);
  if (loans.length === 0) return null;

  const today = new Date().toISOString().split("T")[0];
  const db = getDatabase();
  let totalOutstandingINR = 0;
  let totalMonthlyEMI = 0;
  let nonInrCount = 0;
  let nextDue: { loanId: string; bankName: string; dueDate: string; amount: number } | null = null;

  for (const loan of loans) {
    const outstanding = await getLoanOutstandingAt(loan.id, today);
    if (loan.currency === "INR") {
      totalOutstandingINR += outstanding;
    } else {
      nonInrCount++;
    }
    const nextScheduled = await db.getFirstAsync<{
      due_date: string;
      emi_amount: number;
    }>(
      `SELECT due_date, emi_amount FROM loan_schedule_entries
       WHERE loan_account_id = ? AND status = 'scheduled' AND due_date >= ?
       ORDER BY due_date ASC LIMIT 1;`,
      loan.id,
      today,
    );
    if (nextScheduled) {
      if (loan.currency === "INR") {
        totalMonthlyEMI += nextScheduled.emi_amount;
      }
      if (!nextDue || nextScheduled.due_date < nextDue.dueDate) {
        const fa = await db.getFirstAsync<{ bank_name: string }>(
          "SELECT bank_name FROM financial_accounts WHERE id = ?;",
          loan.financial_account_id,
        );
        nextDue = {
          loanId: loan.id,
          bankName: fa?.bank_name ?? "Loan",
          dueDate: nextScheduled.due_date,
          amount: nextScheduled.emi_amount,
        };
      }
    }
  }

  return {
    activeCount: loans.length,
    totalOutstandingINR,
    totalMonthlyEMI,
    nonInrCount,
    nextDue,
  };
}

// ─── Update / Delete (v17.0.0 — minimal) ──────────────────

export async function closeLoan(id: string, closedDate: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "UPDATE loan_accounts SET status = 'closed', closed_date = ?, updated_at = datetime('now') WHERE id = ?;",
    closedDate,
    id,
  );
  bumpDataVersion();
}

// ─── Backfill paid EMIs (v17.5.0) ──────────────────────────

/**
 * Mark the first N installments as already-paid. Used when user adds a loan
 * that's already mid-way through its tenure — avoids Artha thinking the full
 * principal is still owed.
 *
 * No-op for N=0. Clamps to the loan's tenure. Updates paid_date/paid_amount
 * from the schedule's due_date/emi_amount (no linked expense — these EMIs
 * happened before Artha tracked them).
 *
 * Idempotent: if the first N already show as paid, the UPDATE is a no-op.
 */
export async function backfillPaidInstallments(
  loanId: string,
  paidCount: number,
): Promise<void> {
  if (paidCount <= 0) return;
  const db = getDatabase();
  await db.runAsync(
    `UPDATE loan_schedule_entries
     SET status = 'paid', paid_date = due_date, paid_amount = emi_amount
     WHERE loan_account_id = ?
       AND installment_num <= ?
       AND status = 'scheduled';`,
    loanId,
    paidCount,
  );
  bumpDataVersion();
}

// ─── Update loan (v17.5.0) ─────────────────────────────────

/**
 * Update a loan's parameters. If amortization-affecting fields change
 * (principal_disbursed, interest_rate_pa, tenure_months, emi_amount,
 * disbursement_date, emi_start_date, emi_day_of_month, interest_method),
 * the full schedule is regenerated — existing paid/prepaid installments
 * are preserved (rebuilt with their paid status).
 */
export async function updateLoan(
  loanId: string,
  input: Partial<CreateLoanInput>,
): Promise<void> {
  const db = getDatabase();
  const existing = await getLoanById(loanId);
  if (!existing) throw new Error(`Loan ${loanId} not found`);

  const scheduleFields: (keyof CreateLoanInput)[] = [
    "principal_disbursed",
    "interest_rate_pa",
    "tenure_months",
    "emi_amount",
    "disbursement_date",
    "emi_start_date",
    "emi_day_of_month",
    "interest_method",
  ];
  const scheduleAffected = scheduleFields.some(
    (f) => input[f] !== undefined && input[f] !== (existing as unknown as Record<string, unknown>)[f],
  );

  // Dynamic UPDATE
  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  const mapping: Array<[keyof CreateLoanInput, string]> = [
    ["bank_name", "bank_name"], // bank_name lives on financial_accounts, handled below
    ["agreement_id", "agreement_id"],
    ["loan_type", "loan_type"],
    ["currency", "currency"],
    ["principal_sanctioned", "principal_sanctioned"],
    ["principal_disbursed", "principal_disbursed"],
    ["disbursement_date", "disbursement_date"],
    ["emi_start_date", "emi_start_date"],
    ["emi_day_of_month", "emi_day_of_month"],
    ["interest_rate_pa", "interest_rate_pa"],
    ["interest_type", "interest_type"],
    ["interest_method", "interest_method"],
    ["tenure_months", "tenure_months"],
    ["emi_amount", "emi_amount"],
    ["repayment_mode", "repayment_mode"],
    ["processing_fee", "processing_fee"],
    ["stamp_duty", "stamp_duty"],
    ["insurance_premium", "insurance_premium"],
    ["prepayment_charge_pct_early", "prepayment_charge_pct_early"],
    ["prepayment_charge_pct_late", "prepayment_charge_pct_late"],
    ["prepayment_charge_threshold_emis", "prepayment_charge_threshold_emis"],
    ["foreclosure_waiver_months", "foreclosure_waiver_months"],
    ["foreclosure_waiver_min_amount", "foreclosure_waiver_min_amount"],
    ["penal_rate_pa", "penal_rate_pa"],
    ["penal_rate_cap_pa", "penal_rate_cap_pa"],
    ["gst_pct", "gst_pct"],
    ["notes", "notes"],
  ];
  for (const [inputKey, dbCol] of mapping) {
    if (inputKey === "bank_name") continue; // handled separately (FA column)
    // v17.6.0 — account_identifier + account_label also live on financial_accounts
    if (inputKey === "account_identifier" || inputKey === "account_label") continue;
    const v = input[inputKey];
    if (v !== undefined) {
      updates.push(`${dbCol} = ?`);
      values.push(v as string | number | null);
    }
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    values.push(loanId);
    await db.runAsync(
      `UPDATE loan_accounts SET ${updates.join(", ")} WHERE id = ?;`,
      ...values,
    );
  }

  // Mirror bank_name + account_label + account_identifier onto financial_accounts.
  // v17.6.0 — account_identifier now takes precedence over agreement_id for
  // the FA's identifier (SMS matching uses it). Only fall back to agreement_id
  // if account_identifier wasn't supplied this edit.
  if (
    input.bank_name !== undefined ||
    input.account_label !== undefined ||
    input.account_identifier !== undefined ||
    input.agreement_id !== undefined
  ) {
    const faUpdates: string[] = [];
    const faValues: (string | number | null)[] = [];
    if (input.bank_name !== undefined) {
      faUpdates.push("bank_name = ?");
      faValues.push(input.bank_name);
    }
    if (input.account_label !== undefined) {
      faUpdates.push("account_label = ?");
      faValues.push(input.account_label);
    }
    if (input.account_identifier !== undefined) {
      const acctIdDigits = input.account_identifier.replace(/\D/g, "");
      faUpdates.push("account_identifier = ?");
      faValues.push(
        acctIdDigits.length > 0
          ? acctIdDigits
          : input.agreement_id || `loan-${Date.now().toString().slice(-6)}`,
      );
    } else if (input.agreement_id !== undefined) {
      faUpdates.push("account_identifier = ?");
      faValues.push(input.agreement_id || `loan-${Date.now().toString().slice(-6)}`);
    }
    if (faUpdates.length > 0) {
      faUpdates.push("updated_at = datetime('now')");
      faValues.push(existing.financial_account_id);
      await db.runAsync(
        `UPDATE financial_accounts SET ${faUpdates.join(", ")} WHERE id = ?;`,
        ...faValues,
      );
    }
  }

  // Regenerate schedule if amortization-affecting fields changed
  if (scheduleAffected) {
    const updated = await getLoanById(loanId);
    if (!updated) throw new Error(`Loan ${loanId} vanished mid-update`);
    const currentSchedule = await getSchedule(loanId);
    const paidCount = currentSchedule.filter(
      (e) => e.status === "paid" || e.status === "prepaid",
    ).length;

    const newSchedule = generateSchedule(loanToParams(updated));

    await db.withTransactionAsync(async () => {
      await db.runAsync(
        "DELETE FROM loan_schedule_entries WHERE loan_account_id = ?;",
        loanId,
      );
      await batchInsertScheduleEntries(db, loanId, newSchedule);
    });

    // Restore paid status on the first `paidCount` installments
    if (paidCount > 0) {
      await backfillPaidInstallments(loanId, paidCount);
    }
  }

  bumpDataVersion();
}

/**
 * v17.6.0 — regenerate amortization schedule from loan params, wiping any
 * existing rows. Used by the import-schedule "Revert" flow to drop a
 * manual-CSV schedule and rebuild the engine-computed one.
 *
 * Preserves paid/prepaid count from the previous schedule (same approach as
 * updateLoan's scheduleAffected branch). The caller should have flipped
 * `schedule_source` back to `'generated'` via revertToGeneratedSchedule
 * BEFORE calling this — otherwise the loan is still manual_csv and
 * rebuildLoanSchedule (called indirectly by prepayments/corrections later)
 * would no-op again.
 */
export async function regenerateScheduleFromParams(loanId: string): Promise<void> {
  const db = getDatabase();
  const loan = await getLoanById(loanId);
  if (!loan) throw new Error(`Loan ${loanId} not found`);
  const currentSchedule = await getSchedule(loanId);
  const paidCount = currentSchedule.filter(
    (e) => e.status === "paid" || e.status === "prepaid",
  ).length;
  const newSchedule = generateSchedule(loanToParams(loan));
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "DELETE FROM loan_schedule_entries WHERE loan_account_id = ?;",
      loanId,
    );
    await batchInsertScheduleEntries(db, loanId, newSchedule);
  });
  if (paidCount > 0) await backfillPaidInstallments(loanId, paidCount);
  bumpDataVersion();
}

// ─── Hard delete loan (v17.5.0) ────────────────────────────

/**
 * Full delete of a loan: wipes loan_accounts row + cascades to schedule +
 * prepayments + expense_loan_links (all via FK CASCADE), and also deletes
 * the underlying financial_accounts row (so the loan disappears from
 * Account Master). Linked expenses stay intact — their loan-link row is
 * cascade-deleted but the expenses themselves are preserved.
 */
export async function deleteLoanFully(loanId: string): Promise<void> {
  const db = getDatabase();
  const loan = await getLoanById(loanId);
  if (!loan) return;

  await db.withTransactionAsync(async () => {
    // Clear any expense_loan_links that would block via FK (ON DELETE CASCADE
    // handles expense_id side, but let's be explicit about the loan side).
    await db.runAsync(
      "DELETE FROM expense_loan_links WHERE loan_account_id = ?;",
      loanId,
    );

    // Clear any investment_buckets linked_loan_account_id pointers (v17.3.0).
    await db.runAsync(
      "UPDATE investment_buckets SET linked_loan_account_id = NULL WHERE linked_loan_account_id = ?;",
      loanId,
    );

    // CASCADE drops schedule + prepayments via the loan_accounts row.
    await db.runAsync("DELETE FROM loan_accounts WHERE id = ?;", loanId);

    // Drop the financial_accounts shell too.
    await db.runAsync(
      "DELETE FROM financial_accounts WHERE id = ?;",
      loan.financial_account_id,
    );
  });

  bumpDataVersion();
}

// ─── Prepayment (v17.1.0 entry point, helper exposed for v17.0.0 tests) ───

export async function recordPrepayment(
  loanId: string,
  params: {
    prepayment_date: string;
    amount: number;
    prepayment_charge: number;
    gst_on_charge: number;
    kind: "part_payment" | "foreclosure";
    strategy?: "reduce_tenure" | "reduce_emi";
    linked_expense_id?: string;
    notes?: string;
  },
): Promise<string> {
  const db = getDatabase();
  const loan = await getLoanById(loanId);
  if (!loan) throw new Error("Loan not found");

  const id = generateUUID();
  try {
    await recordPrepaymentInner(db, loan, id, params);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Record prepayment — ${reason}`);
  }

  // v17.3.0 — recompute any debt-payoff buckets tracking this loan
  try {
    const { onLoanPrepayment } = await import("./yearly-plan");
    await onLoanPrepayment(loanId);
  } catch (e) {
    logger.warn("onLoanPrepayment bucket recompute failed (non-fatal)", e);
  }

  bumpDataVersion();
  return id;
}

async function recordPrepaymentInner(
  db: ReturnType<typeof getDatabase>,
  loan: LoanAccount,
  id: string,
  params: {
    prepayment_date: string;
    amount: number;
    prepayment_charge: number;
    gst_on_charge: number;
    kind: "part_payment" | "foreclosure";
    strategy?: "reduce_tenure" | "reduce_emi";
    linked_expense_id?: string;
    notes?: string;
  },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO loan_prepayments (
      id, loan_account_id, prepayment_date, amount, prepayment_charge, gst_on_charge,
      kind, strategy, linked_expense_id, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'));`,
    id,
    loan.id,
    params.prepayment_date,
    params.amount,
    params.prepayment_charge,
    params.gst_on_charge,
    params.kind,
    params.strategy ?? null,
    params.linked_expense_id ?? null,
    params.notes ?? null,
  );

  // Full schedule rebuild — replays every prepayment AND every manual
  // correction in date order so corrections and new prepayments can
  // coexist cleanly.
  await rebuildLoanSchedule(loan.id);

  // Foreclosure auto-closes the loan
  if (params.kind === "foreclosure") {
    await db.runAsync(
      "UPDATE loan_accounts SET status = 'foreclosed', closed_date = ?, updated_at = datetime('now') WHERE id = ?;",
      params.prepayment_date,
      loan.id,
    );
  }
}

// ─── Update / Delete prepayment (v17.5.1) ─────────────────

/**
 * Update an existing prepayment row, then fully rebuild the schedule from
 * scratch by replaying every remaining prepayment in date order.
 *
 * A fresh rebuild is used (instead of incremental patching like
 * `recordPrepayment`) because editing a prepayment can shift other
 * prepayments' remaining-EMI context, changing the strategy-driven
 * tail in ways that in-place updates can't represent cleanly.
 *
 * Only the prepayment row's params change; schedule-entry rows with
 * status 'paid' or 'prepaid' are preserved (re-stamped as paid on the
 * regenerated schedule's first N installments).
 */
export async function updatePrepayment(
  prepaymentId: string,
  params: {
    prepayment_date: string;
    amount: number;
    prepayment_charge: number;
    gst_on_charge: number;
    strategy?: "reduce_tenure" | "reduce_emi";
  },
): Promise<void> {
  const db = getDatabase();
  const existing = await db.getFirstAsync<LoanPrepaymentRow>(
    "SELECT * FROM loan_prepayments WHERE id = ?;",
    prepaymentId,
  );
  if (!existing) throw new Error("Prepayment not found");

  try {
    await db.runAsync(
      `UPDATE loan_prepayments
       SET prepayment_date = ?, amount = ?, prepayment_charge = ?, gst_on_charge = ?, strategy = ?
       WHERE id = ?;`,
      params.prepayment_date,
      params.amount,
      params.prepayment_charge,
      params.gst_on_charge,
      params.strategy ?? existing.strategy,
      prepaymentId,
    );
    await rebuildLoanSchedule(existing.loan_account_id);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Update prepayment — ${reason}`);
  }

  try {
    const { onLoanPrepayment } = await import("./yearly-plan");
    await onLoanPrepayment(existing.loan_account_id);
  } catch (e) {
    logger.warn("onLoanPrepayment bucket recompute failed (non-fatal)", e);
  }

  bumpDataVersion();
}

/**
 * Delete a prepayment row and fully rebuild the schedule from scratch
 * (replaying remaining prepayments in date order).
 *
 * If the deleted prepayment was a foreclosure, the loan is reopened
 * (status 'active', closed_date cleared).
 */
export async function deletePrepayment(prepaymentId: string): Promise<void> {
  const db = getDatabase();
  const existing = await db.getFirstAsync<LoanPrepaymentRow>(
    "SELECT * FROM loan_prepayments WHERE id = ?;",
    prepaymentId,
  );
  if (!existing) return;

  try {
    // v17.5.7 — drop expense_loan_links pointing at this prepayment BEFORE
    // the prepayment itself. The FK has ON DELETE SET NULL (doesn't crash),
    // but that leaves zombie rows where the expense still shows a "linked
    // to prepayment" badge referencing a prepayment that no longer exists.
    // Explicitly delete them so the downstream expense-detail UI shows the
    // "Mark as loan payment" action again.
    await db.runAsync(
      "DELETE FROM expense_loan_links WHERE prepayment_id = ?;",
      prepaymentId,
    );
    await db.runAsync("DELETE FROM loan_prepayments WHERE id = ?;", prepaymentId);
    if (existing.kind === "foreclosure") {
      await db.runAsync(
        "UPDATE loan_accounts SET status = 'active', closed_date = NULL, updated_at = datetime('now') WHERE id = ?;",
        existing.loan_account_id,
      );
    }
    await rebuildLoanSchedule(existing.loan_account_id);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Delete prepayment — ${reason}`);
  }

  try {
    const { onLoanPrepayment } = await import("./yearly-plan");
    await onLoanPrepayment(existing.loan_account_id);
  } catch (e) {
    logger.warn("onLoanPrepayment bucket recompute failed (non-fatal)", e);
  }

  bumpDataVersion();
}

/**
 * Rebuild a loan's schedule from scratch. Respects the full stack of
 * adjustments in the correct chronological order:
 *
 *   1. Generate a fresh amortization schedule from loan params.
 *   2. Restore paid/prepaid status on the first N installments.
 *   3. For every (correction | prepayment) event in date order:
 *      - Correction: truncate the tail, replace it with a regen based on
 *        (corrected outstanding, corrected EMI, corrected tenure).
 *      - Prepayment: apply via the engine's applyPrepayment helper.
 *   4. Preserve paid/prepaid status on any regenerated installment whose
 *      due_date matches an installment that was paid/prepaid in the
 *      previous schedule (so a correction dated before the last paid EMI
 *      doesn't silently wipe paid state on later installments).
 */
async function rebuildLoanSchedule(loanId: string): Promise<void> {
  const db = getDatabase();
  const loan = await getLoanById(loanId);
  if (!loan) throw new Error("Loan not found");

  // v17.6.0 — manual-CSV schedule is the source of truth. Skip regeneration so
  // prepayments / corrections don't overwrite the user's uploaded rows.
  // Prepayments still reduce outstanding via computeOutstandingAt's prepayment
  // branch; corrections are hidden in the UI for manual-CSV loans.
  if (loan.schedule_source === "manual_csv") return;

  const previous = await getSchedule(loanId);
  const paidCount = previous.filter(
    (e) => e.status === "paid" || e.status === "prepaid",
  ).length;

  // Capture paid/prepaid metadata by due_date from the previous schedule so
  // we can re-stamp them onto the regenerated tail if a correction moves
  // things around.
  const paidByDate = new Map<
    string,
    {
      status: "paid" | "prepaid";
      linked_expense_id: string | null;
      paid_date: string | null;
      paid_amount: number | null;
    }
  >();
  for (const e of previous) {
    if (e.status === "paid" || e.status === "prepaid") {
      paidByDate.set(e.due_date, {
        status: e.status,
        linked_expense_id: e.linked_expense_id,
        paid_date: e.paid_date,
        paid_amount: e.paid_amount,
      });
    }
  }

  // Fresh base schedule
  const freshSchedule = generateSchedule(loanToParams(loan));

  let schedule: ScheduleEntry[] = freshSchedule.map((e) => ({
    ...e,
    status: e.installment_num <= paidCount ? "paid" : "scheduled",
  }));

  // Collect and interleave corrections + prepayments by date. On ties,
  // prepayments process first so the correction reflects the post-prepay
  // baseline (matches user mental model: "I prepaid, then the bank sent
  // me this corrected outstanding").
  const prepayments = await getPrepayments(loanId);
  const corrections = await getCorrections(loanId);

  type Event =
    | { kind: "prepayment"; date: string; row: LoanPrepaymentRow }
    | { kind: "correction"; date: string; row: LoanCorrectionRow };

  const events: Event[] = [
    ...prepayments.map((p) => ({ kind: "prepayment" as const, date: p.prepayment_date, row: p })),
    ...corrections.map((c) => ({ kind: "correction" as const, date: c.effective_date, row: c })),
  ].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    // Same date: prepayment first, then correction
    return a.kind === "prepayment" ? -1 : 1;
  });

  const engineParams = loanToParams(loan);
  for (const evt of events) {
    if (evt.kind === "prepayment") {
      const p = evt.row;
      schedule = applyPrepayment(schedule, engineParams, {
        prepayment_date: p.prepayment_date,
        amount: p.amount,
        prepayment_charge: p.prepayment_charge,
        gst_on_charge: p.gst_on_charge,
        kind: p.kind,
        strategy: p.strategy ?? undefined,
      });
    } else {
      schedule = applyCorrection(schedule, loan, evt.row);
    }
  }

  // Re-stamp paid/prepaid status on any regenerated installment whose due_date
  // was paid in the previous schedule but got overwritten as "scheduled" by a
  // tail regeneration (e.g., a correction dated before the last paid EMI).
  const stamped: Array<ScheduleEntry & {
    linked_expense_id?: string | null;
    paid_date?: string | null;
    paid_amount?: number | null;
  }> = schedule.map((e) => {
    if (e.status === "scheduled") {
      const prior = paidByDate.get(e.due_date);
      if (prior) {
        return {
          ...e,
          status: prior.status,
          linked_expense_id: prior.linked_expense_id,
          paid_date: prior.paid_date,
          paid_amount: prior.paid_amount,
        };
      }
    }
    return e;
  });

  // Dedup safety-net: guard against duplicate installment_num slipping through
  // (would crash the INSERT with UNIQUE(loan_account_id, installment_num)).
  // Keep the last occurrence per installment_num, then renumber from 1.
  const byNum = new Map<number, typeof stamped[number]>();
  for (const e of stamped.sort((a, b) => a.installment_num - b.installment_num)) {
    byNum.set(e.installment_num, e);
  }
  const deduped = Array.from(byNum.values()).sort(
    (a, b) => a.installment_num - b.installment_num,
  );

  // Persist: wipe and reinsert inside a single transaction. Batch INSERTs via
  // multi-row VALUES to amortize fsync cost (120 serial inserts → 3 chunks).
  const CHUNK = 50;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "DELETE FROM loan_schedule_entries WHERE loan_account_id = ?;",
      loanId,
    );
    for (let i = 0; i < deduped.length; i += CHUNK) {
      const chunk = deduped.slice(i, i + CHUNK);
      const placeholders = chunk
        .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .join(", ");
      const values: (string | number | null)[] = [];
      for (const entry of chunk) {
        values.push(
          entry.id,
          loanId,
          entry.installment_num,
          entry.due_date,
          entry.opening_principal,
          entry.emi_amount,
          entry.principal_component,
          entry.interest_component,
          entry.closing_principal,
          entry.status,
          entry.linked_expense_id ?? null,
          entry.paid_date ?? null,
          entry.paid_amount ?? null,
        );
      }
      await db.runAsync(
        `INSERT INTO loan_schedule_entries (
          id, loan_account_id, installment_num, due_date, opening_principal, emi_amount,
          principal_component, interest_component, closing_principal, status,
          linked_expense_id, paid_date, paid_amount
        ) VALUES ${placeholders};`,
        ...values,
      );
    }
  });
}

/**
 * Apply a manual correction to a schedule: keep every installment whose
 * due_date is on or before the correction's effective_date as-is, then
 * regenerate the tail from (correction.outstanding, correction.emi,
 * correction.tenure_remaining ?? inferred-remaining).
 *
 * Interest math for the regenerated tail uses the loan's current interest
 * rate (user can't override rate via correction — rate changes are a
 * separate loan.updateLoan operation).
 */
function applyCorrection(
  schedule: ScheduleEntry[],
  loan: LoanAccount,
  correction: LoanCorrectionRow,
): ScheduleEntry[] {
  const sorted = [...schedule].sort((a, b) => a.installment_num - b.installment_num);
  const kept = sorted.filter((e) => e.due_date <= correction.effective_date);
  const lastKept = kept[kept.length - 1];
  const startNum = lastKept ? lastKept.installment_num + 1 : 1;

  const monthlyRate = loan.interest_rate_pa / 12 / 100;
  const emi = correction.emi_amount;
  // If user-supplied remaining tenure is present, honor it; otherwise use
  // a conservative cap bounded by total tenure. Validation upstream already
  // guarantees EMI > monthly interest so the loop terminates naturally.
  const keptInstallments = kept.length;
  const maxIters =
    (correction.tenure_remaining_months ?? 0) > 0
      ? correction.tenure_remaining_months!
      : Math.max(loan.tenure_months - keptInstallments, 1) + 12; // safety cushion

  const tail: ScheduleEntry[] = [];
  let opening = correction.outstanding_principal;
  let num = startNum;
  let iters = 0;

  while (opening > 0.01 && iters < maxIters) {
    iters++;
    // Due-date follows the loan's emi cadence
    const dueDate = addMonthsFromStart(
      loan.emi_start_date,
      num - 1,
      loan.emi_day_of_month,
    );
    const interest = Math.round(opening * monthlyRate * 100) / 100;
    let principalComp = Math.round((emi - interest) * 100) / 100;
    let thisEmi = emi;

    if (principalComp >= opening || iters === maxIters) {
      principalComp = Math.round(opening * 100) / 100;
      thisEmi = Math.round((principalComp + interest) * 100) / 100;
    }

    const closing = Math.max(Math.round((opening - principalComp) * 100) / 100, 0);

    tail.push({
      id: generateUUID(),
      installment_num: num,
      due_date: dueDate,
      opening_principal: Math.round(opening * 100) / 100,
      emi_amount: thisEmi,
      principal_component: principalComp,
      interest_component: interest,
      closing_principal: closing,
      status: "scheduled",
    });

    opening = closing;
    num++;
  }

  return [...kept, ...tail];
}

/** Add N calendar months to a YYYY-MM-DD preserving day-of-month when possible. */
function addMonthsFromStart(ymd: string, n: number, targetDayOfMonth: number): string {
  const [ys, ms] = ymd.split("-");
  const y = parseInt(ys, 10);
  const m = parseInt(ms, 10) - 1;
  const d = new Date(y, m + n, 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const day = Math.min(targetDayOfMonth, lastDay);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ─── Corrections CRUD (v17.5.1) ───────────────────────────

/**
 * Validate correction inputs against a loan. Throws if the values would
 * produce a non-terminating schedule or violate chronology.
 */
async function validateCorrection(
  loanId: string,
  params: {
    effective_date: string;
    outstanding_principal: number;
    emi_amount: number;
    tenure_remaining_months?: number;
  },
): Promise<void> {
  const loan = await getLoanById(loanId);
  if (!loan) throw new Error("Loan not found");

  if (params.outstanding_principal <= 0) {
    throw new Error("Outstanding principal must be greater than zero.");
  }
  if (params.emi_amount <= 0) {
    throw new Error("EMI amount must be greater than zero.");
  }
  if (params.effective_date < loan.disbursement_date) {
    throw new Error(
      `Correction date can't be before the loan was disbursed (${loan.disbursement_date}).`,
    );
  }
  // EMI must cover at least the interest-only charge or the loan never pays down.
  const monthlyInterest = (params.outstanding_principal * loan.interest_rate_pa) / 12 / 100;
  if (params.emi_amount <= monthlyInterest) {
    throw new Error(
      `EMI (${Math.round(params.emi_amount)}) must be greater than the monthly interest on the outstanding principal (${Math.round(monthlyInterest)}).`,
    );
  }
  if (params.tenure_remaining_months !== undefined) {
    if (params.tenure_remaining_months <= 0) {
      throw new Error("Remaining EMIs must be greater than zero.");
    }
    if (params.tenure_remaining_months > 600) {
      throw new Error("Remaining EMIs can't exceed 600 (50 years).");
    }
  }
}

export async function createCorrection(
  loanId: string,
  params: {
    effective_date: string;
    outstanding_principal: number;
    emi_amount: number;
    tenure_remaining_months?: number;
    reason?: string;
  },
): Promise<string> {
  await validateCorrection(loanId, params);
  const db = getDatabase();
  const id = generateUUID();
  try {
    await db.runAsync(
      `INSERT INTO loan_corrections (
        id, loan_account_id, effective_date, outstanding_principal, emi_amount,
        tenure_remaining_months, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      id,
      loanId,
      params.effective_date,
      params.outstanding_principal,
      params.emi_amount,
      params.tenure_remaining_months ?? null,
      params.reason ?? null,
    );
    await rebuildLoanSchedule(loanId);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Apply correction — ${reason}`);
  }
  try {
    const { onLoanPrepayment } = await import("./yearly-plan");
    await onLoanPrepayment(loanId);
  } catch (e) {
    logger.warn("onLoanPrepayment bucket recompute failed (non-fatal)", e);
  }
  bumpDataVersion();
  return id;
}

export async function updateCorrection(
  correctionId: string,
  params: {
    effective_date: string;
    outstanding_principal: number;
    emi_amount: number;
    tenure_remaining_months?: number;
    reason?: string;
  },
): Promise<void> {
  const db = getDatabase();
  const existing = await db.getFirstAsync<LoanCorrectionRow>(
    "SELECT * FROM loan_corrections WHERE id = ?;",
    correctionId,
  );
  if (!existing) throw new Error("Correction not found");

  await validateCorrection(existing.loan_account_id, params);

  try {
    await db.runAsync(
      `UPDATE loan_corrections
       SET effective_date = ?, outstanding_principal = ?, emi_amount = ?,
           tenure_remaining_months = ?, reason = ?, updated_at = datetime('now')
       WHERE id = ?;`,
      params.effective_date,
      params.outstanding_principal,
      params.emi_amount,
      params.tenure_remaining_months ?? null,
      params.reason ?? null,
      correctionId,
    );
    await rebuildLoanSchedule(existing.loan_account_id);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Update correction — ${reason}`);
  }
  try {
    const { onLoanPrepayment } = await import("./yearly-plan");
    await onLoanPrepayment(existing.loan_account_id);
  } catch (e) {
    logger.warn("onLoanPrepayment bucket recompute failed (non-fatal)", e);
  }
  bumpDataVersion();
}

export async function deleteCorrection(correctionId: string): Promise<void> {
  const db = getDatabase();
  const existing = await db.getFirstAsync<LoanCorrectionRow>(
    "SELECT * FROM loan_corrections WHERE id = ?;",
    correctionId,
  );
  if (!existing) return;

  try {
    await db.runAsync("DELETE FROM loan_corrections WHERE id = ?;", correctionId);
    await rebuildLoanSchedule(existing.loan_account_id);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Delete correction — ${reason}`);
  }
  try {
    const { onLoanPrepayment } = await import("./yearly-plan");
    await onLoanPrepayment(existing.loan_account_id);
  } catch (e) {
    logger.warn("onLoanPrepayment bucket recompute failed (non-fatal)", e);
  }
  bumpDataVersion();
}

// ─── Internal: DB-row → engine-type converters ────────────

function toScheduleEngineType(rows: LoanScheduleEntry[]): ScheduleEntry[] {
  return rows.map((r) => ({
    id: r.id,
    installment_num: r.installment_num,
    due_date: r.due_date,
    opening_principal: r.opening_principal,
    emi_amount: r.emi_amount,
    principal_component: r.principal_component,
    interest_component: r.interest_component,
    closing_principal: r.closing_principal,
    status: r.status,
  }));
}

function toPrepaymentEngineType(rows: LoanPrepaymentRow[]): Prepayment[] {
  return rows.map((r) => ({
    prepayment_date: r.prepayment_date,
    amount: r.amount,
    prepayment_charge: r.prepayment_charge,
    gst_on_charge: r.gst_on_charge,
    kind: r.kind,
    strategy: r.strategy ?? undefined,
  }));
}

function toCorrectionEngineType(rows: LoanCorrectionRow[]): Correction[] {
  return rows.map((r) => ({
    effective_date: r.effective_date,
    outstanding_principal: r.outstanding_principal,
  }));
}

export function loanToTerms(loan: LoanAccount): LoanTerms {
  return {
    prepayment_charge_pct_early: loan.prepayment_charge_pct_early,
    prepayment_charge_pct_late: loan.prepayment_charge_pct_late,
    prepayment_charge_threshold_emis: loan.prepayment_charge_threshold_emis,
    foreclosure_waiver_months: loan.foreclosure_waiver_months,
    foreclosure_waiver_min_amount: loan.foreclosure_waiver_min_amount,
    gst_pct: loan.gst_pct,
    principal_sanctioned: loan.principal_sanctioned,
    disbursement_date: loan.disbursement_date,
    tenure_months: loan.tenure_months,
  };
}

export function loanToParams(loan: LoanAccount): LoanParams {
  return {
    principal_disbursed: loan.principal_disbursed,
    interest_rate_pa: loan.interest_rate_pa,
    tenure_months: loan.tenure_months,
    emi_amount: loan.emi_amount,
    disbursement_date: loan.disbursement_date,
    emi_start_date: loan.emi_start_date,
    emi_day_of_month: loan.emi_day_of_month,
    interest_method: loan.interest_method,
    round_mode: loan.round_mode ?? "rupee",
  };
}

