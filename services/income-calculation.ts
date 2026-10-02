/**
 * Income profile → every income figure the app uses.
 *
 * One place that turns a salary profile (salaried CTC, direct post-tax, or business /
 * freelance, plus side income, bonus and capital gains) into in-hand income, tax and the
 * advance-tax schedule. The Income Calculator screen and deriveYearlyPlan both call it, so
 * the number the user saves is the number the plan uses.
 */
import {
  calculateSalary,
  calculateBusinessIncome,
  calculateOtherIncome,
  computeBonusTax,
  computeCapitalGainsTax,
  computeAdvanceTaxSchedule,
  getProfessionalTax,
  getEpfAnnualWageCap,
  type AdvanceTaxPlan,
  type BonusTaxResult,
  type BusinessIncomeCalculation,
  type BusinessIncomeInput,
  type CapitalGainsTaxInput,
  type CapitalGainsTaxResult,
  type OtherIncomeResult,
  type SalaryCalculation,
} from "@/services/tax-engine";
import type { SalaryProfile } from "@/services/salary-profile";

/** The profile fields the calculation reads. A saved SalaryProfile satisfies it. */
export type IncomeProfileNumbers = Pick<
  SalaryProfile,
  | "income_type"
  | "input_mode"
  | "annual_ctc"
  | "basic_pct"
  | "hra_pct"
  | "is_metro"
  | "epf_mode"
  | "epf_in_ctc"
  | "gratuity_in_ctc"
  | "vpf_monthly"
  | "state"
  | "deductions_80c"
  | "deductions_80d"
  | "hra_exemption_annual"
  | "home_loan_interest"
  | "other_deductions"
  | "ctc_mode"
  | "manual_basic"
  | "manual_hra"
  | "manual_special"
  | "manual_employer_epf"
  | "manual_gratuity"
  | "manual_monthly_in_hand"
  | "computed_monthly_in_hand"
  | "expected_bonus"
  | "capital_gains_equity_ltcg"
  | "capital_gains_equity_stcg"
  | "capital_gains_debt"
  | "capital_gains_fd"
  | "capital_gains_gold"
  | "capital_gains_real_estate"
  | "business_scheme"
  | "business_receipts"
  | "business_digital_pct"
  | "business_expenses"
  | "business_tds_pct"
  | "side_business_enabled"
  | "rental_annual_rent"
  | "rental_municipal_tax"
  | "rental_loan_interest"
>;

export type IncomeKind = "ctc" | "direct" | "business";

export interface IncomeProfileResult {
  kind: IncomeKind;
  salary: SalaryCalculation | null;
  business: BusinessIncomeCalculation | null;
  /** Primary income after tax (CTC manual override applied). Direct mode: the entered figure. */
  primaryAnnualInHand: number;
  /** Tax on the primary income in its own best regime (0 in direct mode). */
  primaryTax: number;
  primaryRegime: "new" | "old";
  /** Side business / rent — null when there is none or in direct mode. */
  other: OtherIncomeResult | null;
  bonus: BonusTaxResult | null;
  capitalGains: CapitalGainsTaxResult | null;
  netBonus: number;
  netCapitalGains: number;
  /** Recurring in-hand: primary + other income after its tax. What "monthly income" means app-wide. */
  annualInHand: number;
  monthlyInHand: number;
  /** annualInHand + net bonus + net capital gains. */
  totalAnnualIncome: number;
  /** Income tax on primary + other income (capital gains and bonus shown separately). */
  annualTax: number;
  /** Advance tax on business / side income. Null when nothing is self-assessed. */
  advanceTax: AdvanceTaxPlan | null;
}

export function getIncomeKind(p: Pick<SalaryProfile, "income_type" | "input_mode">): IncomeKind {
  if (p.income_type === "business") return "business";
  return p.input_mode === "ctc" ? "ctc" : "direct";
}

function capitalGainsInput(p: IncomeProfileNumbers): CapitalGainsTaxInput {
  return {
    equity_ltcg: p.capital_gains_equity_ltcg ?? 0,
    equity_stcg: p.capital_gains_equity_stcg ?? 0,
    debt: p.capital_gains_debt ?? 0,
    fd: p.capital_gains_fd ?? 0,
    gold: p.capital_gains_gold ?? 0,
    real_estate: p.capital_gains_real_estate ?? 0,
  };
}

function businessInput(p: IncomeProfileNumbers): BusinessIncomeInput {
  return {
    scheme: p.business_scheme ?? "presumptive_profession",
    grossReceipts: p.business_receipts ?? 0,
    digitalReceiptsPct: p.business_digital_pct ?? 100,
    businessExpenses: p.business_expenses ?? 0,
    tdsPct: p.business_tds_pct ?? 0,
    professionalTaxAnnual: getProfessionalTax(p.state),
    deductions80C: p.deductions_80c ?? 0,
    deductions80D: p.deductions_80d ?? 0,
    homeLoanInterest: p.home_loan_interest ?? 0,
    otherDeductions: p.other_deductions ?? 0,
  };
}

function hasRental(p: IncomeProfileNumbers): boolean {
  return (p.rental_annual_rent ?? 0) > 0 || (p.rental_loan_interest ?? 0) > 0;
}

/**
 * @param fyYear tax-year start (e.g. 2026 for FY 2026-27) — dates the advance-tax instalments.
 * @param directAnnual direct mode only: the year's post-tax total (month-wise overrides summed).
 *   Defaults to computed_monthly_in_hand × 12.
 */
export function computeIncomeProfile(
  p: IncomeProfileNumbers,
  fyYear: number,
  directAnnual?: number,
): IncomeProfileResult {
  const kind = getIncomeKind(p);
  const cgInput = capitalGainsInput(p);
  const hasCG = Object.values(cgInput).some((v) => v > 0);
  const rawBonus = Math.max(p.expected_bonus ?? 0, 0);

  // ── Direct: everything is already post-tax ──
  if (kind === "direct") {
    const annual = directAnnual ?? (p.computed_monthly_in_hand ?? 0) * 12;
    const rawCG = Object.values(cgInput).reduce((s, v) => s + v, 0);
    return {
      kind,
      salary: null,
      business: null,
      primaryAnnualInHand: annual,
      primaryTax: 0,
      primaryRegime: "new",
      other: null,
      bonus: null,
      capitalGains: null,
      netBonus: rawBonus,
      netCapitalGains: rawCG,
      annualInHand: annual,
      monthlyInHand: annual / 12,
      totalAnnualIncome: annual + rawBonus + rawCG,
      annualTax: 0,
      advanceTax: null,
    };
  }

  // ── Primary income ──
  let salary: SalaryCalculation | null = null;
  let business: BusinessIncomeCalculation | null = null;
  let primaryAnnualInHand = 0;
  let primaryTax = 0;
  let primaryRegime: "new" | "old" = "new";
  let baseTaxableNew = 0;
  let baseTaxableOld = 0;

  if (kind === "ctc") {
    const annualCTC = p.annual_ctc ?? 0;
    if (annualCTC > 0) {
      salary = calculateSalary({
        annualCTC,
        basicPct: p.basic_pct || 40,
        hraPct: p.hra_pct || 50,
        isMetro: p.is_metro === 1,
        epfMode: p.epf_mode,
        epfInCTC: p.epf_in_ctc === 1,
        gratuityInCTC: p.gratuity_in_ctc !== 0,
        vpfMonthly: p.vpf_monthly ?? 0,
        professionalTaxAnnual: getProfessionalTax(p.state),
        deductions80C: p.deductions_80c ?? 0,
        deductions80D: p.deductions_80d ?? 0,
        hraExemptionAnnual: p.hra_exemption_annual ?? 0,
        homeLoanInterest: p.home_loan_interest ?? 0,
        otherDeductions: p.other_deductions ?? 0,
        epfAnnualWageCap: getEpfAnnualWageCap(fyYear),
        manualBreakdown:
          p.ctc_mode === "manual"
            ? {
                basic: p.manual_basic ?? 0,
                hra: p.manual_hra ?? 0,
                specialAllowance: p.manual_special ?? 0,
                employerEPF: p.manual_employer_epf ?? 0,
                gratuity: p.manual_gratuity ?? 0,
              }
            : undefined,
      });
      const manual = p.manual_monthly_in_hand ?? 0;
      primaryAnnualInHand = manual > 0 ? manual * 12 : salary.annualInHand;
      primaryRegime = salary.selectedRegime;
      primaryTax = primaryRegime === "new" ? salary.newRegimeTax.totalTax : salary.oldRegimeTax.totalTax;
      baseTaxableNew = salary.newRegimeTax.taxableIncome;
      baseTaxableOld = salary.oldRegimeTax.taxableIncome;
    }
  } else {
    business = calculateBusinessIncome(businessInput(p));
    primaryAnnualInHand = business.annualInHand;
    primaryRegime = business.selectedRegime;
    primaryTax = primaryRegime === "new" ? business.newRegimeTax.totalTax : business.oldRegimeTax.totalTax;
    baseTaxableNew = business.newRegimeTax.taxableIncome;
    baseTaxableOld = business.oldRegimeTax.taxableIncome;
  }

  const hasPrimary = salary !== null || business !== null;

  // ── Side business (salaried only) + rent ──
  const sideBusiness = kind === "ctc" && p.side_business_enabled === 1 && (p.business_receipts ?? 0) > 0
    ? businessInput(p)
    : null;
  const rental = hasRental(p)
    ? {
        annualRent: p.rental_annual_rent ?? 0,
        municipalTax: p.rental_municipal_tax ?? 0,
        loanInterest: p.rental_loan_interest ?? 0,
      }
    : null;
  const other = hasPrimary && (sideBusiness || rental)
    ? calculateOtherIncome({
        baseTaxableNew,
        baseTaxableOld,
        primaryTax,
        selfOccupiedInterestClaimed: p.home_loan_interest ?? 0,
        sideBusiness,
        rental,
      })
    : null;

  // Regime and taxable income the extra items (bonus, capital gains) stack on.
  const stackRegime: "new" | "old" = other ? other.bestRegime : primaryRegime;
  const stackTaxable = other
    ? (stackRegime === "new"
        ? baseTaxableNew + other.sideBusinessProfit + other.rentalCountedNew
        : baseTaxableOld + other.sideBusinessProfit + other.rentalCountedOld)
    : (primaryRegime === "new" ? baseTaxableNew : baseTaxableOld);

  // Bonus is salary — it stacks on the salary's own taxable income.
  const bonus = kind === "ctc" && salary && rawBonus > 0
    ? computeBonusTax(Math.max(stackTaxable, 0), rawBonus, stackRegime, 0)
    : null;
  const capitalGains = hasPrimary && hasCG
    ? computeCapitalGainsTax(cgInput, Math.max(stackTaxable, 0) + (bonus?.grossBonus ?? 0), stackRegime, 0)
    : null;

  const netBonus = bonus ? bonus.netBonus : (kind === "business" ? 0 : rawBonus);
  const netCapitalGains = capitalGains
    ? capitalGains.totalNet
    : Object.values(cgInput).reduce((s, v) => s + v, 0);

  const annualInHand = primaryAnnualInHand + (other?.netCash ?? 0);
  const annualTax = primaryTax + (other?.extraTax ?? 0);

  // ── Advance tax: whatever the employer's TDS doesn't cover ──
  let advanceTax: AdvanceTaxPlan | null = null;
  if (business) {
    advanceTax = computeAdvanceTaxSchedule(
      annualTax,
      business.tdsCredit,
      fyYear,
      business.appliedScheme !== "regular",
    );
  } else if (other && other.extraTax > 0) {
    advanceTax = computeAdvanceTaxSchedule(
      other.extraTax,
      other.tdsCredit,
      fyYear,
      !!other.sideBusiness && other.sideBusiness.appliedScheme !== "regular" && !rental,
    );
  }

  return {
    kind,
    salary,
    business,
    primaryAnnualInHand,
    primaryTax,
    primaryRegime,
    other,
    bonus,
    capitalGains,
    netBonus,
    netCapitalGains,
    annualInHand,
    monthlyInHand: annualInHand / 12,
    totalAnnualIncome: annualInHand + netBonus + netCapitalGains,
    annualTax,
    advanceTax,
  };
}

/**
 * Direct mode stores the year's AVERAGE monthly in-hand (computed_monthly_in_hand), not the
 * default month the user typed, and month-wise overrides separately. Recover the default:
 * average × 12 = default × (months not overridden) + sum(overrides).
 *
 * Reading the average back as the default made each save + reload drift the annual total
 * whenever some months were overridden.
 */
export function deriveDirectBaseMonthly(
  averageMonthly: number,
  overrides: Record<number, string> | null | undefined,
): number {
  const entries = Object.entries(overrides ?? {}).filter(([k]) => {
    const i = Number(k);
    return Number.isInteger(i) && i >= 0 && i < 12;
  });
  const free = 12 - entries.length;
  if (entries.length === 0 || free <= 0) return averageMonthly;
  const overriddenSum = entries.reduce((s, [, v]) => s + (parseFloat(v) || 0), 0);
  return Math.max(Math.round(((averageMonthly * 12 - overriddenSum) / free) * 100) / 100, 0);
}
