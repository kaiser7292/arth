/**
 * Business / freelance income, side income, advance tax and receipts — tax-engine +
 * income-calculation. Expected values are worked by hand from FY 2026-27 rules
 * (new regime slabs 4/8/12/16/20/24L, ₹60K 87A rebate up to ₹12L, 4% cess).
 */

import {
  calculateBusinessIncome,
  calculateEPF,
  calculateOtherIncome,
  computeAdvanceTaxSchedule,
  computeBonusTax,
  computeCapitalGainsTax,
  computeLetOutIncome,
  getEpfAnnualWageCap,
  getEpfMonthlyCeilingLabel,
  getPresumptiveLimit,
  grossUpBankReceipts,
  type BusinessIncomeInput,
} from "../../services/tax-engine";
import {
  computeIncomeProfile,
  deriveDirectBaseMonthly,
  getIncomeKind,
  type IncomeProfileNumbers,
} from "../../services/income-calculation";

const baseBusiness: BusinessIncomeInput = {
  scheme: "presumptive_profession",
  grossReceipts: 0,
  digitalReceiptsPct: 100,
  businessExpenses: 0,
  tdsPct: 0,
  professionalTaxAnnual: 0,
  deductions80C: 0,
  deductions80D: 0,
  homeLoanInterest: 0,
  otherDeductions: 0,
};

describe("calculateBusinessIncome — presumptive profession (44ADA)", () => {
  it("taxes 50% of receipts; ₹10L profit is covered by the new-regime rebate", () => {
    const r = calculateBusinessIncome({
      ...baseBusiness,
      grossReceipts: 2000000,
      businessExpenses: 200000,
      tdsPct: 10,
      professionalTaxAnnual: 2500,
    });
    expect(r.appliedScheme).toBe("presumptive_profession");
    expect(r.taxableProfit).toBe(1000000);
    expect(r.newRegimeTax.totalTax).toBe(0);
    // Old: 12,500 + 1,00,000 = 1,12,500 + 4% cess
    expect(r.oldRegimeTax.totalTax).toBe(117000);
    expect(r.selectedRegime).toBe("new");
    expect(r.tdsCredit).toBe(200000);
    expect(r.annualInHand).toBe(2000000 - 200000 - 2500);
  });

  it("no standard deduction: ₹40L receipts → ₹20L profit → ₹2,08,000", () => {
    const r = calculateBusinessIncome({ ...baseBusiness, grossReceipts: 4000000 });
    expect(r.taxableProfit).toBe(2000000);
    // 20K + 40K + 60K + 80K = 2,00,000 + 4% cess
    expect(r.newRegimeTax.totalTax).toBe(208000);
  });

  it("flags when actual profit is below the presumptive profit", () => {
    const r = calculateBusinessIncome({ ...baseBusiness, grossReceipts: 1000000, businessExpenses: 700000 });
    expect(r.taxableProfit).toBe(500000);
    expect(r.actualProfit).toBe(300000);
    expect(r.actualBelowDeemed).toBe(true);
  });
});

describe("presumptive limits", () => {
  it("profession: ₹75L when cash ≤ 5%, else ₹50L", () => {
    expect(getPresumptiveLimit("presumptive_profession", 100)).toBe(7500000);
    expect(getPresumptiveLimit("presumptive_profession", 95)).toBe(7500000);
    expect(getPresumptiveLimit("presumptive_profession", 90)).toBe(5000000);
  });

  it("business: ₹3Cr when cash ≤ 5%, else ₹2Cr; regular has none", () => {
    expect(getPresumptiveLimit("presumptive_business", 100)).toBe(30000000);
    expect(getPresumptiveLimit("presumptive_business", 50)).toBe(20000000);
    expect(getPresumptiveLimit("regular", 100)).toBeNull();
  });

  it("falls back to actual profit above the limit", () => {
    const over = calculateBusinessIncome({
      ...baseBusiness,
      grossReceipts: 6000000,
      digitalReceiptsPct: 90,
      businessExpenses: 1000000,
    });
    expect(over.exceedsPresumptiveLimit).toBe(true);
    expect(over.appliedScheme).toBe("regular");
    expect(over.taxableProfit).toBe(5000000);

    const within = calculateBusinessIncome({ ...baseBusiness, grossReceipts: 6000000, businessExpenses: 1000000 });
    expect(within.exceedsPresumptiveLimit).toBe(false);
    expect(within.taxableProfit).toBe(3000000);
  });
});

describe("calculateBusinessIncome — presumptive business (44AD) and regular books", () => {
  it("6% of digital + 8% of cash turnover", () => {
    const r = calculateBusinessIncome({
      ...baseBusiness,
      scheme: "presumptive_business",
      grossReceipts: 10000000,
      digitalReceiptsPct: 80,
    });
    expect(r.taxableProfit).toBe(640000);
    expect(r.newRegimeTax.totalTax).toBe(0);
  });

  it("regular books: profit = receipts − expenses − professional tax", () => {
    const r = calculateBusinessIncome({
      ...baseBusiness,
      scheme: "regular",
      grossReceipts: 2000000,
      businessExpenses: 500000,
      professionalTaxAnnual: 2500,
    });
    expect(r.taxableProfit).toBe(1497500);
    expect(r.actualBelowDeemed).toBe(false);
  });

  it("marginal relief applies at the ₹12L rebate cliff (no standard deduction)", () => {
    const r = calculateBusinessIncome({ ...baseBusiness, scheme: "regular", grossReceipts: 1250000 });
    // Slab tax 67,500 capped at (12.5L − 12L) = 50,000, + 4% cess
    expect(r.newRegimeTax.totalTax).toBe(52000);
  });

  it("old-regime deductions reduce old-regime tax only", () => {
    const r = calculateBusinessIncome({
      ...baseBusiness,
      grossReceipts: 3000000,
      deductions80C: 200000, // capped at 1.5L
      deductions80D: 25000,
    });
    expect(r.oldRegimeTax.taxableIncome).toBe(1500000 - 150000 - 25000);
    expect(r.newRegimeTax.taxableIncome).toBe(1500000);
  });
});

describe("computeAdvanceTaxSchedule", () => {
  it("regular: 15 / 45 / 75 / 100% instalments", () => {
    const plan = computeAdvanceTaxSchedule(208000, 0, 2026, false);
    expect(plan.required).toBe(true);
    expect(plan.instalments.map((i) => i.dueDate)).toEqual([
      "2026-06-15", "2026-09-15", "2026-12-15", "2027-03-15",
    ]);
    expect(plan.instalments.map((i) => i.amount)).toEqual([31200, 62400, 62400, 52000]);
    expect(plan.instalments.reduce((s, i) => s + i.amount, 0)).toBe(208000);
  });

  it("presumptive: one instalment by 15 March", () => {
    const plan = computeAdvanceTaxSchedule(208000, 8000, 2026, true);
    expect(plan.netPayable).toBe(200000);
    expect(plan.instalments).toEqual([{ dueDate: "2027-03-15", cumulativePct: 100, amount: 200000 }]);
  });

  it("not required below ₹10,000 after TDS; excess TDS is a refund", () => {
    expect(computeAdvanceTaxSchedule(15000, 6000, 2026, false).required).toBe(false);
    const refund = computeAdvanceTaxSchedule(0, 200000, 2026, true);
    expect(refund.required).toBe(false);
    expect(refund.refundExpected).toBe(200000);
    expect(refund.instalments).toHaveLength(0);
  });
});

describe("calculateOtherIncome — side business + rent on top of a salary", () => {
  const salaryBase = { baseTaxableNew: 900000, baseTaxableOld: 900000, primaryTax: 0, selfOccupiedInterestClaimed: 0 };

  it("side income still under the ₹12L rebate adds no tax", () => {
    const r = calculateOtherIncome({
      ...salaryBase,
      sideBusiness: { ...baseBusiness, grossReceipts: 600000 },
      rental: null,
    });
    expect(r.sideBusinessProfit).toBe(300000);
    expect(r.combinedTaxNew).toBe(0);
    expect(r.extraTax).toBe(0);
    expect(r.netCash).toBe(600000);
  });

  it("is taxed on the combined income, not on its own", () => {
    const r = calculateOtherIncome({
      ...salaryBase,
      sideBusiness: { ...baseBusiness, grossReceipts: 1000000, tdsPct: 10 },
      rental: null,
    });
    // Combined 14L: 20K + 40K + 30K = 90,000 + 4% cess
    expect(r.combinedTaxNew).toBe(93600);
    expect(r.bestRegime).toBe("new");
    expect(r.extraTax).toBe(93600);
    expect(r.netCash).toBe(1000000 - 93600);
    expect(r.tdsCredit).toBe(100000);
  });

  it("rental loss: ignored in new regime, capped in old (shared with own home-loan interest)", () => {
    expect(computeLetOutIncome({ annualRent: 300000, municipalTax: 0, loanInterest: 300000 })).toBe(-90000);

    const r = calculateOtherIncome({
      ...salaryBase,
      selfOccupiedInterestClaimed: 150000,
      sideBusiness: null,
      rental: { annualRent: 300000, municipalTax: 0, loanInterest: 300000 },
    });
    expect(r.rentalCountedNew).toBe(0);
    expect(r.rentalCountedOld).toBe(-50000);
  });

  it("30% standard deduction on rent after municipal tax", () => {
    expect(computeLetOutIncome({ annualRent: 360000, municipalTax: 10000, loanInterest: 0 })).toBe(245000);
  });
});

describe("87A rebate respected when stacking bonus / slab-rate income (bug fix)", () => {
  it("a bonus that keeps total income under ₹12L is tax-free", () => {
    // ₹9L salary + ₹2L bonus → ₹10.25L taxable → fully rebated. Slab-only arithmetic charged ₹20,800.
    expect(computeBonusTax(900000, 200000, "new").taxOnBonus).toBe(0);
  });

  it("FD interest on a small salary is tax-free under the rebate", () => {
    const r = computeCapitalGainsTax(
      { equity_ltcg: 0, equity_stcg: 0, debt: 0, fd: 100000, gold: 0, real_estate: 0 },
      900000,
      "new",
    );
    expect(r.items[0].tax).toBe(0);
  });

  it("business base: no standard deduction when stacking", () => {
    // Base ₹11.5L business profit + ₹1L FD → 12.5L taxable → 52,000 (marginal relief), vs 0 on the base.
    const r = computeCapitalGainsTax(
      { equity_ltcg: 0, equity_stcg: 0, debt: 0, fd: 100000, gold: 0, real_estate: 0 },
      1150000,
      "new",
      0,
    );
    expect(r.items[0].tax).toBe(52000);
  });
});

describe("grossUpBankReceipts", () => {
  it("undoes GST on top and TDS withheld", () => {
    // ₹1L invoice + 18% GST − 10% TDS = ₹1.08L in the bank
    expect(grossUpBankReceipts(108000, 18, 10)).toBe(100000);
    expect(grossUpBankReceipts(50000, 0, 0)).toBe(50000);
  });
});

describe("deriveDirectBaseMonthly (direct-mode reload drift fix)", () => {
  it("recovers the default month from the saved average", () => {
    // Default ₹1L, April overridden to ₹2L → annual ₹13L → saved average ₹1,08,333.33
    const avg = 1300000 / 12;
    expect(deriveDirectBaseMonthly(avg, { 0: "200000" })).toBe(100000);
  });

  it("no overrides: average is the default", () => {
    expect(deriveDirectBaseMonthly(150000, {})).toBe(150000);
    expect(deriveDirectBaseMonthly(150000, null)).toBe(150000);
  });
});

// ─── computeIncomeProfile ─────────────────────────────────

const emptyProfile: IncomeProfileNumbers = {
  income_type: "salaried",
  input_mode: "ctc",
  annual_ctc: null,
  basic_pct: 40,
  hra_pct: 50,
  is_metro: 1,
  epf_mode: "restricted",
  epf_in_ctc: 1,
  gratuity_in_ctc: 1,
  vpf_monthly: 0,
  state: "Delhi",
  deductions_80c: 0,
  deductions_80d: 0,
  hra_exemption_annual: 0,
  home_loan_interest: 0,
  other_deductions: 0,
  ctc_mode: "percentage",
  manual_basic: 0,
  manual_hra: 0,
  manual_special: 0,
  manual_employer_epf: 0,
  manual_gratuity: 0,
  manual_monthly_in_hand: 0,
  computed_monthly_in_hand: 0,
  expected_bonus: 0,
  capital_gains_equity_ltcg: 0,
  capital_gains_equity_stcg: 0,
  capital_gains_debt: 0,
  capital_gains_fd: 0,
  capital_gains_gold: 0,
  capital_gains_real_estate: 0,
  business_scheme: "presumptive_profession",
  business_receipts: 0,
  business_digital_pct: 100,
  business_expenses: 0,
  business_tds_pct: 0,
  side_business_enabled: 0,
  rental_annual_rent: 0,
  rental_municipal_tax: 0,
  rental_loan_interest: 0,
};

describe("computeIncomeProfile", () => {
  it("income kind comes from income_type first", () => {
    expect(getIncomeKind({ income_type: "business", input_mode: "direct" })).toBe("business");
    expect(getIncomeKind({ income_type: "salaried", input_mode: "ctc" })).toBe("ctc");
    expect(getIncomeKind({ income_type: "salaried", input_mode: "direct" })).toBe("direct");
  });

  it("business: in-hand, tax and advance tax (TDS refund case)", () => {
    const r = computeIncomeProfile(
      { ...emptyProfile, income_type: "business", input_mode: "direct", business_receipts: 2000000, business_expenses: 200000, business_tds_pct: 10 },
      2026,
    );
    expect(r.kind).toBe("business");
    expect(r.annualTax).toBe(0);
    expect(r.annualInHand).toBe(1800000); // Delhi has no professional tax
    expect(r.advanceTax?.refundExpected).toBe(200000);
    expect(r.netBonus).toBe(0);
  });

  it("business + rent: advance tax covers the combined tax", () => {
    const r = computeIncomeProfile(
      { ...emptyProfile, income_type: "business", input_mode: "direct", business_receipts: 4000000, rental_annual_rent: 300000 },
      2026,
    );
    // 20L profit + 2.1L rent = 22.1L: 2,00,000 + 2.1L × 25% = 2,52,500 + cess
    expect(r.annualTax).toBe(262600);
    expect(r.advanceTax?.netPayable).toBe(262600);
    // Business alone is presumptive; one instalment by 15 March
    expect(r.advanceTax?.instalments).toHaveLength(1);
  });

  it("salaried CTC + side business: primary unchanged, extra tax added, advance tax on the extra", () => {
    const salaryOnly = computeIncomeProfile({ ...emptyProfile, annual_ctc: 1500000 }, 2026);
    const withSide = computeIncomeProfile(
      { ...emptyProfile, annual_ctc: 1500000, side_business_enabled: 1, business_receipts: 1000000 },
      2026,
    );
    expect(withSide.primaryAnnualInHand).toBe(salaryOnly.primaryAnnualInHand);
    expect(withSide.other).not.toBeNull();
    expect(withSide.annualTax).toBe(withSide.primaryTax + withSide.other!.extraTax);
    expect(withSide.annualInHand).toBeCloseTo(salaryOnly.annualInHand + withSide.other!.netCash, 6);
    expect(withSide.advanceTax?.totalTax).toBe(withSide.other!.extraTax);
  });

  it("side business is ignored when the toggle is off", () => {
    const r = computeIncomeProfile({ ...emptyProfile, annual_ctc: 1500000, business_receipts: 1000000 }, 2026);
    expect(r.other).toBeNull();
    expect(r.advanceTax).toBeNull();
  });

  it("direct mode: amounts are post-tax, nothing is taxed", () => {
    const r = computeIncomeProfile(
      { ...emptyProfile, input_mode: "direct", expected_bonus: 100000, capital_gains_fd: 50000, rental_annual_rent: 300000 },
      2026,
      1200000,
    );
    expect(r.kind).toBe("direct");
    expect(r.annualInHand).toBe(1200000);
    expect(r.totalAnnualIncome).toBe(1350000);
    expect(r.other).toBeNull();
    expect(r.annualTax).toBe(0);
  });
});

// ─── EPF wage ceiling ₹15,000 → ₹25,000 (17 Sep 2026) ─────


describe("EPF wage ceiling by tax year", () => {
  it("₹15,000/month up to FY 2025-26, ₹25,000/month from FY 2027-28", () => {
    expect(getEpfAnnualWageCap(2025)).toBe(180000);
    expect(getEpfAnnualWageCap(2027)).toBe(300000);
  });

  it("FY 2026-27 switches on 17 September (September pro-rated by day)", () => {
    // Apr–Aug 5 × 15,000 + Sep (16 × 15,000 + 14 × 25,000) / 30 + Oct–Mar 6 × 25,000
    expect(getEpfAnnualWageCap(2026)).toBe(244667);
    expect(getEpfMonthlyCeilingLabel(2026)).toBe(25000);
    expect(getEpfMonthlyCeilingLabel(2025)).toBe(15000);
  });

  it("restricted employee PF uses the year's ceiling", () => {
    expect(calculateEPF(800000, "restricted", 0, getEpfAnnualWageCap(2027)).employeeContribution).toBe(36000);
    // Default stays at the old ceiling for callers that don't pass a year
    expect(calculateEPF(800000, "restricted", 0).employeeContribution).toBe(21600);
    // Basic below the ceiling is unaffected
    expect(calculateEPF(240000, "restricted", 0, getEpfAnnualWageCap(2027)).employeeContribution).toBe(28800);
  });

  it("income profile applies the ceiling for the selected FY", () => {
    const p = { ...emptyProfile, annual_ctc: 2000000 };
    const fy25 = computeIncomeProfile(p, 2025);
    const fy27 = computeIncomeProfile(p, 2027);
    expect(fy25.salary!.epf.employeeContribution).toBe(21600);
    expect(fy27.salary!.epf.employeeContribution).toBe(36000);
    // More PF deducted → less in hand
    expect(fy27.primaryAnnualInHand).toBeLessThan(fy25.primaryAnnualInHand);
  });
});
