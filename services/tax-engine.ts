/**
 * Tax Engine — Pure calculation functions for Indian Income Tax.
 *
 * Supports:
 * - CTC breakdown (Basic, HRA, Special Allowance, EPF, Gratuity)
 * - New Tax Regime FY 2025-26 (7 slabs + 87A rebate)
 * - Old Tax Regime (4 slabs + deductions)
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
}

// ─── Constants ─────────────────────────────────────────────

/** EPF statutory wage ceiling */
const EPF_RESTRICTED_MONTHLY_WAGE = 15000;

/** Gratuity rate: 4.81% of Basic (15/26 * 1/12 * basic) */
const GRATUITY_RATE = 0.0481;

/** Standard deduction — New regime (FY 2025-26) */
const STD_DEDUCTION_NEW = 75000;

/** Standard deduction — Old regime */
const STD_DEDUCTION_OLD = 50000;

/** Health & Education Cess */
const CESS_RATE = 0.04;

// ─── New Tax Regime FY 2025-26 Slabs ──────────────────────

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
      ? Math.min(basic, EPF_RESTRICTED_MONTHLY_WAGE * 12)
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
): EPFResult {
  const epfBase =
    epfMode === "restricted"
      ? Math.min(annualBasic, EPF_RESTRICTED_MONTHLY_WAGE * 12)
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
 * New Tax Regime FY 2025-26 calculation.
 */
export function calculateNewRegimeTax(grossSalary: number): TaxResult {
  const standardDeduction = STD_DEDUCTION_NEW;
  const taxableIncome = Math.max(grossSalary - standardDeduction, 0);

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
  const effectiveRate = grossSalary > 0 ? (totalTax / grossSalary) * 100 : 0;

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
  const effectiveRate = grossSalary > 0 ? (totalTax / grossSalary) * 100 : 0;

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
  );

  const epf = calculateEPF(
    ctcBreakdown.basic,
    input.epfMode,
    input.vpfMonthly,
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
    const tax = computeMarginalSlabTax(totalSalaryIncome, gains.debt, taxRegime);
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
    const tax = computeMarginalSlabTax(totalSalaryIncome + gains.debt, gains.fd, taxRegime);
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
 * Used for income taxed at slab rate on top of existing salary income.
 */
function computeMarginalSlabTax(
  baseIncome: number,
  additionalIncome: number,
  taxRegime: "new" | "old",
): number {
  const slabs = taxRegime === "new" ? NEW_REGIME_SLABS : OLD_REGIME_SLABS;
  const stdDeduction = taxRegime === "new" ? STD_DEDUCTION_NEW : STD_DEDUCTION_OLD;

  const taxableBase = Math.max(baseIncome - stdDeduction, 0);
  const taxableWithAdditional = Math.max(baseIncome + additionalIncome - stdDeduction, 0);

  const taxBase = calculateSlabTax(taxableBase, slabs);
  const taxWithAdditional = calculateSlabTax(taxableWithAdditional, slabs);

  const marginalTax = taxWithAdditional - taxBase;
  // Add 4% cess
  return Math.round(marginalTax + marginalTax * CESS_RATE);
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
 * Method: tax on (salary + bonus) - tax on (salary alone).
 * Uses the selected regime's slabs. Standard deduction already applied to salary.
 */
export function computeBonusTax(
  annualSalaryIncome: number,
  bonusAmount: number,
  taxRegime: "new" | "old",
): BonusTaxResult {
  if (bonusAmount <= 0) {
    return { grossBonus: 0, taxOnBonus: 0, netBonus: 0, effectiveRate: 0 };
  }

  const slabs = taxRegime === "new" ? NEW_REGIME_SLABS : OLD_REGIME_SLABS;
  const stdDeduction = taxRegime === "new" ? STD_DEDUCTION_NEW : STD_DEDUCTION_OLD;

  // Taxable income from salary alone (standard deduction already applied)
  const taxableWithoutBonus = Math.max(annualSalaryIncome - stdDeduction, 0);
  // Taxable income with bonus (bonus is fully taxable, no additional deduction)
  const taxableWithBonus = Math.max(annualSalaryIncome + bonusAmount - stdDeduction, 0);

  const taxWithout = calculateSlabTax(taxableWithoutBonus, slabs);
  const taxWith = calculateSlabTax(taxableWithBonus, slabs);

  // Marginal tax = difference
  let taxOnBonus = taxWith - taxWithout;

  // Apply cess (4%) on the marginal tax
  taxOnBonus = taxOnBonus + taxOnBonus * CESS_RATE;
  taxOnBonus = Math.round(taxOnBonus);

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
