/**
 * Tax Engine — Pure calculation functions for Indian Income Tax.
 *
 * Supports:
 * - CTC breakdown (Basic, HRA, Special Allowance, EPF, Gratuity)
 * - New Tax Regime FY 2025-26 / 2026-27 (7 slabs + 87A rebate; Budget 2026 left them unchanged)
 * - Old Tax Regime (4 slabs + deductions)
 * - Business / professional income (presumptive or regular books) + advance tax
 * - EPF (full_basic vs restricted)
 * - Professional Tax (state-wise)
 * - Surcharge (5 tiers) + 4% Health & Education Cess
 */

// ─── Types ─────────────────────────────────────────────────

export interface CTCBreakdown {
  annualCTC: number;
  basic: number;
  hra: number;
  specialAllowance: number;
  employerEPF: number;
  gratuity: number;
  grossSalary: number; // CTC - Employer EPF - Gratuity (what goes through tax)
}

/**
 * Manual rupee-amount breakdown of CTC components.
 * Used when the employer provides explicit amounts rather than percentage-based splits
 * (e.g. Basic ₹8,00,000, HRA ₹4,00,000, Special ₹6,50,000, Employer EPF ₹21,600,
 * Gratuity ₹38,480). Special allowance is derived if any component is left blank.
 */
export interface ManualCTCBreakdown {
  basic: number;
  hra: number;
  specialAllowance: number; // optional — if 0/undefined, derived from CTC minus others
  employerEPF: number;
  gratuity: number;
}

export interface EPFResult {
  employeeContribution: number; // 12% of base
  employerEPF: number; // 3.67% of base
  employerEPS: number; // 8.33% of base
  totalEmployerContribution: number; // EPF + EPS = 12%
  vpf: number;
  totalDeducted: number; // employee + vpf
}

export interface TaxResult {
  taxableIncome: number;
  baseTax: number;
  surcharge: number;
  cess: number;
  rebate87A: number;
  /** Reduction applied when marginal relief kicks in near the 87A cliff or surcharge thresholds. */
  marginalRelief: number;
  totalTax: number;
  effectiveRate: number; // percentage
}

export interface SalaryCalculation {
  ctcBreakdown: CTCBreakdown;
  epf: EPFResult;
  newRegimeTax: TaxResult;
  oldRegimeTax: TaxResult;
  professionalTaxAnnual: number;
  annualInHand: number; // using selected regime
  monthlyInHand: number;
  selectedRegime: "new" | "old";
}

export interface TaxInput {
  annualCTC: number;
  basicPct: number; // default 40
  hraPct: number; // default 50 (% of Basic)
  isMetro: boolean;
  epfMode: "full_basic" | "restricted";
  epfInCTC: boolean; // employer EPF part of CTC?
  /** Employer's gratuity included in the CTC figure? Default: true (typical). */
  gratuityInCTC?: boolean;
  vpfMonthly: number;
  professionalTaxAnnual: number;
  // Old regime deductions
  deductions80C: number;
  deductions80D: number;
  hraExemptionAnnual: number;
  homeLoanInterest: number;
  otherDeductions: number;
  /**
   * Optional manual rupee-amount breakdown. When provided, percentages are ignored
   * and the rupee values are used as-is. Special allowance is derived if zero.
   */
  manualBreakdown?: ManualCTCBreakdown;
  /** Annual EPF wage ceiling for the tax year (getEpfAnnualWageCap). Defaults to the old ₹15,000/month. */
  epfAnnualWageCap?: number;
}

// ─── Constants ─────────────────────────────────────────────

/**
 * EPF statutory wage ceiling (Basic + DA per month). Raised from ₹15,000 to ₹25,000 by
 * notification S.O. 5109(E) under the Code on Social Security, effective 17 Sep 2026.
 */
const EPF_CEILING_OLD_MONTHLY = 15000;
const EPF_CEILING_NEW_MONTHLY = 25000;
/** First day the ₹25,000 ceiling applies. */
export const EPF_CEILING_CHANGE_DATE = "2026-09-17";
/** Annual cap under the old ceiling — the default for callers that don't say which year. */
const EPF_LEGACY_ANNUAL_CAP = EPF_CEILING_OLD_MONTHLY * 12;

/**
 * EPF wage ceiling for an Indian tax year (April `fyYear` → March `fyYear + 1`), as an
 * annual figure. FY 2026-27 straddles the change: April–August and 1–16 September at
 * ₹15,000, 17–30 September and October–March at ₹25,000 (September pro-rated by days,
 * the way payroll applies it).
 */
export function getEpfAnnualWageCap(fyYear: number): number {
  if (fyYear <= 2025) return EPF_CEILING_OLD_MONTHLY * 12;
  if (fyYear >= 2027) return EPF_CEILING_NEW_MONTHLY * 12;
  const september = (EPF_CEILING_OLD_MONTHLY * 16 + EPF_CEILING_NEW_MONTHLY * 14) / 30;
  return Math.round(EPF_CEILING_OLD_MONTHLY * 5 + september + EPF_CEILING_NEW_MONTHLY * 6);
}

/** Monthly EPF ceiling in force for most of the tax year — for labels. */
export function getEpfMonthlyCeilingLabel(fyYear: number): number {
  return fyYear >= 2026 ? EPF_CEILING_NEW_MONTHLY : EPF_CEILING_OLD_MONTHLY;
}

/** Gratuity rate: 4.81% of Basic (15/26 * 1/12 * basic) */
const GRATUITY_RATE = 0.0481;

/** Standard deduction — New regime (FY 2025-26 onward) — salary/pension income only */
const STD_DEDUCTION_NEW = 75000;

/** Standard deduction — Old regime */
const STD_DEDUCTION_OLD = 50000;

/** Health & Education Cess */
const CESS_RATE = 0.04;

// ─── New Tax Regime Slabs (FY 2025-26, unchanged for 2026-27) ─

const NEW_REGIME_SLABS = [
  { upTo: 400000, rate: 0 },
  { upTo: 800000, rate: 0.05 },
  { upTo: 1200000, rate: 0.10 },
  { upTo: 1600000, rate: 0.15 },
  { upTo: 2000000, rate: 0.20 },
  { upTo: 2400000, rate: 0.25 },
  { upTo: Infinity, rate: 0.30 },
];

/** Section 87A rebate: New regime — taxable income ≤ Rs 12L, rebate up to Rs 60K */
const REBATE_87A_NEW_LIMIT = 1200000;
const REBATE_87A_NEW_MAX = 60000;

// ─── Old Tax Regime Slabs ──────────────────────────────────

const OLD_REGIME_SLABS = [
  { upTo: 250000, rate: 0 },
  { upTo: 500000, rate: 0.05 },
  { upTo: 1000000, rate: 0.20 },
  { upTo: Infinity, rate: 0.30 },
];

/** Section 87A rebate: Old regime — taxable income ≤ Rs 5L, rebate up to Rs 12.5K */
const REBATE_87A_OLD_LIMIT = 500000;
const REBATE_87A_OLD_MAX = 12500;

// ─── Surcharge Tiers ───────────────────────────────────────

const SURCHARGE_TIERS = [
  { above: 50000000, rate: 0.37 },  // > 5 Cr
  { above: 20000000, rate: 0.25 },  // > 2 Cr
  { above: 10000000, rate: 0.15 },  // > 1 Cr
  { above: 5000000, rate: 0.10 },   // > 50 L
  { above: 0, rate: 0 },
];

// New regime surcharge cap: max 25% regardless of income
const NEW_REGIME_SURCHARGE_CAP = 0.25;

// ─── Professional Tax Rates (State-wise) ───────────────────

export const PROFESSIONAL_TAX_RATES: Record<string, number> = {
  Maharashtra: 2500,
  Karnataka: 2400,
  "West Bengal": 2500,
  "Andhra Pradesh": 2500,
  Telangana: 2500,
  "Tamil Nadu": 2500,
  Gujarat: 2500,
  Kerala: 2500,
  "Madhya Pradesh": 2500,
  Odisha: 2500,
  Bihar: 2500,
  Assam: 2500,
  Jharkhand: 2400,
  Meghalaya: 2500,
  Tripura: 2500,
  Sikkim: 2500,
  Manipur: 2500,
  Mizoram: 2500,
  "Arunachal Pradesh": 0,
  Nagaland: 0,
  Delhi: 0,
  "Himachal Pradesh": 0,
  "Jammu & Kashmir": 0,
  Uttarakhand: 0,
  Punjab: 0,
  Haryana: 0,
  Rajasthan: 0,
  Chhattisgarh: 2500,
  Goa: 2500,
};

export const STATE_LIST = Object.keys(PROFESSIONAL_TAX_RATES).sort();

// ─── Core Calculations ─────────────────────────────────────

/**
 * Break CTC into components.
 *
 * `gratuityInCTC` defaults to true (matches historical behaviour). When false,
 * gratuity is treated as a pay-out on top of CTC — it doesn't eat into special
 * allowance and doesn't reduce gross salary.
 */
export function calculateCTCBreakdown(
  annualCTC: number,
  basicPct: number,
  hraPct: number,
  epfMode: "full_basic" | "restricted",
  epfInCTC: boolean,
  gratuityInCTC: boolean = true,
  manualBreakdown?: ManualCTCBreakdown,
  /** Annual EPF wage ceiling for "restricted" mode — see getEpfAnnualWageCap. */
  epfAnnualWageCap: number = EPF_LEGACY_ANNUAL_CAP,
): CTCBreakdown {
  if (manualBreakdown) {
    const basic = manualBreakdown.basic;
    const hra = manualBreakdown.hra;
    const employerEPF = manualBreakdown.employerEPF;
    const gratuity = manualBreakdown.gratuity;

    // Special allowance: if user provided a value, use it; else derive from remainder
    let specialAllowance = manualBreakdown.specialAllowance;
    if (!specialAllowance || specialAllowance <= 0) {
      const subtracted =
        basic + hra +
        (epfInCTC ? employerEPF : 0) +
        (gratuityInCTC ? gratuity : 0);
      specialAllowance = Math.max(annualCTC - subtracted, 0);
    }

    const grossSalary =
      annualCTC -
      (epfInCTC ? employerEPF : 0) -
      (gratuityInCTC ? gratuity : 0);

    return {
      annualCTC,
      basic,
      hra,
      specialAllowance,
      employerEPF,
      gratuity,
      grossSalary,
    };
  }

  const basic = annualCTC * (basicPct / 100);
  const hra = basic * (hraPct / 100);
  const gratuity = basic * GRATUITY_RATE;

  // Employer EPF contribution
  const epfBase =
    epfMode === "restricted"
      ? Math.min(basic, epfAnnualWageCap)
      : basic;
  const employerEPF = epfBase * 0.12;

  // Special allowance = CTC minus everything else (conditionally)
  const epfInSubtraction = epfInCTC ? employerEPF : 0;
  const gratuityInSubtraction = gratuityInCTC ? gratuity : 0;
  let specialAllowance =
    annualCTC - basic - hra - epfInSubtraction - gratuityInSubtraction;
  specialAllowance = Math.max(specialAllowance, 0);

  // Gross salary: what the employee sees before tax.
  // Only subtract components that are actually part of CTC.
  const grossSalary = annualCTC - epfInSubtraction - gratuityInSubtraction;

  return {
    annualCTC,
    basic,
    hra,
    specialAllowance,
    employerEPF,
    gratuity,
    grossSalary,
  };
}

/**
 * Calculate EPF contributions.
 */
export function calculateEPF(
  annualBasic: number,
  epfMode: "full_basic" | "restricted",
  vpfMonthly: number,
  /** Annual EPF wage ceiling for "restricted" mode — see getEpfAnnualWageCap. */
  epfAnnualWageCap: number = EPF_LEGACY_ANNUAL_CAP,
): EPFResult {
  const epfBase =
    epfMode === "restricted"
      ? Math.min(annualBasic, epfAnnualWageCap)
      : annualBasic;

  const employeeContribution = epfBase * 0.12;
  const employerEPF = epfBase * 0.0367;
  const employerEPS = epfBase * 0.0833;
  const totalEmployerContribution = epfBase * 0.12;
  const vpf = vpfMonthly * 12;

  return {
    employeeContribution,
    employerEPF,
    employerEPS,
    totalEmployerContribution,
    vpf,
    totalDeducted: employeeContribution + vpf,
  };
}

/**
 * Calculate tax using slab rates.
 */
function calculateSlabTax(
  taxableIncome: number,
  slabs: typeof NEW_REGIME_SLABS,
): number {
  if (taxableIncome <= 0) return 0;

  let tax = 0;
  let remaining = taxableIncome;
  let prevLimit = 0;

  for (const slab of slabs) {
    const slabWidth = slab.upTo === Infinity ? remaining : slab.upTo - prevLimit;
    const taxableInSlab = Math.min(remaining, slabWidth);
    tax += taxableInSlab * slab.rate;
    remaining -= taxableInSlab;
    prevLimit = slab.upTo;
    if (remaining <= 0) break;
  }

  return tax;
}

/**
 * Calculate surcharge on tax amount, with marginal relief at every tier threshold.
 *
 * Marginal relief rule: when income just crosses a surcharge threshold, the
 * (tax + surcharge) after crossing shall not exceed
 *   (tax-at-threshold) + (income - threshold)
 * i.e. the extra tax+surcharge from crossing never exceeds the extra income.
 *
 * Returns the effective surcharge amount (capped by relief where applicable).
 */
function calculateSurcharge(
  taxableIncome: number,
  baseTax: number,
  isNewRegime: boolean,
): number {
  let rate = 0;
  let threshold = 0;
  for (const tier of SURCHARGE_TIERS) {
    if (taxableIncome > tier.above) {
      rate = tier.rate;
      threshold = tier.above;
      break;
    }
  }

  // New regime caps surcharge at 25%
  if (isNewRegime && rate > NEW_REGIME_SURCHARGE_CAP) {
    rate = NEW_REGIME_SURCHARGE_CAP;
  }

  if (rate === 0 || threshold === 0) return 0;

  const rawSurcharge = baseTax * rate;

  // Marginal relief: compare to tax at the threshold (no surcharge there).
  // (baseTax + surcharge) - baseTaxAtThreshold shall not exceed (income - threshold).
  const slabs = isNewRegime ? NEW_REGIME_SLABS : OLD_REGIME_SLABS;
  const baseTaxAtThreshold = calculateSlabTax(threshold, slabs);
  const maxExtra = Math.max(taxableIncome - threshold, 0);
  const currentExtra = baseTax + rawSurcharge - baseTaxAtThreshold;

  if (currentExtra > maxExtra) {
    // Relief applies — surcharge capped so total = baseTaxAtThreshold + maxExtra
    const reliefSurcharge = baseTaxAtThreshold + maxExtra - baseTax;
    return Math.max(reliefSurcharge, 0);
  }

  return rawSurcharge;
}

/**
 * New Tax Regime calculation for salary income (standard deduction applied).
 * Slabs, rebate and standard deduction are unchanged for FY 2025-26 and FY 2026-27.
 */
export function calculateNewRegimeTax(grossSalary: number): TaxResult {
  const taxableIncome = Math.max(grossSalary - STD_DEDUCTION_NEW, 0);
  return newRegimeTaxOnTaxable(taxableIncome, grossSalary);
}

/**
 * New regime tax on an already-computed taxable income. Shared by salary (after
 * standard deduction) and business income (which gets no standard deduction).
 * `rateBase` is the figure the effective rate is expressed against.
 */
function newRegimeTaxOnTaxable(taxableIncome: number, rateBase: number): TaxResult {
  const baseTax = calculateSlabTax(taxableIncome, NEW_REGIME_SLABS);

  // Section 87A rebate: if taxable ≤ Rs 12L, rebate up to Rs 60K
  let rebate87A = 0;
  if (taxableIncome <= REBATE_87A_NEW_LIMIT) {
    rebate87A = Math.min(baseTax, REBATE_87A_NEW_MAX);
  }

  let taxAfterRebate = Math.max(baseTax - rebate87A, 0);

  // Marginal relief at the 87A cliff: when taxable income just exceeds Rs 12L,
  // tax+surcharge+cess shall not exceed (taxable - 12L). The Finance Act protects
  // people from paying more extra tax than they earned extra.
  let marginalRelief = 0;
  if (
    taxableIncome > REBATE_87A_NEW_LIMIT &&
    taxAfterRebate > taxableIncome - REBATE_87A_NEW_LIMIT
  ) {
    const cap = taxableIncome - REBATE_87A_NEW_LIMIT;
    marginalRelief = taxAfterRebate - cap;
    taxAfterRebate = cap;
  }

  const surcharge = calculateSurcharge(taxableIncome, taxAfterRebate, true);
  const cess = (taxAfterRebate + surcharge) * CESS_RATE;
  const totalTax = taxAfterRebate + surcharge + cess;
  const effectiveRate = rateBase > 0 ? (totalTax / rateBase) * 100 : 0;

  return {
    taxableIncome,
    baseTax,
    surcharge,
    cess,
    rebate87A,
    marginalRelief: Math.round(marginalRelief),
    totalTax: Math.round(totalTax),
    effectiveRate: Math.round(effectiveRate * 100) / 100,
  };
}

/**
 * Old Tax Regime calculation.
 *
 * Professional tax (up to Rs 2,500/year) is deductible from salary income under
 * Section 16(iii) in the old regime. Pass via the optional `professionalTax` field.
 */
export function calculateOldRegimeTax(
  grossSalary: number,
  deductions: {
    section80C: number;
    section80D: number;
    hraExemption: number;
    homeLoanInterest: number;
    otherDeductions: number;
    professionalTax?: number;
  },
): TaxResult {
  const standardDeduction = STD_DEDUCTION_OLD;
  const totalDeductions =
    standardDeduction +
    Math.min(deductions.section80C, 150000) + // 80C cap
    Math.min(deductions.section80D, 75000) + // 80D cap (self + parents, senior)
    deductions.hraExemption +
    Math.min(deductions.homeLoanInterest, 200000) + // Section 24b cap
    deductions.otherDeductions +
    (deductions.professionalTax ?? 0); // Section 16(iii)

  const taxableIncome = Math.max(grossSalary - totalDeductions, 0);
  return oldRegimeTaxOnTaxable(taxableIncome, grossSalary);
}

/**
 * Old regime tax on an already-computed taxable income (all deductions applied).
 */
function oldRegimeTaxOnTaxable(taxableIncome: number, rateBase: number): TaxResult {
  const baseTax = calculateSlabTax(taxableIncome, OLD_REGIME_SLABS);

  // Section 87A rebate: if taxable ≤ Rs 5L, rebate up to Rs 12.5K
  let rebate87A = 0;
  if (taxableIncome <= REBATE_87A_OLD_LIMIT) {
    rebate87A = Math.min(baseTax, REBATE_87A_OLD_MAX);
  }

  let taxAfterRebate = Math.max(baseTax - rebate87A, 0);

  // Marginal relief at the 87A cliff (old regime, Rs 5L).
  let marginalRelief = 0;
  if (
    taxableIncome > REBATE_87A_OLD_LIMIT &&
    taxAfterRebate > taxableIncome - REBATE_87A_OLD_LIMIT
  ) {
    const cap = taxableIncome - REBATE_87A_OLD_LIMIT;
    marginalRelief = taxAfterRebate - cap;
    taxAfterRebate = cap;
  }

  const surcharge = calculateSurcharge(taxableIncome, taxAfterRebate, false);
  const cess = (taxAfterRebate + surcharge) * CESS_RATE;
  const totalTax = taxAfterRebate + surcharge + cess;
  const effectiveRate = rateBase > 0 ? (totalTax / rateBase) * 100 : 0;

  return {
    taxableIncome,
    baseTax,
    surcharge,
    cess,
    rebate87A,
    marginalRelief: Math.round(marginalRelief),
    totalTax: Math.round(totalTax),
    effectiveRate: Math.round(effectiveRate * 100) / 100,
  };
}

/**
 * Full salary calculation: CTC → Monthly In-Hand.
 */
export function calculateSalary(input: TaxInput): SalaryCalculation {
  const ctcBreakdown = calculateCTCBreakdown(
    input.annualCTC,
    input.basicPct,
    input.hraPct,
    input.epfMode,
    input.epfInCTC,
    input.gratuityInCTC ?? true,
    input.manualBreakdown,
    input.epfAnnualWageCap,
  );

  const epf = calculateEPF(
    ctcBreakdown.basic,
    input.epfMode,
    input.vpfMonthly,
    input.epfAnnualWageCap,
  );

  const newRegimeTax = calculateNewRegimeTax(ctcBreakdown.grossSalary);

  const oldRegimeTax = calculateOldRegimeTax(ctcBreakdown.grossSalary, {
    section80C: input.deductions80C + epf.employeeContribution, // EPF counts under 80C
    section80D: input.deductions80D,
    hraExemption: input.hraExemptionAnnual,
    homeLoanInterest: input.homeLoanInterest,
    otherDeductions: input.otherDeductions,
    professionalTax: input.professionalTaxAnnual, // Section 16(iii)
  });

  const professionalTaxAnnual = input.professionalTaxAnnual;

  // Calculate in-hand using the better regime
  const selectedRegime =
    newRegimeTax.totalTax <= oldRegimeTax.totalTax ? "new" : "old";
  const selectedTax =
    selectedRegime === "new" ? newRegimeTax : oldRegimeTax;

  const annualInHand =
    ctcBreakdown.grossSalary -
    selectedTax.totalTax -
    epf.totalDeducted -
    professionalTaxAnnual;

  const monthlyInHand = annualInHand / 12;

  return {
    ctcBreakdown,
    epf,
    newRegimeTax,
    oldRegimeTax,
    professionalTaxAnnual,
    annualInHand,
    monthlyInHand,
    selectedRegime,
  };
}

/**
 * Get professional tax for a state.
 */
export function getProfessionalTax(state: string | null): number {
  if (!state) return 2400; // default
  return PROFESSIONAL_TAX_RATES[state] ?? 2400;
}

// ─── Capital Gains Tax ────────────────────────────────────

export interface CapitalGainsTaxInput {
  equity_ltcg: number; // Listed equity & equity MFs — long term
  equity_stcg: number; // Listed equity & equity MFs — short term
  debt: number; // Debt MFs — taxed at slab rate
  fd: number; // Fixed deposit interest — taxed at slab rate
  gold: number; // Gold LTCG
  real_estate: number; // Real estate LTCG
  /** Crypto / virtual digital assets: flat 30%, no exemption, losses offset nothing. */
  crypto?: number;
}

export interface CapitalGainsTaxItem {
  label: string;
  gross: number;
  tax: number;
  net: number;
  rate: string; // Display rate (e.g. "12.5%", "slab")
}

export interface CapitalGainsTaxResult {
  items: CapitalGainsTaxItem[];
  totalGross: number;
  totalTax: number;
  totalNet: number;
}

/** Equity LTCG exemption limit per FY */
const EQUITY_LTCG_EXEMPTION = 125000;

/**
 * Compute tax on capital gains by asset class.
 *
 * Fixed rates: equity LTCG 12.5%, equity STCG 20%, gold LTCG 12.5%, real estate LTCG 12.5%
 * Slab-rated: debt MF, FD interest (needs total income for slab rate — uses effective slab rate)
 */
export function computeCapitalGainsTax(
  gains: CapitalGainsTaxInput,
  totalSalaryIncome: number,
  taxRegime: "new" | "old",
  /**
   * Deduction taken off the base income before finding its slab. Defaults to the
   * salaried standard deduction; pass 0 when the base is business income, which has none.
   */
  standardDeduction?: number,
): CapitalGainsTaxResult {
  const items: CapitalGainsTaxItem[] = [];

  // Apply 4% health & education cess to flat-rate CG items.
  // Slab-rated items (debt MF, FD) already include cess via computeMarginalSlabTax.
  const withCess = (tax: number) => Math.round(tax + tax * CESS_RATE);

  // 1. Equity LTCG: 12.5% on amount exceeding Rs 1.25L exemption
  if (gains.equity_ltcg > 0) {
    const taxable = Math.max(gains.equity_ltcg - EQUITY_LTCG_EXEMPTION, 0);
    const tax = withCess(taxable * 0.125);
    items.push({
      label: "Equity LTCG",
      gross: gains.equity_ltcg,
      tax,
      net: gains.equity_ltcg - tax,
      rate: "12.5%",
    });
  }

  // 2. Equity STCG: flat 20%
  if (gains.equity_stcg > 0) {
    const tax = withCess(gains.equity_stcg * 0.20);
    items.push({
      label: "Equity STCG",
      gross: gains.equity_stcg,
      tax,
      net: gains.equity_stcg - tax,
      rate: "20%",
    });
  }

  // 3. Debt MF: slab rate (marginal — on top of salary income)
  if (gains.debt > 0) {
    const tax = computeMarginalSlabTax(totalSalaryIncome, gains.debt, taxRegime, standardDeduction);
    items.push({
      label: "Debt MF",
      gross: gains.debt,
      tax,
      net: gains.debt - tax,
      rate: "Slab",
    });
  }

  // 4. FD interest: slab rate
  if (gains.fd > 0) {
    const tax = computeMarginalSlabTax(totalSalaryIncome + gains.debt, gains.fd, taxRegime, standardDeduction);
    items.push({
      label: "FD Interest",
      gross: gains.fd,
      tax,
      net: gains.fd - tax,
      rate: "Slab",
    });
  }

  // 5. Gold LTCG: 12.5%
  if (gains.gold > 0) {
    const tax = withCess(gains.gold * 0.125);
    items.push({
      label: "Gold LTCG",
      gross: gains.gold,
      tax,
      net: gains.gold - tax,
      rate: "12.5%",
    });
  }

  // 6. Real Estate LTCG: 12.5%
  if (gains.real_estate > 0) {
    const tax = withCess(gains.real_estate * 0.125);
    items.push({
      label: "Real Estate",
      gross: gains.real_estate,
      tax,
      net: gains.real_estate - tax,
      rate: "12.5%",
    });
  }

  // 7. Crypto (virtual digital assets): flat 30% on the gain whatever the holding period, no
  //    exemption, and a loss can't be set off against anything - so only gains reach here.
  if ((gains.crypto ?? 0) > 0) {
    const crypto = gains.crypto ?? 0;
    const tax = withCess(crypto * 0.3);
    items.push({
      label: "Crypto",
      gross: crypto,
      tax,
      net: crypto - tax,
      rate: "30%",
    });
  }

  const totalGross = items.reduce((s, i) => s + i.gross, 0);
  const totalTax = items.reduce((s, i) => s + i.tax, 0);

  return {
    items,
    totalGross,
    totalTax,
    totalNet: totalGross - totalTax,
  };
}

/**
 * Compute marginal slab tax: tax on (base + additional) minus tax on (base alone).
 * Used for income taxed at slab rate on top of existing income.
 *
 * Runs the full regime calculation both times, so the 87A rebate, marginal relief and
 * surcharge are respected. (Slab-only arithmetic charged tax on, say, ₹1L of FD interest
 * on top of a ₹9L salary, when the whole ₹10L is covered by the new-regime rebate.)
 */
function computeMarginalSlabTax(
  baseIncome: number,
  additionalIncome: number,
  taxRegime: "new" | "old",
  standardDeduction?: number,
): number {
  const stdDeduction = standardDeduction ?? (taxRegime === "new" ? STD_DEDUCTION_NEW : STD_DEDUCTION_OLD);
  const taxableBase = Math.max(baseIncome - stdDeduction, 0);
  const taxableWithAdditional = Math.max(baseIncome + additionalIncome - stdDeduction, 0);
  return Math.max(
    regimeTaxOnTaxable(taxRegime, taxableWithAdditional) - regimeTaxOnTaxable(taxRegime, taxableBase),
    0,
  );
}

/** Total tax (after rebate, relief, surcharge, cess) on a taxable income. */
function regimeTaxOnTaxable(regime: "new" | "old", taxable: number): number {
  return regime === "new"
    ? newRegimeTaxOnTaxable(taxable, taxable).totalTax
    : oldRegimeTaxOnTaxable(taxable, taxable).totalTax;
}

// ─── Bonus Tax (Marginal Method) ──────────────────────────

export interface BonusTaxResult {
  grossBonus: number;
  taxOnBonus: number;
  netBonus: number;
  effectiveRate: number; // percentage
}

/**
 * Compute marginal tax on bonus.
 *
 * Method: tax on (salary + bonus) - tax on (salary alone), in the selected regime.
 */
export function computeBonusTax(
  annualSalaryIncome: number,
  bonusAmount: number,
  taxRegime: "new" | "old",
  /** Deduction taken off the salary before stacking the bonus. Defaults to the standard deduction. */
  standardDeduction?: number,
): BonusTaxResult {
  if (bonusAmount <= 0) {
    return { grossBonus: 0, taxOnBonus: 0, netBonus: 0, effectiveRate: 0 };
  }

  // Marginal tax = tax on (salary + bonus) − tax on salary alone, through the full
  // regime calculation so a bonus that stays inside the 87A rebate is tax-free.
  const taxOnBonus = computeMarginalSlabTax(annualSalaryIncome, bonusAmount, taxRegime, standardDeduction);

  const netBonus = bonusAmount - taxOnBonus;
  const effectiveRate = bonusAmount > 0
    ? Math.round((taxOnBonus / bonusAmount) * 10000) / 100
    : 0;

  return {
    grossBonus: bonusAmount,
    taxOnBonus,
    netBonus,
    effectiveRate,
  };
}

// ─── Business / Professional Income ───────────────────────

/**
 * How a self-employed person's profit is worked out for tax.
 *
 * - presumptive_profession: 44ADA (Section 58 of the Income-tax Act 2025) — 50% of
 *   receipts is deemed profit. Doctors, lawyers, consultants, designers, developers, etc.
 * - presumptive_business: 44AD (Section 58) — 6% of digital + 8% of cash turnover is
 *   deemed profit. Traders, shops, small businesses, contractors.
 * - regular: books of account — profit = receipts − business expenses.
 */
export type BusinessScheme = "presumptive_profession" | "presumptive_business" | "regular";

export interface BusinessIncomeInput {
  scheme: BusinessScheme;
  /** Annual receipts / turnover, excluding GST collected. */
  grossReceipts: number;
  /** Share of receipts received through banking channels (UPI, NEFT, cheque, card), 0–100. */
  digitalReceiptsPct: number;
  /** Annual running costs of the business. Reduce tax only under regular books; always reduce in-hand. */
  businessExpenses: number;
  /** % of receipts that clients withhold as TDS (e.g. 10 for professional fees). */
  tdsPct: number;
  professionalTaxAnnual: number;
  // Old regime deductions
  deductions80C: number;
  deductions80D: number;
  homeLoanInterest: number;
  otherDeductions: number;
}

export interface BusinessIncomeCalculation {
  /** Scheme the user picked. */
  scheme: BusinessScheme;
  /** Scheme actually used — falls back to "regular" when receipts exceed the presumptive limit. */
  appliedScheme: BusinessScheme;
  /** Receipts limit for the picked presumptive scheme (null for regular). */
  presumptiveLimit: number | null;
  exceedsPresumptiveLimit: boolean;
  /** Profit the tax is computed on, before old-regime deductions. */
  taxableProfit: number;
  /** Receipts − expenses − professional tax: what the business actually earns. */
  actualProfit: number;
  /**
   * Presumptive scheme with actual profit below the deemed profit. Declaring the lower
   * figure needs a tax audit, so the estimate keeps the deemed profit.
   */
  actualBelowDeemed: boolean;
  newRegimeTax: TaxResult;
  oldRegimeTax: TaxResult;
  selectedRegime: "new" | "old";
  /** TDS withheld by clients over the year — already counts towards the tax bill. */
  tdsCredit: number;
  professionalTaxAnnual: number;
  /** Receipts − expenses − professional tax − income tax. TDS is part of the tax, not extra. */
  annualInHand: number;
  monthlyInHand: number;
}

/** 44ADA: 50% of gross receipts is deemed profit. */
const PRESUMPTIVE_PROFESSION_RATE = 0.5;
/** 44AD: 6% of digital turnover, 8% of cash turnover. */
const PRESUMPTIVE_BUSINESS_DIGITAL_RATE = 0.06;
const PRESUMPTIVE_BUSINESS_CASH_RATE = 0.08;
/** Receipts limits. The higher limit applies when cash receipts are at most 5% of the total. */
const PRESUMPTIVE_PROFESSION_LIMIT = 5000000;
const PRESUMPTIVE_PROFESSION_LIMIT_DIGITAL = 7500000;
const PRESUMPTIVE_BUSINESS_LIMIT = 20000000;
const PRESUMPTIVE_BUSINESS_LIMIT_DIGITAL = 30000000;
const PRESUMPTIVE_MAX_CASH_PCT = 5;

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 100;
  return Math.min(Math.max(v, 0), 100);
}

/** Receipts limit for a presumptive scheme, given the share of digital receipts. */
export function getPresumptiveLimit(
  scheme: BusinessScheme,
  digitalReceiptsPct: number,
): number | null {
  if (scheme === "regular") return null;
  const mostlyDigital = 100 - clampPct(digitalReceiptsPct) <= PRESUMPTIVE_MAX_CASH_PCT;
  if (scheme === "presumptive_profession") {
    return mostlyDigital ? PRESUMPTIVE_PROFESSION_LIMIT_DIGITAL : PRESUMPTIVE_PROFESSION_LIMIT;
  }
  return mostlyDigital ? PRESUMPTIVE_BUSINESS_LIMIT_DIGITAL : PRESUMPTIVE_BUSINESS_LIMIT;
}

/**
 * Business / freelance income: receipts → taxable profit → tax (both regimes) → in-hand.
 *
 * No standard deduction (that is for salary and pension only). The 87A rebate, marginal
 * relief, surcharge and cess apply exactly as for salary.
 */
export function calculateBusinessIncome(input: BusinessIncomeInput): BusinessIncomeCalculation {
  const receipts = Math.max(input.grossReceipts, 0);
  const expenses = Math.max(input.businessExpenses, 0);
  const profTax = Math.max(input.professionalTaxAnnual, 0);
  const digitalPct = clampPct(input.digitalReceiptsPct);

  const presumptiveLimit = getPresumptiveLimit(input.scheme, digitalPct);
  const exceedsPresumptiveLimit = presumptiveLimit !== null && receipts > presumptiveLimit;
  const appliedScheme: BusinessScheme = exceedsPresumptiveLimit ? "regular" : input.scheme;

  const actualProfit = receipts - expenses - profTax;

  let taxableProfit: number;
  if (appliedScheme === "presumptive_profession") {
    taxableProfit = receipts * PRESUMPTIVE_PROFESSION_RATE;
  } else if (appliedScheme === "presumptive_business") {
    const digital = receipts * (digitalPct / 100);
    taxableProfit =
      digital * PRESUMPTIVE_BUSINESS_DIGITAL_RATE +
      (receipts - digital) * PRESUMPTIVE_BUSINESS_CASH_RATE;
  } else {
    // Professional tax paid is a business expense under regular books.
    taxableProfit = Math.max(actualProfit, 0);
  }
  taxableProfit = Math.round(taxableProfit);

  const actualBelowDeemed = appliedScheme !== "regular" && actualProfit < taxableProfit;

  const newRegimeTax = newRegimeTaxOnTaxable(taxableProfit, taxableProfit);

  const oldDeductions =
    Math.min(input.deductions80C, 150000) +
    Math.min(input.deductions80D, 75000) +
    Math.min(input.homeLoanInterest, 200000) +
    input.otherDeductions;
  const oldRegimeTax = oldRegimeTaxOnTaxable(
    Math.max(taxableProfit - oldDeductions, 0),
    taxableProfit,
  );

  const selectedRegime = newRegimeTax.totalTax <= oldRegimeTax.totalTax ? "new" : "old";
  const selectedTax = selectedRegime === "new" ? newRegimeTax : oldRegimeTax;

  const tdsCredit = Math.round(receipts * (Math.min(Math.max(input.tdsPct, 0), 100) / 100));
  const annualInHand = receipts - expenses - profTax - selectedTax.totalTax;

  return {
    scheme: input.scheme,
    appliedScheme,
    presumptiveLimit,
    exceedsPresumptiveLimit,
    taxableProfit,
    actualProfit,
    actualBelowDeemed,
    newRegimeTax,
    oldRegimeTax,
    selectedRegime,
    tdsCredit,
    professionalTaxAnnual: profTax,
    annualInHand,
    monthlyInHand: annualInHand / 12,
  };
}

// ─── Advance Tax ──────────────────────────────────────────

export interface AdvanceTaxInstalment {
  /** ISO date (YYYY-MM-DD). */
  dueDate: string;
  /** Share of the year's net tax that must be paid by this date, 0–100. */
  cumulativePct: number;
  /** Amount to pay in this instalment. */
  amount: number;
}

export interface AdvanceTaxPlan {
  totalTax: number;
  tdsCredit: number;
  /** Tax still owed after TDS. */
  netPayable: number;
  /** TDS in excess of the tax — comes back as a refund after filing the return. */
  refundExpected: number;
  /** Advance tax is only required when the net amount is ₹10,000 or more. */
  required: boolean;
  instalments: AdvanceTaxInstalment[];
}

/** No advance tax is due when the year's tax, after TDS, is below this. */
const ADVANCE_TAX_THRESHOLD = 10000;

/**
 * Advance tax instalments for a tax year starting April `taxYearStart`.
 * Regular: 15% by 15 Jun, 45% by 15 Sep, 75% by 15 Dec, 100% by 15 Mar.
 * Presumptive (44AD / 44ADA): everything by 15 Mar.
 */
export function computeAdvanceTaxSchedule(
  totalTax: number,
  tdsCredit: number,
  taxYearStart: number,
  presumptive: boolean,
): AdvanceTaxPlan {
  const netPayable = Math.max(Math.round(totalTax - tdsCredit), 0);
  const refundExpected = Math.max(Math.round(tdsCredit - totalTax), 0);
  const required = netPayable >= ADVANCE_TAX_THRESHOLD;

  const steps: Array<{ dueDate: string; cumulativePct: number }> = presumptive
    ? [{ dueDate: `${taxYearStart + 1}-03-15`, cumulativePct: 100 }]
    : [
        { dueDate: `${taxYearStart}-06-15`, cumulativePct: 15 },
        { dueDate: `${taxYearStart}-09-15`, cumulativePct: 45 },
        { dueDate: `${taxYearStart}-12-15`, cumulativePct: 75 },
        { dueDate: `${taxYearStart + 1}-03-15`, cumulativePct: 100 },
      ];

  const instalments: AdvanceTaxInstalment[] = [];
  if (required) {
    let paidSoFar = 0;
    for (const step of steps) {
      const cumulative = Math.round((netPayable * step.cumulativePct) / 100);
      instalments.push({ ...step, amount: cumulative - paidSoFar });
      paidSoFar = cumulative;
    }
  }

  return { totalTax, tdsCredit, netPayable, refundExpected, required, instalments };
}

// ─── Other Income: side business + rent ───────────────────

export interface RentalIncomeInput {
  /** Rent received for the year from a let-out property. */
  annualRent: number;
  /** Municipal / property tax paid on it. */
  municipalTax: number;
  /** Home-loan interest paid on the let-out property. */
  loanInterest: number;
}

/**
 * Income from a let-out house property: (rent − municipal tax) less 30% standard
 * deduction, less loan interest. Negative when interest exceeds the rest.
 */
export function computeLetOutIncome(r: RentalIncomeInput): number {
  const annualValue = Math.max(r.annualRent - r.municipalTax, 0);
  return Math.round(annualValue * 0.7 - Math.max(r.loanInterest, 0));
}

/** A house-property loss can be set off against other income only up to this, old regime only. */
const HOUSE_PROPERTY_LOSS_SETOFF_CAP = 200000;

export interface OtherIncomeInput {
  /** Primary income's taxable figure in each regime (after its own deductions). */
  baseTaxableNew: number;
  baseTaxableOld: number;
  /** Primary income's tax in the regime it was computed in. */
  primaryTax: number;
  /** Self-occupied home-loan interest already claimed in the old-regime base (shares the ₹2L loss cap). */
  selfOccupiedInterestClaimed: number;
  /** Side business / freelance (null when none). Its professional tax and old-regime deductions are ignored. */
  sideBusiness: BusinessIncomeInput | null;
  rental: RentalIncomeInput | null;
}

export interface OtherIncomeResult {
  sideBusiness: BusinessIncomeCalculation | null;
  /** Taxable side-business profit. */
  sideBusinessProfit: number;
  /** Let-out property income as computed (can be negative). */
  rentalIncome: number;
  /** Rental figure actually added in each regime (loss not allowed in new, capped in old). */
  rentalCountedNew: number;
  rentalCountedOld: number;
  /** Tax on everything combined, in each regime. */
  combinedTaxNew: number;
  combinedTaxOld: number;
  /** Cheaper regime for the combined income. */
  bestRegime: "new" | "old";
  combinedTax: number;
  /** Extra tax the other income adds over the primary's tax. Never below zero. */
  extraTax: number;
  /** Cash the other income brings in: side receipts − side expenses + rent − municipal tax. */
  grossCash: number;
  /** grossCash − extraTax. */
  netCash: number;
  /** TDS withheld on the side business. */
  tdsCredit: number;
}

/**
 * Tax on side income (freelance / business, rent) stacked on a primary income.
 *
 * Tax is progressive over TOTAL income, so the side income is not taxed on its own:
 * the combined income is taxed in both regimes and the extra over the primary's tax
 * is what the side income costs.
 */
export function calculateOtherIncome(input: OtherIncomeInput): OtherIncomeResult {
  const side = input.sideBusiness
    ? calculateBusinessIncome({
        ...input.sideBusiness,
        professionalTaxAnnual: 0,
        deductions80C: 0,
        deductions80D: 0,
        homeLoanInterest: 0,
        otherDeductions: 0,
      })
    : null;
  const sideBusinessProfit = side?.taxableProfit ?? 0;

  const rentalIncome = input.rental ? computeLetOutIncome(input.rental) : 0;
  const rentalCountedNew = Math.max(rentalIncome, 0);
  const lossRoomOld = Math.max(
    HOUSE_PROPERTY_LOSS_SETOFF_CAP - Math.min(input.selfOccupiedInterestClaimed, HOUSE_PROPERTY_LOSS_SETOFF_CAP),
    0,
  );
  const rentalCountedOld = Math.max(rentalIncome, -lossRoomOld);

  const combinedTaxNew = regimeTaxOnTaxable(
    "new",
    Math.max(input.baseTaxableNew + sideBusinessProfit + rentalCountedNew, 0),
  );
  const combinedTaxOld = regimeTaxOnTaxable(
    "old",
    Math.max(input.baseTaxableOld + sideBusinessProfit + rentalCountedOld, 0),
  );
  const bestRegime = combinedTaxNew <= combinedTaxOld ? "new" : "old";
  const combinedTax = Math.min(combinedTaxNew, combinedTaxOld);
  const extraTax = Math.max(combinedTax - input.primaryTax, 0);

  const sideCash = input.sideBusiness
    ? Math.max(input.sideBusiness.grossReceipts, 0) - Math.max(input.sideBusiness.businessExpenses, 0)
    : 0;
  const rentCash = input.rental
    ? Math.max(input.rental.annualRent, 0) - Math.max(input.rental.municipalTax, 0)
    : 0;
  const grossCash = sideCash + rentCash;

  return {
    sideBusiness: side,
    sideBusinessProfit,
    rentalIncome,
    rentalCountedNew,
    rentalCountedOld,
    combinedTaxNew,
    combinedTaxOld,
    bestRegime,
    combinedTax,
    extraTax,
    grossCash,
    netCash: grossCash - extraTax,
    tdsCredit: side?.tdsCredit ?? 0,
  };
}

// ─── Actual receipts (bank credits → gross receipts) ──────

/**
 * Turn money that reached the bank into the receipts figure the tax is based on.
 *
 * An invoice of R carries GST on top and has TDS withheld from R, so the bank sees
 * R × (1 + gst% − tds%). Dividing by that recovers R.
 */
export function grossUpBankReceipts(bankCredits: number, gstPct: number, tdsPct: number): number {
  const factor = 1 + Math.max(gstPct, 0) / 100 - Math.min(Math.max(tdsPct, 0), 100) / 100;
  if (factor <= 0) return 0;
  return Math.round(bankCredits / factor);
}
