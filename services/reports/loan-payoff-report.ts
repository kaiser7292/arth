import {
  getLoanOutstandingAt,
  getSchedule,
  listAllLoansWithBankName,
} from "@/services/loan-accounts";
import { toIsoDate } from "@/utils/date";
import { logger } from "@/utils/logger";

// ─── Public types ────────────────────────────────────────

export interface LoanPayoffInputs {
  extraMonthlyAmount: number;
}

export const DEFAULT_LOAN_PAYOFF_INPUTS: LoanPayoffInputs = {
  extraMonthlyAmount: 10000,
};

export interface LoanDetail {
  id: string;
  name: string;
  bankName: string;
  outstanding: number;
  interestRate: number;
  emiAmount: number;
  remainingMonths: number;
  naturalEndDate: string;
}

export interface PayoffStep {
  month: number;
  date: string;
  loanName: string;
  payment: number;
  principalPaid: number;
  interestPaid: number;
  remainingBalance: number;
  isPayoff: boolean;
}

export interface PayoffStrategy {
  name: string;
  description: string;
  totalInterestPaid: number;
  totalMonths: number;
  debtFreeDate: string;
  interestSaved: number;
  monthsSaved: number;
  timeline: PayoffStep[];
  monthlyBreakdown: {
    month: number;
    date: string;
    totalPayment: number;
    totalRemaining: number;
  }[];
}

export interface LoanPayoffReport {
  generatedAt: string;
  dataAsOf: string;
  inputs: LoanPayoffInputs;

  loans: LoanDetail[];
  totalOutstanding: number;
  totalMonthlyEMI: number;
  weightedAvgRate: number;

  naturalTotalInterest: number;
  naturalEndDate: string;
  naturalMonths: number;

  avalanche: PayoffStrategy;
  snowball: PayoffStrategy;

  recommended: "avalanche" | "snowball";
  interestDifference: number;

  bestDebtFreeDate: string;
  maxInterestSaved: number;
  maxMonthsSaved: number;

  postDebtFreeMonthlySurplus: number;
}

// ─── Internal simulation types ───────────────────────────

interface LoanSimState {
  id: string;
  name: string;
  outstanding: number;
  monthlyRate: number;
  emiAmount: number;
  active: boolean;
}

// ─── Main entry point ────────────────────────────────────

export async function generateLoanPayoffReport(
  userId: string,
  inputs: LoanPayoffInputs,
): Promise<LoanPayoffReport | null> {
  try {
    const today = toIsoDate(new Date());
    const allLoans = await listAllLoansWithBankName(userId);
    const activeLoans = allLoans.filter((l) => l.status === "active");

    if (activeLoans.length === 0) return null;

    const loanDetails: LoanDetail[] = [];
    let totalOutstanding = 0;
    let totalMonthlyEMI = 0;
    let weightedRateSum = 0;
    let naturalTotalInterest = 0;
    let naturalMaxEndDate = "";
    let naturalMaxMonths = 0;

    for (const loan of activeLoans) {
      const outstanding = await getLoanOutstandingAt(loan.id, today);
      if (outstanding <= 0) continue;

      const schedule = await getSchedule(loan.id);
      const remaining = schedule.filter((e) => e.status === "scheduled");
      const remainingMonths = remaining.length;
      const remainingInterest = remaining.reduce(
        (sum, e) => sum + e.interest_component,
        0,
      );
      const naturalEnd =
        remaining.length > 0
          ? remaining[remaining.length - 1].due_date
          : today;

      loanDetails.push({
        id: loan.id,
        name: `${loan.bank_name} ${capitalize(loan.loan_type)} Loan`,
        bankName: loan.bank_name,
        outstanding,
        interestRate: loan.interest_rate_pa,
        emiAmount: loan.emi_amount,
        remainingMonths,
        naturalEndDate: naturalEnd,
      });

      totalOutstanding += outstanding;
      totalMonthlyEMI += loan.emi_amount;
      weightedRateSum += outstanding * loan.interest_rate_pa;
      naturalTotalInterest += remainingInterest;

      if (naturalEnd > naturalMaxEndDate) naturalMaxEndDate = naturalEnd;
      if (remainingMonths > naturalMaxMonths)
        naturalMaxMonths = remainingMonths;
    }

    if (loanDetails.length === 0) return null;

    const weightedAvgRate = weightedRateSum / totalOutstanding;

    const avalanche = simulatePayoff(
      loanDetails,
      inputs.extraMonthlyAmount,
      "rate_desc",
    );
    const snowball = simulatePayoff(
      loanDetails,
      inputs.extraMonthlyAmount,
      "balance_asc",
    );

    const interestDifference =
      snowball.totalInterestPaid - avalanche.totalInterestPaid;

    const bestStrategy =
      avalanche.totalInterestPaid <= snowball.totalInterestPaid
        ? avalanche
        : snowball;

    return {
      generatedAt: new Date().toISOString(),
      dataAsOf: today,
      inputs,

      loans: loanDetails,
      totalOutstanding: round2(totalOutstanding),
      totalMonthlyEMI: round2(totalMonthlyEMI),
      weightedAvgRate: round2(weightedAvgRate),

      naturalTotalInterest: round2(naturalTotalInterest),
      naturalEndDate: naturalMaxEndDate,
      naturalMonths: naturalMaxMonths,

      avalanche,
      snowball,

      recommended: "avalanche",
      interestDifference: round2(interestDifference),

      bestDebtFreeDate: bestStrategy.debtFreeDate,
      maxInterestSaved: round2(bestStrategy.interestSaved),
      maxMonthsSaved: bestStrategy.monthsSaved,

      postDebtFreeMonthlySurplus: round2(totalMonthlyEMI),
    };
  } catch (err) {
    logger.error("generateLoanPayoffReport failed", err);
    return null;
  }
}

// ─── Simulation ──────────────────────────────────────────

function simulatePayoff(
  loans: LoanDetail[],
  extraMonthly: number,
  order: "rate_desc" | "balance_asc",
): PayoffStrategy {
  const states: LoanSimState[] = loans.map((l) => ({
    id: l.id,
    name: l.name,
    outstanding: l.outstanding,
    monthlyRate: l.interestRate / 12 / 100,
    emiAmount: l.emiAmount,
    active: true,
  }));

  sortByStrategy(states, order);

  const now = new Date();
  let monthIndex = 0;
  let totalInterestPaid = 0;
  let freedEMI = 0;
  const timeline: PayoffStep[] = [];
  const monthlyBreakdown: PayoffStrategy["monthlyBreakdown"] = [];

  const MAX_MONTHS = 600; // 50-year safety cap

  while (states.some((s) => s.active) && monthIndex < MAX_MONTHS) {
    monthIndex++;
    const dateObj = new Date(now.getFullYear(), now.getMonth() + monthIndex, 1);
    const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}`;

    let totalPaymentThisMonth = 0;

    // Available extra = user extra + freed EMIs from paid-off loans
    let extraPool = extraMonthly + freedEMI;

    // Find the target loan (first active in strategy order)
    const targetIdx = states.findIndex((s) => s.active);

    for (let i = 0; i < states.length; i++) {
      const loan = states[i];
      if (!loan.active) continue;

      const interest = round2(loan.outstanding * loan.monthlyRate);
      totalInterestPaid += interest;

      let payment = loan.emiAmount;

      // Apply extra to the target loan
      if (i === targetIdx && extraPool > 0) {
        payment += extraPool;
        extraPool = 0;
      }

      // Don't overpay
      const totalOwed = loan.outstanding + interest;
      if (payment > totalOwed) payment = totalOwed;

      const principalPaid = round2(payment - interest);
      loan.outstanding = round2(loan.outstanding - principalPaid);

      totalPaymentThisMonth += payment;

      if (loan.outstanding <= 0.5) {
        // Treat as paid off (sub-rupee rounding residual)
        loan.outstanding = 0;
        loan.active = false;
        freedEMI += loan.emiAmount;

        timeline.push({
          month: monthIndex,
          date: dateStr,
          loanName: loan.name,
          payment: round2(payment),
          principalPaid: round2(principalPaid),
          interestPaid: round2(interest),
          remainingBalance: 0,
          isPayoff: true,
        });
      }
    }

    const totalRemaining = round2(
      states.reduce((s, l) => s + l.outstanding, 0),
    );

    monthlyBreakdown.push({
      month: monthIndex,
      date: dateStr,
      totalPayment: round2(totalPaymentThisMonth),
      totalRemaining,
    });
  }

  const naturalInterest = loans.reduce(
    (sum, l) =>
      sum +
      computeNaturalInterest(l.outstanding, l.interestRate, l.remainingMonths),
    0,
  );
  const naturalMonths = Math.max(...loans.map((l) => l.remainingMonths));

  const debtFreeDate =
    monthlyBreakdown.length > 0
      ? monthlyBreakdown[monthlyBreakdown.length - 1].date
      : "";

  const isAvalanche = order === "rate_desc";

  return {
    name: isAvalanche ? "Avalanche" : "Snowball",
    description: isAvalanche
      ? "Pay highest-interest loan first. Minimises total interest paid."
      : "Pay smallest-balance loan first. Faster psychological wins as loans get cleared sooner.",
    totalInterestPaid: round2(totalInterestPaid),
    totalMonths: monthIndex,
    debtFreeDate,
    interestSaved: round2(naturalInterest - totalInterestPaid),
    monthsSaved: naturalMonths - monthIndex,
    timeline,
    monthlyBreakdown,
  };
}

// ─── Helpers ─────────────────────────────────────────────

function sortByStrategy(
  states: LoanSimState[],
  order: "rate_desc" | "balance_asc",
): void {
  if (order === "rate_desc") {
    states.sort(
      (a, b) =>
        b.monthlyRate - a.monthlyRate || a.outstanding - b.outstanding,
    );
  } else {
    states.sort(
      (a, b) =>
        a.outstanding - b.outstanding || b.monthlyRate - a.monthlyRate,
    );
  }
}

function computeNaturalInterest(
  outstanding: number,
  annualRate: number,
  remainingMonths: number,
): number {
  const monthlyRate = annualRate / 12 / 100;
  let balance = outstanding;
  let totalInterest = 0;

  if (monthlyRate === 0 || remainingMonths <= 0) return 0;

  const pow = Math.pow(1 + monthlyRate, remainingMonths);
  const emi = (balance * monthlyRate * pow) / (pow - 1);

  for (let m = 0; m < remainingMonths; m++) {
    const interest = balance * monthlyRate;
    totalInterest += interest;
    const principal = emi - interest;
    balance -= principal;
    if (balance <= 0) break;
  }

  return round2(totalInterest);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}
