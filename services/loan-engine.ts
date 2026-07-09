/**
 * Loan engine (v17.0.0) — pure amortization + prepayment math, no DB.
 *
 * Reducing-balance only in v1 (flat/simple deferred). Handles the
 * broken-period-interest case from the Axis PDF: disbursed Apr 5, first EMI
 * Apr 10 → installment 1 has only 5 days of simple interest, rest behaves
 * like a standard monthly reducing-balance schedule.
 */

import { generateUUID } from "@/utils/uuid";
import { daysBetween } from "@/utils/date";

// ─── Types ────────────────────────────────────────────────

export type RoundMode = "rupee" | "paise";

export interface LoanParams {
  principal_disbursed: number;
  interest_rate_pa: number;          // e.g. 11.49 (percent)
  tenure_months: number;
  emi_amount: number;                // stored as-is; engine derives if 0
  disbursement_date: string;         // YYYY-MM-DD
  emi_start_date: string;            // YYYY-MM-DD
  emi_day_of_month: number;          // 1..31
  interest_method?: "reducing" | "flat" | "simple";
  /** v17.5.2 — 'rupee' matches Indian bank statements; 'paise' for non-INR. Default 'rupee'. */
  round_mode?: RoundMode;
}

export interface ScheduleEntry {
  id: string;
  installment_num: number;
  due_date: string;                  // YYYY-MM-DD
  opening_principal: number;
  emi_amount: number;
  principal_component: number;
  interest_component: number;
  closing_principal: number;
  status: "scheduled" | "paid" | "overdue" | "prepaid" | "skipped";
}

export interface Prepayment {
  prepayment_date: string;
  amount: number;                    // gross
  prepayment_charge: number;
  gst_on_charge: number;
  kind: "part_payment" | "foreclosure";
  strategy?: "reduce_tenure" | "reduce_emi";
}

/**
 * Manual correction at a point in time. When present,
 * `computeOutstandingAt` seeds from the latest correction on-or-before
 * asOfDate instead of walking the full paid chain from origin.
 */
export interface Correction {
  effective_date: string;            // YYYY-MM-DD
  outstanding_principal: number;
}

export interface PrepaymentImpact {
  charge: number;
  gst: number;
  netApplied: number;                // amount - charge - gst, goes against principal
  newTenure: number | null;          // only for reduce_tenure
  newEMI: number | null;             // only for reduce_emi
  interestSavedTotal: number;
  monthsSaved: number;
}

export interface ForeclosureQuote {
  principalOutstanding: number;
  interestAccruedToDate: number;
  prepaymentCharge: number;
  gst: number;
  totalToPay: number;
  interestSavedVsTerm: number;
  monthsSaved: number;
}

export interface LoanTerms {
  prepayment_charge_pct_early: number;
  prepayment_charge_pct_late: number;
  prepayment_charge_threshold_emis: number | null;
  foreclosure_waiver_months: number | null;
  foreclosure_waiver_min_amount: number | null;
  gst_pct: number;
  principal_sanctioned: number;
  disbursement_date: string;
  tenure_months: number;
}

// ─── Helpers ───────────────────────────────────────────────

/** Round to nearest integer paise. */
const round2 = (n: number) => Math.round(n);

/**
 * Rounder that honors the loan's rounding mode.
 * All values are in paise after migration 060.
 * 'rupee' → nearest 100 paise (= ₹1, Indian bank convention).
 * 'paise' → nearest 1 paise (any integer).
 */
function roundBy(n: number, mode: RoundMode | undefined): number {
  return mode === "paise" ? Math.round(n) : Math.round(n / 100) * 100;
}

/** EMI formula: P × r × (1+r)^n / ((1+r)^n − 1). Returns 0 for degenerate inputs. */
export function computeEMI(
  principal: number,
  annualRatePct: number,
  tenureMonths: number,
): number {
  if (principal <= 0 || tenureMonths <= 0) return 0;
  const r = annualRatePct / 12 / 100;
  if (r === 0) return round2(principal / tenureMonths);
  const pow = Math.pow(1 + r, tenureMonths);
  return round2((principal * r * pow) / (pow - 1));
}

/** Add N calendar months to a YYYY-MM-DD string, preserving day-of-month when possible. */
function addMonths(ymd: string, n: number, targetDayOfMonth: number): string {
  const [ys, ms] = ymd.split("-");
  const y = parseInt(ys, 10);
  const m = parseInt(ms, 10) - 1;
  const d = new Date(y, m + n, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const day = Math.min(targetDayOfMonth, last);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}


// ─── Schedule generation ──────────────────────────────────

/**
 * Generate the full amortization schedule.
 *
 * Handles broken-period interest: if the gap from disbursement to first EMI is
 * not exactly a calendar month, installment 1 charges simple interest for that
 * gap, and the principal component absorbs the difference against the standard
 * EMI. This matches the Axis PDF (1,944 interest on installment 1 instead of
 * the ~9,524 that monthly interest would compute).
 */
export function generateSchedule(params: LoanParams): ScheduleEntry[] {
  const {
    principal_disbursed,
    interest_rate_pa,
    tenure_months,
    emi_start_date,
    emi_day_of_month,
    disbursement_date,
  } = params;

  const roundMode: RoundMode = params.round_mode ?? "rupee";
  const r = (n: number) => roundBy(n, roundMode);

  const emi = params.emi_amount > 0
    ? r(params.emi_amount)
    : r(computeEMI(principal_disbursed, interest_rate_pa, tenure_months));

  const monthlyRate = interest_rate_pa / 12 / 100;
  const dailyRate = interest_rate_pa / 365 / 100;

  const schedule: ScheduleEntry[] = [];
  let opening = r(principal_disbursed);

  for (let i = 1; i <= tenure_months; i++) {
    const dueDate =
      i === 1
        ? emi_start_date
        : addMonths(emi_start_date, i - 1, emi_day_of_month);

    // Broken-period for installment 1 if disbursement-to-EMI-start isn't ~30 days
    let interest: number;
    if (i === 1) {
      const gapDays = daysBetween(disbursement_date, emi_start_date);
      if (gapDays > 0 && gapDays < 28) {
        interest = r(opening * dailyRate * gapDays);
      } else {
        interest = r(opening * monthlyRate);
      }
    } else {
      interest = r(opening * monthlyRate);
    }

    // Last installment: absorb rounding drift
    let principalComp: number;
    let thisEmi: number;
    if (i === tenure_months) {
      principalComp = r(opening);
      thisEmi = r(principalComp + interest);
    } else {
      principalComp = r(emi - interest);
      thisEmi = emi;
    }
    const closing = r(Math.max(opening - principalComp, 0));

    schedule.push({
      id: generateUUID(),
      installment_num: i,
      due_date: dueDate,
      opening_principal: r(opening),
      emi_amount: thisEmi,
      principal_component: principalComp,
      interest_component: interest,
      closing_principal: closing,
      status: "scheduled",
    });

    opening = closing;
    if (opening <= 0) break;
  }

  return schedule;
}

// ─── Outstanding calculation ──────────────────────────────

/**
 * Outstanding principal as of a given date.
 *
 * Precedence, in order:
 *   1. Latest manual correction on-or-before asOfDate → seed outstanding
 *      from correction.outstanding_principal, then walk paid/prepaid
 *      installments and prepayments AFTER the correction date only.
 *   2. No applicable correction → walk the schedule from origin
 *      (legacy v17.0.0 behavior).
 *
 * Corrections are authoritative because they reflect the bank's actual
 * ledger at a point in time. Paid installments + prepayments dated before
 * the correction are already baked into `correction.outstanding_principal`.
 */
export function computeOutstandingAt(
  schedule: ScheduleEntry[],
  prepayments: Prepayment[],
  asOfDate: string,
  principalDisbursed: number,
  corrections: Correction[] = [],
): number {
  const sorted = [...schedule].sort(
    (a, b) => a.installment_num - b.installment_num,
  );

  // Pick the latest correction on-or-before asOfDate (if any).
  const applicableCorrection = [...corrections]
    .filter((c) => c.effective_date <= asOfDate)
    .sort((a, b) => a.effective_date.localeCompare(b.effective_date))
    .pop();

  let outstanding: number;
  let seedDate: string | null;
  if (applicableCorrection) {
    outstanding = applicableCorrection.outstanding_principal;
    seedDate = applicableCorrection.effective_date;
  } else {
    outstanding = principalDisbursed;
    seedDate = null;
  }

  for (const entry of sorted) {
    if (entry.due_date > asOfDate) break;
    // Skip entries at or before the correction date — already baked in.
    if (seedDate !== null && entry.due_date <= seedDate) continue;
    if (entry.status === "paid" || entry.status === "prepaid") {
      outstanding = entry.closing_principal;
    }
  }

  // Apply prepayments dated strictly after the correction (or any if no
  // correction), and on or before asOfDate, net of charge + gst.
  const applicablePrepays = prepayments.filter(
    (p) =>
      p.prepayment_date <= asOfDate &&
      (seedDate === null || p.prepayment_date > seedDate),
  );
  for (const p of applicablePrepays) {
    const net = p.amount - p.prepayment_charge - p.gst_on_charge;
    outstanding = Math.max(outstanding - net, 0);
  }

  return round2(outstanding);
}

// ─── Prepayment charge calculation ────────────────────────

export function computePrepaymentCharge(
  loan: LoanTerms,
  amount: number,
  prepaymentDate: string,
  kind: "part_payment" | "foreclosure",
  installmentsPaid: number,
  principalOutstanding: number,
): { charge: number; gst: number } {
  const remainingEmis = loan.tenure_months - installmentsPaid;

  // Foreclosure waiver (per Axis PDF: 1y after disbursement + ≥₹10L + from own funds)
  if (kind === "foreclosure" && loan.foreclosure_waiver_months !== null) {
    const monthsSinceDisbursement = Math.floor(
      daysBetween(loan.disbursement_date, prepaymentDate) / 30,
    );
    const minAmountOk =
      loan.foreclosure_waiver_min_amount === null ||
      loan.principal_sanctioned >= loan.foreclosure_waiver_min_amount;
    if (
      monthsSinceDisbursement >= loan.foreclosure_waiver_months &&
      minAmountOk
    ) {
      return { charge: 0, gst: 0 };
    }
  }

  // Threshold-based rate pick
  let ratePct = loan.prepayment_charge_pct_late;
  if (
    loan.prepayment_charge_threshold_emis !== null &&
    remainingEmis <= loan.prepayment_charge_threshold_emis
  ) {
    ratePct = loan.prepayment_charge_pct_early;
  }

  // Charge base: principal outstanding for foreclosure; part-payment amount for part-payment
  const chargeBase = kind === "foreclosure" ? principalOutstanding : amount;
  const charge = round2((chargeBase * ratePct) / 100);
  const gst = round2((charge * loan.gst_pct) / 100);

  return { charge, gst };
}

// ─── Prepayment application (schedule regeneration) ────────

/**
 * Apply a prepayment to the schedule. Returns a new schedule.
 *
 * Keeps all paid/prepaid installments as-is. From the prepayment date forward:
 *   - reduce_tenure: recompute remaining principal after prepayment, keep EMI,
 *     shorten the tail until zero.
 *   - reduce_emi: keep remaining months, recompute a new EMI based on reduced
 *     principal.
 */
export function applyPrepayment(
  schedule: ScheduleEntry[],
  loan: LoanParams,
  prepayment: Prepayment,
): ScheduleEntry[] {
  const roundMode: RoundMode = loan.round_mode ?? "rupee";
  const r = (n: number) => roundBy(n, roundMode);

  const sorted = [...schedule].sort(
    (a, b) => a.installment_num - b.installment_num,
  );

  // Find last paid installment on or before prepayment date
  const paidUpTo = sorted
    .filter(
      (e) =>
        (e.status === "paid" || e.status === "prepaid") &&
        e.due_date <= prepayment.prepayment_date,
    )
    .pop();

  const nextInstallmentNum = paidUpTo ? paidUpTo.installment_num + 1 : 1;
  const principalAfterPaid = paidUpTo
    ? paidUpTo.closing_principal
    : loan.principal_disbursed;

  // v17.5.13 — current EMI from the live schedule, not the sanctioned
  // loan.emi_amount. A prior reduce_emi prepayment lowers the tail EMI;
  // gating the trivial-path + tail-preservation against the sanctioned
  // value means "prepay exactly one current EMI" gets silently treated
  // as "smaller than one EMI" and the user's strategy pick is ignored.
  const upcomingEntry = sorted.find(
    (e) =>
      (e.status === "scheduled" || e.status === "overdue") &&
      e.due_date >= prepayment.prepayment_date,
  );
  const priorEntry = [...sorted]
    .filter((e) => e.due_date <= prepayment.prepayment_date)
    .pop();
  const currentEmi =
    upcomingEntry?.emi_amount ?? priorEntry?.emi_amount ?? loan.emi_amount;

  // Apply prepayment net amount
  const net =
    prepayment.amount - prepayment.prepayment_charge - prepayment.gst_on_charge;
  const principalAfterPrepay = Math.max(principalAfterPaid - net, 0);

  // Everything up to and including the current-paid block stays as-is.
  const kept = sorted.filter(
    (e) =>
      e.installment_num < nextInstallmentNum ||
      e.status === "paid" ||
      e.status === "prepaid",
  );

  const monthlyRate = loan.interest_rate_pa / 12 / 100;

  // ── Trivial path: prepayment strictly smaller than one EMI ───
  // Matches what banks actually do — money just reduces principal, no
  // strategy choice, no tail restructure. Same installment_num set, same
  // emi_amount (except the last installment which absorbs drift and may
  // shrink by ₹1–₹100). Tail length unchanged.
  // v17.5.7 — threshold reverted from `<=` to `<`. A prepayment exactly
  // equal to one EMI should let the user choose strategy (because it
  // meaningfully shortens tenure by one month if they pick reduce_tenure).
  // v17.5.13 — compare against the live currentEmi, not sanctioned.
  // v17.5.14 — compare against the GROSS amount (what the user typed),
  // not `net` (amount − charge − GST). With auto-derived charges now
  // non-zero, `net < currentEmi` was firing even when the gross amount
  // was ≥ currentEmi — silently trivializing reduce_emi picks. The UI
  // gate and the user mental model both compare against the gross.
  if (net > 0 && prepayment.amount < currentEmi) {
    const remainingCount = sorted.length - (paidUpTo?.installment_num ?? 0);
    const tail: ScheduleEntry[] = [];
    let opening = principalAfterPrepay;
    let num = nextInstallmentNum;
    for (let i = 0; i < remainingCount; i++) {
      const dueDate = addMonths(
        loan.emi_start_date,
        num - 1,
        loan.emi_day_of_month,
      );
      const interest = r(opening * monthlyRate);
      const isLast = i === remainingCount - 1 || opening <= currentEmi;
      let principalComp: number;
      let thisEmi: number;
      if (isLast) {
        principalComp = r(opening);
        thisEmi = r(principalComp + interest);
      } else {
        principalComp = r(currentEmi - interest);
        thisEmi = currentEmi;
      }
      const closing = r(Math.max(opening - principalComp, 0));
      tail.push({
        id: generateUUID(),
        installment_num: num,
        due_date: dueDate,
        opening_principal: r(opening),
        emi_amount: thisEmi,
        principal_component: principalComp,
        interest_component: interest,
        closing_principal: closing,
        status: "scheduled",
      });
      opening = closing;
      num++;
      if (opening <= 0) break;
    }
    return [...kept, ...tail];
  }

  // ── Full regen path: prepayment ≥ one EMI, strategy-driven ────
  const remainingMonths = sorted.length - (paidUpTo?.installment_num ?? 0);
  let newEmi = currentEmi;
  let newTenure = remainingMonths;

  if (prepayment.strategy === "reduce_emi") {
    newEmi = r(computeEMI(principalAfterPrepay, loan.interest_rate_pa, remainingMonths));
    newTenure = remainingMonths;
  }
  // reduce_tenure: keep EMI same, tail ends early

  const tail: ScheduleEntry[] = [];
  let opening = principalAfterPrepay;
  let num = nextInstallmentNum;
  const maxIters = remainingMonths + 12; // safety cap
  let iters = 0;

  while (opening > 0.01 && iters < maxIters) {
    iters++;
    const dueDate = addMonths(
      loan.emi_start_date,
      num - 1,
      loan.emi_day_of_month,
    );
    const interest = r(opening * monthlyRate);
    const desiredEmi = newEmi;
    let principalComp = r(desiredEmi - interest);
    let thisEmi = desiredEmi;

    // Last installment: absorb rounding drift
    if (principalComp >= opening || iters === maxIters) {
      principalComp = r(opening);
      thisEmi = r(principalComp + interest);
    }

    const closing = r(Math.max(opening - principalComp, 0));

    tail.push({
      id: generateUUID(),
      installment_num: num,
      due_date: dueDate,
      opening_principal: r(opening),
      emi_amount: thisEmi,
      principal_component: principalComp,
      interest_component: interest,
      closing_principal: closing,
      status: "scheduled",
    });

    opening = closing;
    num++;

    if (prepayment.strategy === "reduce_emi" && num > nextInstallmentNum + newTenure - 1) {
      break;
    }
  }

  return [...kept, ...tail];
}

// ─── Foreclosure quote ────────────────────────────────────

export function computeForeclosureQuote(
  loan: LoanParams & LoanTerms,
  schedule: ScheduleEntry[],
  prepayments: Prepayment[],
  asOf: string,
  corrections: Correction[] = [],
): ForeclosureQuote {
  const sorted = [...schedule].sort((a, b) => a.installment_num - b.installment_num);
  const paidInstallments = sorted.filter(
    (e) => e.status === "paid" || e.status === "prepaid",
  );
  const lastPaid = paidInstallments[paidInstallments.length - 1];
  const installmentsPaid = lastPaid?.installment_num ?? 0;

  const principalOutstanding = computeOutstandingAt(
    schedule,
    prepayments,
    asOf,
    loan.principal_disbursed,
    corrections,
  );

  // Accrued interest from last paid EMI's due date to asOf
  const fromDate = lastPaid?.due_date ?? loan.disbursement_date;
  const days = Math.max(daysBetween(fromDate, asOf), 0);
  const dailyRate = loan.interest_rate_pa / 365 / 100;
  const interestAccruedToDate = round2(principalOutstanding * dailyRate * days);

  const { charge, gst } = computePrepaymentCharge(
    loan,
    principalOutstanding,
    asOf,
    "foreclosure",
    installmentsPaid,
    principalOutstanding,
  );

  const totalToPay = round2(
    principalOutstanding + interestAccruedToDate + charge + gst,
  );

  // Interest that would've been paid if running to term
  const interestRemaining = sorted
    .filter((e) => e.status === "scheduled" && e.due_date > asOf)
    .reduce((s, e) => s + e.interest_component, 0);

  return {
    principalOutstanding,
    interestAccruedToDate,
    prepaymentCharge: charge,
    gst,
    totalToPay,
    interestSavedVsTerm: round2(interestRemaining - interestAccruedToDate - charge - gst),
    monthsSaved: sorted.filter(
      (e) => e.status === "scheduled" && e.due_date > asOf,
    ).length,
  };
}

// ─── What-if: prepayment impact ───────────────────────────

export function computePrepaymentImpact(
  loan: LoanParams & LoanTerms,
  schedule: ScheduleEntry[],
  prepayments: Prepayment[],
  amount: number,
  prepaymentDate: string,
  strategy: "reduce_tenure" | "reduce_emi",
  corrections: Correction[] = [],
): PrepaymentImpact {
  const sorted = [...schedule].sort((a, b) => a.installment_num - b.installment_num);
  const paidInstallments = sorted.filter(
    (e) => e.status === "paid" || e.status === "prepaid",
  );
  const installmentsPaid = paidInstallments[paidInstallments.length - 1]?.installment_num ?? 0;

  const principalOutstanding = computeOutstandingAt(
    schedule,
    prepayments,
    prepaymentDate,
    loan.principal_disbursed,
    corrections,
  );

  const { charge, gst } = computePrepaymentCharge(
    loan,
    amount,
    prepaymentDate,
    "part_payment",
    installmentsPaid,
    principalOutstanding,
  );

  const netApplied = round2(amount - charge - gst);

  // Interest-to-term before prepay
  const interestBefore = sorted
    .filter((e) => e.status === "scheduled" && e.due_date >= prepaymentDate)
    .reduce((s, e) => s + e.interest_component, 0);

  // Simulate new schedule after prepay
  const fakePrepay: Prepayment = {
    prepayment_date: prepaymentDate,
    amount,
    prepayment_charge: charge,
    gst_on_charge: gst,
    kind: "part_payment",
    strategy,
  };
  const newSchedule = applyPrepayment(schedule, loan, fakePrepay);
  const interestAfter = newSchedule
    .filter((e) => e.status === "scheduled" && e.due_date >= prepaymentDate)
    .reduce((s, e) => s + e.interest_component, 0);

  const interestSavedTotal = round2(interestBefore - interestAfter);
  const originalRemainingCount = sorted.filter(
    (e) => e.status === "scheduled" && e.due_date >= prepaymentDate,
  ).length;
  const newRemainingCount = newSchedule.filter(
    (e) => e.status === "scheduled" && e.due_date >= prepaymentDate,
  ).length;
  const monthsSaved = Math.max(originalRemainingCount - newRemainingCount, 0);

  let newTenure: number | null = null;
  let newEMI: number | null = null;
  if (strategy === "reduce_tenure") {
    newTenure = newSchedule.length;
  } else {
    const tail = newSchedule.filter(
      (e) => e.due_date >= prepaymentDate && e.status === "scheduled",
    );
    // v17.5.13 — fallback to current-schedule EMI, not sanctioned, so a
    // no-op reduce_emi (prepayment == current EMI) still shows the right
    // post-prepay number in the preview.
    const currentSchedEmi =
      sorted.find(
        (e) =>
          (e.status === "scheduled" || e.status === "overdue") &&
          e.due_date >= prepaymentDate,
      )?.emi_amount ?? loan.emi_amount;
    newEMI = tail[0]?.emi_amount ?? currentSchedEmi;
  }

  return {
    charge,
    gst,
    netApplied,
    newTenure,
    newEMI,
    interestSavedTotal,
    monthsSaved,
  };
}
