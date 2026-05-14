/**
 * Tax Engine unit tests.
 *
 * Covers:
 * - CTC breakdown (Basic, HRA, Special Allowance, EPF, Gratuity)
 * - EPF calculation (full_basic vs restricted)
 * - New Tax Regime FY 2025-26 (7 slabs + 87A rebate)
 * - Old Tax Regime (4 slabs + deductions)
 * - Surcharge tiers + Cess
 * - Professional tax lookup
 * - Full calculateSalary integration
 */

import {
  calculateCTCBreakdown,
  calculateEPF,
  calculateNewRegimeTax,
  calculateOldRegimeTax,
  calculateSalary,
  getProfessionalTax,
  computeBonusTax,
  computeCapitalGainsTax,
  PROFESSIONAL_TAX_RATES,
  STATE_LIST,
} from "../../services/tax-engine";

// ─── Marginal Relief (v16.0.9) ───────────────────────────

describe("Marginal Relief — 87A cliff (new regime)", () => {
  it("no relief exactly at Rs 12L taxable (full rebate)", () => {
    const r = calculateNewRegimeTax(1275000); // taxable = 12L
    expect(r.totalTax).toBe(0);
    expect(r.marginalRelief).toBe(0);
    expect(r.rebate87A).toBe(60000);
  });

  it("relief kicks in just above Rs 12L taxable", () => {
    // Gross = 12,75,100 → taxable = 12,00,100
    // Without relief: slab tax = 60,000 + 10 = 60,010; no 87A → 60,010 + cess = 62,410
    // With relief: tax capped at (12,00,100 - 12,00,000) = 100, +4% cess = 104
    const r = calculateNewRegimeTax(1275100);
    expect(r.taxableIncome).toBe(1200100);
    expect(r.rebate87A).toBe(0);
    expect(r.marginalRelief).toBeGreaterThan(59000);
    // Total = 100 + cess 4% ≈ 104 (rounded)
    expect(r.totalTax).toBeLessThanOrEqual(105);
  });

  it("relief stops mattering once extra income exceeds saved tax (~ Rs 12.70L taxable)", () => {
    // At a high enough taxable, (taxable - 12L) > (tax from slabs) and relief no longer applies.
    // Taxable 12,70,588 → slab tax = 60K + 70588*10% = 60K + 7058.8 = 67,058.8
    // (taxable - 12L) = 70,588 > 67,058 → NO relief, full tax applies
    const r = calculateNewRegimeTax(1345588); // gross -> taxable = 12,70,588
    expect(r.marginalRelief).toBe(0);
    expect(r.totalTax).toBeGreaterThan(65000);
  });

  it("relief still applies at Rs 12.50L taxable", () => {
    // Gross = 13,25,000 → taxable = 12,50,000
    // Slab tax: 60K (first 3 slabs) + 50K*10% = 65,000 at the 12L-16L boundary? No:
    // 0-4L=0, 4L-8L=20K, 8L-12L=40K, 12L-12.5L = 50K*10% = 5,000. Total baseTax = 65,000.
    // (taxable - 12L) = 50,000 < 65,000 → relief applies, cap at 50,000 + cess = 52,000.
    const r = calculateNewRegimeTax(1325000);
    expect(r.marginalRelief).toBeGreaterThan(10000);
    expect(r.totalTax).toBeLessThanOrEqual(52500);
  });
});

describe("Marginal Relief — 87A cliff (old regime)", () => {
  const noDeductions = {
    section80C: 0,
    section80D: 0,
    hraExemption: 0,
    homeLoanInterest: 0,
    otherDeductions: 0,
  };

  it("no relief exactly at Rs 5L taxable (full rebate)", () => {
    const r = calculateOldRegimeTax(550000, noDeductions);
    expect(r.totalTax).toBe(0);
    expect(r.marginalRelief).toBe(0);
  });

  it("relief kicks in just above Rs 5L taxable", () => {
    // Gross = 5,50,100 → taxable = 5,00,100
    // Without relief: slab tax = 12,500 + 20 = 12,520; no 87A.
    // With relief: cap at (5,00,100 - 5,00,000) = 100; +4% cess = 104.
    const r = calculateOldRegimeTax(550100, noDeductions);
    expect(r.taxableIncome).toBe(500100);
    expect(r.marginalRelief).toBeGreaterThan(12000);
    expect(r.totalTax).toBeLessThanOrEqual(110);
  });
});

describe("Marginal Relief — surcharge thresholds", () => {
  it("no surcharge relief at exactly Rs 50L taxable", () => {
    // Gross = 50,75,000 → taxable = 50,00,000
    const r = calculateNewRegimeTax(5075000);
    expect(r.surcharge).toBe(0); // at threshold, no surcharge
  });

  it("applies surcharge relief just above Rs 50L taxable", () => {
    // Gross = 50,76,000 → taxable = 50,01,000 (just above threshold)
    // Without relief: surcharge 10% on large base tax → huge jump
    // With relief: (tax+surcharge - baseTaxAt50L) should not exceed 1,000
    const r = calculateNewRegimeTax(5076000);
    expect(r.taxableIncome).toBe(5001000);
    // Relief should cap surcharge significantly — check that (baseTax + surcharge)
    // doesn't exceed baseTaxAt50L + extra income
    const baseTaxAt50L = 20000 + 40000 + 60000 + 80000 + 100000 + 180000 + 1800000 * 0.30;
    // That's: 0-4L=0, 4L-8L=20K, 8L-12L=40K, 12L-16L=60K, 16L-20L=80K, 20L-24L=100K, 24L-50L=26L*30%=780K
    // Let engine compute, just assert relief kicked in:
    expect(r.surcharge).toBeLessThan(baseTaxAt50L * 0.10); // well below 10% of base tax
  });
});

// ─── Employee PF / new-regime taxability lock-in ─────────

describe("Employee PF in new regime (regression lock-in)", () => {
  it("employee PF is NOT deducted from new-regime taxable income", () => {
    // 20L CTC, restricted EPF mode. Employee EPF = 180000 * 0.12 = 21,600.
    // Gross = 20L - employerEPF - gratuity ≈ 19,40,000
    // New regime taxable = gross - 75K std deduction ≈ 18,65,000
    // It should NOT be reduced by employee EPF (21,600).
    const result = calculateSalary({
      annualCTC: 2000000,
      basicPct: 40,
      hraPct: 50,
      isMetro: true,
      epfMode: "restricted",
      epfInCTC: true,
      vpfMonthly: 0,
      professionalTaxAnnual: 2400,
      deductions80C: 0,
      deductions80D: 0,
      hraExemptionAnnual: 0,
      homeLoanInterest: 0,
      otherDeductions: 0,
    });
    // Taxable = grossSalary - 75K (nothing else)
    const expectedNewTaxable = result.ctcBreakdown.grossSalary - 75000;
    expect(result.newRegimeTax.taxableIncome).toBe(
      Math.max(expectedNewTaxable, 0),
    );
    // And employee EPF (21,600) is NOT subtracted again
    expect(result.newRegimeTax.taxableIncome).toBeGreaterThan(
      result.ctcBreakdown.grossSalary - 75000 - 100, // allowing for float
    );
  });
});

// ─── Gratuity in CTC toggle ──────────────────────────────

describe("gratuityInCTC toggle", () => {
  it("gratuity OUT of CTC: grossSalary equals CTC minus employerEPF only", () => {
    const r = calculateCTCBreakdown(2000000, 40, 50, "restricted", true, false);
    // Only employerEPF subtracted — gratuity treated as on-top
    expect(r.grossSalary).toBeCloseTo(2000000 - r.employerEPF, 0);
  });

  it("gratuity IN CTC (default): grossSalary equals CTC minus employerEPF AND gratuity", () => {
    const r = calculateCTCBreakdown(2000000, 40, 50, "restricted", true, true);
    expect(r.grossSalary).toBeCloseTo(2000000 - r.employerEPF - r.gratuity, 0);
  });

  it("gratuity OUT of CTC: special allowance is larger (one less subtraction)", () => {
    const inCTC = calculateCTCBreakdown(2000000, 40, 50, "restricted", true, true);
    const outCTC = calculateCTCBreakdown(2000000, 40, 50, "restricted", true, false);
    // Out-of-CTC frees up the gratuity amount for special allowance
    expect(outCTC.specialAllowance).toBeCloseTo(
      inCTC.specialAllowance + inCTC.gratuity,
      0,
    );
  });

  it("full_basic EPF + gratuity OUT: grossSalary = CTC - employerEPF only", () => {
    const r = calculateCTCBreakdown(2000000, 40, 50, "full_basic", true, false);
    expect(r.grossSalary).toBeCloseTo(2000000 - r.employerEPF, 0);
  });

  it("calculateSalary honors gratuityInCTC=false", () => {
    const inCTC = calculateSalary({
      annualCTC: 2000000,
      basicPct: 40,
      hraPct: 50,
      isMetro: true,
      epfMode: "restricted",
      epfInCTC: true,
      gratuityInCTC: true,
      vpfMonthly: 0,
      professionalTaxAnnual: 2400,
      deductions80C: 0,
      deductions80D: 0,
      hraExemptionAnnual: 0,
      homeLoanInterest: 0,
      otherDeductions: 0,
    });
    const outCTC = calculateSalary({
      annualCTC: 2000000,
      basicPct: 40,
      hraPct: 50,
      isMetro: true,
      epfMode: "restricted",
      epfInCTC: true,
      gratuityInCTC: false,
      vpfMonthly: 0,
      professionalTaxAnnual: 2400,
      deductions80C: 0,
      deductions80D: 0,
      hraExemptionAnnual: 0,
      homeLoanInterest: 0,
      otherDeductions: 0,
    });
    // Gratuity-out path produces a higher gross (nothing subtracted for gratuity)
    expect(outCTC.ctcBreakdown.grossSalary).toBeGreaterThan(
      inCTC.ctcBreakdown.grossSalary,
    );
  });
});

// ─── Manual CTC Breakdown ────────────────────────────────

describe("Manual CTC breakdown", () => {
  it("uses user-provided rupee amounts as-is", () => {
    const r = calculateCTCBreakdown(2000000, 40, 50, "restricted", true, true, {
      basic: 800000,
      hra: 400000,
      specialAllowance: 740000,
      employerEPF: 21600,
      gratuity: 38400,
    });
    expect(r.basic).toBe(800000);
    expect(r.hra).toBe(400000);
    expect(r.specialAllowance).toBe(740000);
    expect(r.employerEPF).toBe(21600);
    expect(r.gratuity).toBe(38400);
  });

  it("auto-derives special allowance when zero", () => {
    // CTC 20L, all others defined, special = 0 → should derive 20L - (800K+400K+21.6K+38.4K)
    const r = calculateCTCBreakdown(2000000, 40, 50, "restricted", true, true, {
      basic: 800000,
      hra: 400000,
      specialAllowance: 0,
      employerEPF: 21600,
      gratuity: 38400,
    });
    expect(r.specialAllowance).toBe(2000000 - 800000 - 400000 - 21600 - 38400);
  });

  it("honors gratuityInCTC=false in manual mode", () => {
    // With gratuity on-top, grossSalary = CTC - employerEPF (gratuity not subtracted)
    const r = calculateCTCBreakdown(2000000, 40, 50, "restricted", true, false, {
      basic: 800000,
      hra: 400000,
      specialAllowance: 778400,
      employerEPF: 21600,
      gratuity: 38400,
    });
    expect(r.grossSalary).toBe(2000000 - 21600); // no gratuity subtraction
  });

  it("calculateSalary accepts manualBreakdown via TaxInput", () => {
    const r = calculateSalary({
      annualCTC: 2000000,
      basicPct: 40,
      hraPct: 50,
      isMetro: true,
      epfMode: "restricted",
      epfInCTC: true,
      gratuityInCTC: true,
      vpfMonthly: 0,
      professionalTaxAnnual: 2400,
      deductions80C: 0,
      deductions80D: 0,
      hraExemptionAnnual: 0,
      homeLoanInterest: 0,
      otherDeductions: 0,
      manualBreakdown: {
        basic: 800000,
        hra: 400000,
        specialAllowance: 740000,
        employerEPF: 21600,
        gratuity: 38400,
      },
    });
    expect(r.ctcBreakdown.basic).toBe(800000);
    expect(r.ctcBreakdown.hra).toBe(400000);
  });
});

// ─── Professional Tax in old regime ──────────────────────

describe("Professional tax deduction in old regime (Section 16(iii))", () => {
  it("reduces old-regime taxable income by PT amount", () => {
    const withoutPT = calculateOldRegimeTax(1500000, {
      section80C: 0,
      section80D: 0,
      hraExemption: 0,
      homeLoanInterest: 0,
      otherDeductions: 0,
    });
    const withPT = calculateOldRegimeTax(1500000, {
      section80C: 0,
      section80D: 0,
      hraExemption: 0,
      homeLoanInterest: 0,
      otherDeductions: 0,
      professionalTax: 2500,
    });
    expect(withPT.taxableIncome).toBe(withoutPT.taxableIncome - 2500);
  });

  it("calculateSalary threads professional tax into old-regime deductions", () => {
    const result = calculateSalary({
      annualCTC: 2000000,
      basicPct: 40,
      hraPct: 50,
      isMetro: true,
      epfMode: "restricted",
      epfInCTC: true,
      vpfMonthly: 0,
      professionalTaxAnnual: 2500,
      deductions80C: 0,
      deductions80D: 0,
      hraExemptionAnnual: 0,
      homeLoanInterest: 0,
      otherDeductions: 0,
    });
    // Old regime taxable should be (gross - 50K std - employeeEPF(80C, restricted=21600) - 2500 PT)
    const expectedTaxable = Math.max(
      result.ctcBreakdown.grossSalary - 50000 - result.epf.employeeContribution - 2500,
      0,
    );
    expect(result.oldRegimeTax.taxableIncome).toBe(expectedTaxable);
  });
});

// ─── TaxResult shape sanity (v16.0.9) ────────────────────

describe("TaxResult shape", () => {
  it("exposes marginalRelief field on new regime", () => {
    const r = calculateNewRegimeTax(2000000);
    expect(r).toHaveProperty("marginalRelief");
    expect(typeof r.marginalRelief).toBe("number");
  });

  it("exposes marginalRelief field on old regime", () => {
    const r = calculateOldRegimeTax(1000000, {
      section80C: 0, section80D: 0, hraExemption: 0,
      homeLoanInterest: 0, otherDeductions: 0,
    });
    expect(r).toHaveProperty("marginalRelief");
  });
});

// ─── CTC Breakdown ───────────────────────────────────────

describe("calculateCTCBreakdown", () => {
  it("calculates components for a standard 20L CTC", () => {
    const result = calculateCTCBreakdown(2000000, 40, 50, "restricted", true);

    expect(result.annualCTC).toBe(2000000);
    expect(result.basic).toBe(800000); // 40% of 20L
    expect(result.hra).toBe(400000); // 50% of Basic
    expect(result.gratuity).toBeCloseTo(800000 * 0.0481, 0); // 4.81% of Basic
    // Restricted EPF: 12% of min(800000, 180000) = 12% of 180000
    expect(result.employerEPF).toBe(180000 * 0.12);
    // Special = CTC - Basic - HRA - EPF - Gratuity (epfInCTC=true)
    expect(result.specialAllowance).toBeCloseTo(
      2000000 - 800000 - 400000 - 21600 - 38480,
      0,
    );
    // Gross = CTC - EPF - Gratuity (epfInCTC=true)
    expect(result.grossSalary).toBeCloseTo(2000000 - 21600 - 38480, 0);
  });

  it("handles full_basic EPF mode", () => {
    const result = calculateCTCBreakdown(2000000, 40, 50, "full_basic", true);

    // Full basic: 12% of actual Basic (800000)
    expect(result.employerEPF).toBe(800000 * 0.12);
    // Gross = CTC - employerEPF - gratuity
    expect(result.grossSalary).toBeCloseTo(
      2000000 - 96000 - 800000 * 0.0481,
      0,
    );
  });

  it("handles epfInCTC=false (EPF not part of CTC)", () => {
    const result = calculateCTCBreakdown(2000000, 40, 50, "restricted", false);

    // Special = CTC - Basic - HRA - Gratuity (no EPF subtracted)
    const expectedSpecial =
      2000000 - 800000 - 400000 - 800000 * 0.0481;
    expect(result.specialAllowance).toBeCloseTo(expectedSpecial, 0);
    // Gross = CTC - Gratuity only (no EPF subtracted)
    expect(result.grossSalary).toBeCloseTo(2000000 - 800000 * 0.0481, 0);
  });

  it("handles low CTC where special allowance would go negative", () => {
    // Very low CTC: Basic + HRA + EPF + Gratuity > CTC
    const result = calculateCTCBreakdown(100000, 40, 50, "full_basic", true);

    // Special allowance should be floored at 0
    expect(result.specialAllowance).toBeGreaterThanOrEqual(0);
  });

  it("handles different basic and HRA percentages", () => {
    const result = calculateCTCBreakdown(1200000, 50, 40, "restricted", true);

    expect(result.basic).toBe(600000); // 50% of 12L
    expect(result.hra).toBe(240000); // 40% of Basic
  });
});

// ─── EPF Calculation ─────────────────────────────────────

describe("calculateEPF", () => {
  it("calculates restricted EPF (12% of Rs 15K/month ceiling)", () => {
    const result = calculateEPF(800000, "restricted", 0);

    const epfBase = 180000; // 15000 * 12
    expect(result.employeeContribution).toBe(epfBase * 0.12);
    expect(result.employerEPF).toBeCloseTo(epfBase * 0.0367, 0);
    expect(result.employerEPS).toBeCloseTo(epfBase * 0.0833, 0);
    expect(result.totalEmployerContribution).toBe(epfBase * 0.12);
    expect(result.vpf).toBe(0);
    expect(result.totalDeducted).toBe(epfBase * 0.12); // employee only, no VPF
  });

  it("calculates full_basic EPF (12% of actual basic)", () => {
    const result = calculateEPF(800000, "full_basic", 0);

    expect(result.employeeContribution).toBe(800000 * 0.12);
    expect(result.employerEPF).toBeCloseTo(800000 * 0.0367, 0);
    expect(result.employerEPS).toBeCloseTo(800000 * 0.0833, 0);
    expect(result.totalEmployerContribution).toBe(800000 * 0.12);
  });

  it("includes VPF in totalDeducted", () => {
    const result = calculateEPF(800000, "restricted", 5000);

    const epfBase = 180000;
    expect(result.vpf).toBe(60000); // 5000 * 12
    expect(result.totalDeducted).toBe(epfBase * 0.12 + 60000);
  });

  it("restricted mode uses basic when basic < ceiling", () => {
    // Annual basic = 120000 (10K/month) < 15K ceiling
    const result = calculateEPF(120000, "restricted", 0);

    // Should use actual basic since it's below the ceiling
    expect(result.employeeContribution).toBe(120000 * 0.12);
  });

  it("full_basic mode uses actual basic regardless of ceiling", () => {
    const result = calculateEPF(2400000, "full_basic", 0);

    // 20L basic — full amount even though > 15K/month ceiling
    expect(result.employeeContribution).toBe(2400000 * 0.12);
  });
});

// ─── New Tax Regime FY 2025-26 ───────────────────────────

describe("calculateNewRegimeTax", () => {
  it("returns zero tax for income within standard deduction", () => {
    const result = calculateNewRegimeTax(75000); // exactly at std deduction

    expect(result.taxableIncome).toBe(0);
    expect(result.totalTax).toBe(0);
    expect(result.effectiveRate).toBe(0);
  });

  it("returns zero tax for zero income", () => {
    const result = calculateNewRegimeTax(0);

    expect(result.taxableIncome).toBe(0);
    expect(result.totalTax).toBe(0);
  });

  it("calculates tax for income in first slab only (up to 4L taxable)", () => {
    // Gross = 4,75,000 → taxable = 4,00,000 (after 75K std deduction)
    const result = calculateNewRegimeTax(475000);

    expect(result.taxableIncome).toBe(400000);
    expect(result.baseTax).toBe(0); // First 4L is 0%
    expect(result.totalTax).toBe(0);
  });

  it("calculates tax for income in second slab (4L-8L at 5%)", () => {
    // Gross = 875000 → taxable = 800000
    const result = calculateNewRegimeTax(875000);

    // First 4L at 0% = 0, next 4L at 5% = 20000
    expect(result.taxableIncome).toBe(800000);
    expect(result.baseTax).toBe(20000);

    // Taxable ≤ 12L → 87A rebate applies (rebate up to 60K)
    expect(result.rebate87A).toBe(20000); // full tax rebated
    expect(result.totalTax).toBe(0);
  });

  it("applies 87A rebate for taxable income exactly at Rs 12L", () => {
    // Gross = 12,75,000 → taxable = 12,00,000
    const result = calculateNewRegimeTax(1275000);

    // Slabs: 0-4L=0, 4L-8L=20K, 8L-12L=40K → baseTax=60K
    expect(result.taxableIncome).toBe(1200000);
    expect(result.baseTax).toBe(60000);
    expect(result.rebate87A).toBe(60000); // full rebate (exactly at limit)
    expect(result.totalTax).toBe(0);
  });

  it("does NOT apply 87A rebate for taxable income above Rs 12L (but marginal relief caps tax)", () => {
    // Gross = 12,75,001 → taxable = 12,00,001
    // Without relief: tax jumps to ~60K+cess. With marginal relief: capped at 1 (+cess).
    const result = calculateNewRegimeTax(1275001);

    expect(result.taxableIncome).toBe(1200001);
    expect(result.rebate87A).toBe(0); // above 12L — no rebate
    // Marginal relief: total tax should not exceed (taxable - 12L) + cess
    // taxable - 12L = 1, +4% cess ≈ 1 (rounded)
    expect(result.totalTax).toBeLessThanOrEqual(2);
    expect(result.marginalRelief).toBeGreaterThan(0);
  });

  it("calculates correct tax for a 20L gross salary", () => {
    // Gross = 20,00,000 → taxable = 19,25,000
    const result = calculateNewRegimeTax(2000000);

    const taxable = 1925000;
    expect(result.taxableIncome).toBe(taxable);

    // Slab calculation:
    // 0-4L = 0
    // 4L-8L = 400000 * 0.05 = 20000
    // 8L-12L = 400000 * 0.10 = 40000
    // 12L-16L = 400000 * 0.15 = 60000
    // 16L-19.25L = 325000 * 0.20 = 65000
    // Total baseTax = 185000
    expect(result.baseTax).toBe(185000);
    expect(result.rebate87A).toBe(0); // above 12L
    expect(result.surcharge).toBe(0); // below 50L
    expect(result.cess).toBeCloseTo(185000 * 0.04, 0); // 4% cess
    expect(result.totalTax).toBe(Math.round(185000 + 185000 * 0.04));
  });

  it("calculates all 7 slabs for very high income", () => {
    // Gross = 30,75,000 → taxable = 30,00,000
    const result = calculateNewRegimeTax(3075000);

    // 0-4L=0, 4L-8L=20K, 8L-12L=40K, 12L-16L=60K, 16L-20L=80K, 20L-24L=100K, 24L-30L=180K
    // Total = 480000
    expect(result.baseTax).toBe(480000);
  });

  it("applies surcharge for income above 50L", () => {
    // Gross = 55,75,000 → taxable = 55,00,000
    const result = calculateNewRegimeTax(5575000);

    expect(result.taxableIncome).toBe(5500000);
    // Should have 10% surcharge (above 50L)
    expect(result.surcharge).toBeGreaterThan(0);
  });

  it("includes 4% health & education cess", () => {
    // Any income above rebate threshold
    const result = calculateNewRegimeTax(2000000);

    const taxAfterRebate = result.baseTax - result.rebate87A;
    const expectedCess = (taxAfterRebate + result.surcharge) * 0.04;
    expect(result.cess).toBeCloseTo(expectedCess, 0);
  });

  it("has a reasonable effective rate", () => {
    const result = calculateNewRegimeTax(2000000);

    // For 20L gross, effective rate should be roughly 9-10%
    expect(result.effectiveRate).toBeGreaterThan(5);
    expect(result.effectiveRate).toBeLessThan(15);
  });
});

// ─── Old Tax Regime ──────────────────────────────────────

describe("calculateOldRegimeTax", () => {
  const noDeductions = {
    section80C: 0,
    section80D: 0,
    hraExemption: 0,
    homeLoanInterest: 0,
    otherDeductions: 0,
  };

  it("returns zero tax for income below standard deduction", () => {
    const result = calculateOldRegimeTax(50000, noDeductions);

    expect(result.taxableIncome).toBe(0);
    expect(result.totalTax).toBe(0);
  });

  it("applies 87A rebate for taxable income exactly at Rs 5L", () => {
    // Gross = 550000 → taxable = 500000 (after 50K std deduction)
    const result = calculateOldRegimeTax(550000, noDeductions);

    // 0-2.5L=0, 2.5L-5L=12500
    expect(result.taxableIncome).toBe(500000);
    expect(result.baseTax).toBe(12500);
    expect(result.rebate87A).toBe(12500); // full rebate
    expect(result.totalTax).toBe(0);
  });

  it("does NOT apply 87A rebate above Rs 5L taxable", () => {
    const result = calculateOldRegimeTax(550001, noDeductions);

    expect(result.taxableIncome).toBe(500001);
    expect(result.rebate87A).toBe(0);
    expect(result.totalTax).toBeGreaterThan(0);
  });

  it("calculates correct slab tax for 15L gross (no deductions)", () => {
    // Gross = 15L → taxable = 14.5L (after 50K std deduction)
    const result = calculateOldRegimeTax(1500000, noDeductions);

    // 0-2.5L=0, 2.5L-5L=12500, 5L-10L=100000, 10L-14.5L=135000
    // Total = 247500
    expect(result.taxableIncome).toBe(1450000);
    expect(result.baseTax).toBe(247500);
  });

  it("caps 80C deduction at Rs 1.5L", () => {
    const result = calculateOldRegimeTax(1500000, {
      ...noDeductions,
      section80C: 200000, // claiming 2L but cap is 1.5L
    });

    // Taxable = 15L - 50K(std) - 150000(80C capped) = 13L
    expect(result.taxableIncome).toBe(1300000);
  });

  it("caps 80D deduction at Rs 75K", () => {
    const result = calculateOldRegimeTax(1500000, {
      ...noDeductions,
      section80D: 100000, // claiming 1L but cap is 75K
    });

    // Taxable = 15L - 50K(std) - 75000(80D capped) = 13.75L
    expect(result.taxableIncome).toBe(1375000);
  });

  it("caps home loan interest at Rs 2L (Section 24b)", () => {
    const result = calculateOldRegimeTax(1500000, {
      ...noDeductions,
      homeLoanInterest: 300000, // claiming 3L but cap is 2L
    });

    // Taxable = 15L - 50K(std) - 200000(24b capped) = 12.5L
    expect(result.taxableIncome).toBe(1250000);
  });

  it("allows full HRA exemption (no cap in engine)", () => {
    const result = calculateOldRegimeTax(1500000, {
      ...noDeductions,
      hraExemption: 200000,
    });

    // Taxable = 15L - 50K - 200000 = 12.5L
    expect(result.taxableIncome).toBe(1250000);
  });

  it("applies all deductions together", () => {
    const result = calculateOldRegimeTax(2000000, {
      section80C: 150000,
      section80D: 50000,
      hraExemption: 120000,
      homeLoanInterest: 200000,
      otherDeductions: 30000,
    });

    // Taxable = 20L - 50K(std) - 150K(80C) - 50K(80D) - 120K(HRA) - 200K(24b) - 30K(other) = 14L
    expect(result.taxableIncome).toBe(1400000);
  });

  it("does not go below zero taxable income", () => {
    const result = calculateOldRegimeTax(200000, {
      section80C: 150000,
      section80D: 50000,
      hraExemption: 100000,
      homeLoanInterest: 200000,
      otherDeductions: 50000,
    });

    expect(result.taxableIncome).toBe(0);
    expect(result.totalTax).toBe(0);
  });
});

// ─── Professional Tax ────────────────────────────────────

describe("getProfessionalTax", () => {
  it("returns 2400 for null state (default)", () => {
    expect(getProfessionalTax(null)).toBe(2400);
  });

  it("returns 2500 for Maharashtra", () => {
    expect(getProfessionalTax("Maharashtra")).toBe(2500);
  });

  it("returns 2400 for Karnataka", () => {
    expect(getProfessionalTax("Karnataka")).toBe(2400);
  });

  it("returns 0 for Delhi (no professional tax)", () => {
    expect(getProfessionalTax("Delhi")).toBe(0);
  });

  it("returns 0 for Rajasthan (no professional tax)", () => {
    expect(getProfessionalTax("Rajasthan")).toBe(0);
  });

  it("returns 2400 for unknown state (fallback)", () => {
    expect(getProfessionalTax("Unknown State")).toBe(2400);
  });

  it("STATE_LIST is sorted alphabetically", () => {
    const sorted = [...STATE_LIST].sort();
    expect(STATE_LIST).toEqual(sorted);
  });

  it("PROFESSIONAL_TAX_RATES has entries for all states in STATE_LIST", () => {
    for (const state of STATE_LIST) {
      expect(PROFESSIONAL_TAX_RATES[state]).toBeDefined();
    }
  });
});

// ─── Full calculateSalary Integration ────────────────────

describe("calculateSalary", () => {
  const defaultInput = {
    annualCTC: 2000000, // 20L
    basicPct: 40,
    hraPct: 50,
    isMetro: true,
    epfMode: "restricted" as const,
    epfInCTC: true,
    vpfMonthly: 0,
    professionalTaxAnnual: 2400,
    deductions80C: 0,
    deductions80D: 0,
    hraExemptionAnnual: 0,
    homeLoanInterest: 0,
    otherDeductions: 0,
  };

  it("returns all expected fields", () => {
    const result = calculateSalary(defaultInput);

    expect(result).toHaveProperty("ctcBreakdown");
    expect(result).toHaveProperty("epf");
    expect(result).toHaveProperty("newRegimeTax");
    expect(result).toHaveProperty("oldRegimeTax");
    expect(result).toHaveProperty("professionalTaxAnnual");
    expect(result).toHaveProperty("annualInHand");
    expect(result).toHaveProperty("monthlyInHand");
    expect(result).toHaveProperty("selectedRegime");
  });

  it("selects the regime with lower tax", () => {
    const result = calculateSalary(defaultInput);

    // For a 20L CTC with no deductions, new regime should be better
    if (result.newRegimeTax.totalTax <= result.oldRegimeTax.totalTax) {
      expect(result.selectedRegime).toBe("new");
    } else {
      expect(result.selectedRegime).toBe("old");
    }
  });

  it("calculates positive monthly in-hand", () => {
    const result = calculateSalary(defaultInput);

    expect(result.monthlyInHand).toBeGreaterThan(0);
    expect(result.annualInHand).toBeGreaterThan(0);
  });

  it("annual in-hand = gross - tax - EPF - professional tax", () => {
    const result = calculateSalary(defaultInput);

    const selectedTax =
      result.selectedRegime === "new"
        ? result.newRegimeTax.totalTax
        : result.oldRegimeTax.totalTax;

    const expectedAnnualInHand =
      result.ctcBreakdown.grossSalary -
      selectedTax -
      result.epf.totalDeducted -
      result.professionalTaxAnnual;

    expect(result.annualInHand).toBe(Math.round(expectedAnnualInHand));
  });

  it("monthlyInHand = annualInHand / 12 (float preserved)", () => {
    const result = calculateSalary(defaultInput);

    expect(result.monthlyInHand).toBeCloseTo(result.annualInHand / 12, 5);
  });

  it("includes EPF employee contribution in old regime 80C", () => {
    // With high deductions, old regime should have lower taxable income
    const result = calculateSalary({
      ...defaultInput,
      annualCTC: 3000000, // 30L — bigger difference between regimes
      deductions80C: 100000, // 80C claim (EPF adds to this)
      deductions80D: 50000,
      hraExemptionAnnual: 200000,
      homeLoanInterest: 200000,
    });

    // Old regime should benefit from deductions
    expect(result.oldRegimeTax.taxableIncome).toBeLessThan(
      result.newRegimeTax.taxableIncome,
    );
  });

  it("handles zero CTC gracefully", () => {
    const result = calculateSalary({
      ...defaultInput,
      annualCTC: 0,
    });

    expect(result.ctcBreakdown.basic).toBe(0);
    expect(result.newRegimeTax.totalTax).toBe(0);
    expect(result.oldRegimeTax.totalTax).toBe(0);
    // Monthly in-hand is negative due to professional tax still being deducted
    // annualInHand = 0 - 0 - 0 - 2400 = -2400, monthlyInHand = round(-2400/12) = -200
    expect(result.monthlyInHand).toBe(-200);
  });

  it("handles very high CTC (1 Cr)", () => {
    const result = calculateSalary({
      ...defaultInput,
      annualCTC: 10000000,
    });

    // Should hit higher surcharge tiers
    expect(result.newRegimeTax.totalTax).toBeGreaterThan(0);
    expect(result.oldRegimeTax.totalTax).toBeGreaterThan(0);
    expect(result.monthlyInHand).toBeGreaterThan(0);
    // Effective rate should be meaningful
    expect(result.newRegimeTax.effectiveRate).toBeGreaterThan(15);
  });

  it("VPF reduces in-hand but not tax", () => {
    const withoutVPF = calculateSalary(defaultInput);
    const withVPF = calculateSalary({
      ...defaultInput,
      vpfMonthly: 5000,
    });

    // VPF doesn't change gross salary or tax in new regime
    expect(withVPF.newRegimeTax.totalTax).toBe(
      withoutVPF.newRegimeTax.totalTax,
    );
    // But reduces in-hand (VPF is deducted from salary)
    expect(withVPF.annualInHand).toBeLessThan(withoutVPF.annualInHand);
    expect(withVPF.annualInHand).toBe(withoutVPF.annualInHand - 60000);
  });

  it("full_basic EPF reduces gross salary more than restricted", () => {
    const restricted = calculateSalary(defaultInput);
    const fullBasic = calculateSalary({
      ...defaultInput,
      epfMode: "full_basic",
    });

    // Full basic EPF takes more from CTC
    expect(fullBasic.ctcBreakdown.grossSalary).toBeLessThan(
      restricted.ctcBreakdown.grossSalary,
    );
    // But also deducts more from employee
    expect(fullBasic.epf.employeeContribution).toBeGreaterThan(
      restricted.epf.employeeContribution,
    );
  });
});

// ─── Edge Cases & Boundary Tests ─────────────────────────

describe("Edge cases", () => {
  it("new regime: income exactly at each slab boundary", () => {
    // Test at Rs 4L taxable (end of 0% slab)
    const at4L = calculateNewRegimeTax(475000); // 4L + 75K std
    expect(at4L.baseTax).toBe(0);

    // Test at Rs 8L taxable (end of 5% slab)
    const at8L = calculateNewRegimeTax(875000);
    expect(at8L.baseTax).toBe(20000); // 4L*0 + 4L*5%

    // Test at Rs 12L taxable (end of 10% slab)
    const at12L = calculateNewRegimeTax(1275000);
    expect(at12L.baseTax).toBe(60000); // 0 + 20K + 40K

    // Test at Rs 16L taxable (end of 15% slab)
    const at16L = calculateNewRegimeTax(1675000);
    expect(at16L.baseTax).toBe(120000); // 0 + 20K + 40K + 60K

    // Test at Rs 20L taxable (end of 20% slab)
    const at20L = calculateNewRegimeTax(2075000);
    expect(at20L.baseTax).toBe(200000); // 0 + 20K + 40K + 60K + 80K

    // Test at Rs 24L taxable (end of 25% slab)
    const at24L = calculateNewRegimeTax(2475000);
    expect(at24L.baseTax).toBe(300000); // 0 + 20K + 40K + 60K + 80K + 100K
  });

  it("old regime: income exactly at each slab boundary", () => {
    // At Rs 2.5L taxable (end of 0% slab)
    const at2_5L = calculateOldRegimeTax(300000, {
      section80C: 0,
      section80D: 0,
      hraExemption: 0,
      homeLoanInterest: 0,
      otherDeductions: 0,
    });
    expect(at2_5L.baseTax).toBe(0);

    // At Rs 5L taxable (end of 5% slab)
    const at5L = calculateOldRegimeTax(550000, {
      section80C: 0,
      section80D: 0,
      hraExemption: 0,
      homeLoanInterest: 0,
      otherDeductions: 0,
    });
    expect(at5L.baseTax).toBe(12500);

    // At Rs 10L taxable (end of 20% slab)
    const at10L = calculateOldRegimeTax(1050000, {
      section80C: 0,
      section80D: 0,
      hraExemption: 0,
      homeLoanInterest: 0,
      otherDeductions: 0,
    });
    expect(at10L.baseTax).toBe(112500); // 0 + 12.5K + 100K
  });

  it("87A rebate boundary: Rs 12L vs Rs 12L + 1 (new regime, with marginal relief)", () => {
    const atLimit = calculateNewRegimeTax(1275000); // taxable = 12L
    const aboveLimit = calculateNewRegimeTax(1275001); // taxable = 12L + 1

    // At 12L: full rebate → 0 tax
    expect(atLimit.totalTax).toBe(0);
    // At 12L+1: rebate gone BUT marginal relief caps tax at ~1 (instead of ~60K).
    // This is the whole point of marginal relief — no tax cliff.
    expect(aboveLimit.totalTax).toBeLessThanOrEqual(2);
    expect(aboveLimit.marginalRelief).toBeGreaterThan(0);
  });

  it("87A rebate boundary: Rs 5L vs Rs 5L + 1 (old regime)", () => {
    const noDeductions = {
      section80C: 0,
      section80D: 0,
      hraExemption: 0,
      homeLoanInterest: 0,
      otherDeductions: 0,
    };

    const atLimit = calculateOldRegimeTax(550000, noDeductions); // taxable = 5L
    const aboveLimit = calculateOldRegimeTax(550001, noDeductions); // taxable = 5L+1

    expect(atLimit.totalTax).toBe(0);
    expect(aboveLimit.totalTax).toBeGreaterThan(0);
  });

  it("totalTax is always a round number", () => {
    const amounts = [500000, 1000000, 1500000, 2000000, 2500000, 3000000];

    for (const amount of amounts) {
      const result = calculateNewRegimeTax(amount);
      expect(result.totalTax).toBe(Math.round(result.totalTax));
    }
  });

  it("effectiveRate is between 0% and 50%", () => {
    const amounts = [0, 200000, 500000, 1000000, 2000000, 5000000, 10000000];

    for (const amount of amounts) {
      const result = calculateNewRegimeTax(amount);
      expect(result.effectiveRate).toBeGreaterThanOrEqual(0);
      expect(result.effectiveRate).toBeLessThan(50);
    }
  });
});

// ─── Bonus Tax (Marginal Method) ─────────────────────────

describe("computeBonusTax", () => {
  it("returns zero for zero bonus", () => {
    const result = computeBonusTax(2000000, 0, "new");
    expect(result.grossBonus).toBe(0);
    expect(result.taxOnBonus).toBe(0);
    expect(result.netBonus).toBe(0);
    expect(result.effectiveRate).toBe(0);
  });

  it("returns zero for negative bonus", () => {
    const result = computeBonusTax(2000000, -50000, "new");
    expect(result.grossBonus).toBe(0);
    expect(result.taxOnBonus).toBe(0);
  });

  it("computes marginal tax on bonus (new regime, 20L salary)", () => {
    // Salary = 20L gross → taxable = 19.25L (after 75K std deduction)
    // That puts us in the 20% slab (16L-20L)
    // Bonus of 1L should be taxed mostly at 20% marginal rate
    const result = computeBonusTax(2000000, 100000, "new");

    expect(result.grossBonus).toBe(100000);
    expect(result.taxOnBonus).toBeGreaterThan(0);
    expect(result.netBonus).toBeLessThan(100000);
    expect(result.netBonus).toBe(100000 - result.taxOnBonus);
    // Marginal rate at 20% slab + 4% cess ≈ 20.8%
    expect(result.effectiveRate).toBeGreaterThan(19);
    expect(result.effectiveRate).toBeLessThan(23);
  });

  it("computes marginal tax on bonus (old regime, 20L salary)", () => {
    const result = computeBonusTax(2000000, 100000, "old");

    expect(result.grossBonus).toBe(100000);
    expect(result.taxOnBonus).toBeGreaterThan(0);
    // Old regime has 30% slab above 10L, so bonus should be at ~31.2%
    expect(result.effectiveRate).toBeGreaterThan(29);
    expect(result.effectiveRate).toBeLessThan(33);
  });

  it("bonus in zero-tax bracket is tax-free", () => {
    // Salary of 3L gross → taxable = 2.25L (new regime, after 75K std)
    // In 0% slab. Bonus of 50K → taxable becomes 2.75L, still 0%.
    const result = computeBonusTax(300000, 50000, "new");

    expect(result.taxOnBonus).toBe(0);
    expect(result.netBonus).toBe(50000);
    expect(result.effectiveRate).toBe(0);
  });

  it("bonus spans two slab boundaries", () => {
    // Salary 8.75L → taxable 8L (end of 5% slab in new regime)
    // Bonus 5L → taxable becomes 13L, spanning 10% and 15% slabs
    const result = computeBonusTax(875000, 500000, "new");

    // Should be between 5% and 15% effective
    expect(result.effectiveRate).toBeGreaterThan(5);
    expect(result.effectiveRate).toBeLessThan(16);
    expect(result.taxOnBonus).toBeGreaterThan(0);
  });

  it("includes 4% cess in bonus tax", () => {
    const result = computeBonusTax(2000000, 100000, "new");

    // 20L salary → taxable 19.25L (20% slab). Bonus 1L → taxable 20.25L.
    // 75K stays in 20% slab, 25K enters 25% slab.
    // Marginal tax = 75000*0.20 + 25000*0.25 = 15000 + 6250 = 21250
    // With 4% cess: 21250 + 850 = 22100
    expect(result.taxOnBonus).toBe(22100);
  });

  it("handles zero salary base", () => {
    // No salary income, just a bonus
    const result = computeBonusTax(0, 200000, "new");

    // Bonus 2L + 0 salary → taxable = 2L - 75K = 1.25L → 0% slab
    expect(result.taxOnBonus).toBe(0);
    expect(result.netBonus).toBe(200000);
  });
});

// ─── Capital Gains Tax ────────────────────────────────────

describe("computeCapitalGainsTax", () => {
  const noGains = {
    equity_ltcg: 0,
    equity_stcg: 0,
    debt: 0,
    fd: 0,
    gold: 0,
    real_estate: 0,
  };

  it("returns empty items when all gains are zero", () => {
    const result = computeCapitalGainsTax(noGains, 2000000, "new");

    expect(result.items).toHaveLength(0);
    expect(result.totalGross).toBe(0);
    expect(result.totalTax).toBe(0);
    expect(result.totalNet).toBe(0);
  });

  it("equity LTCG: 12.5% with Rs 1.25L exemption + 4% cess", () => {
    const result = computeCapitalGainsTax(
      { ...noGains, equity_ltcg: 300000 },
      2000000,
      "new",
    );

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.label).toBe("Equity LTCG");
    expect(item.gross).toBe(300000);
    // Taxable = 300000 - 125000 = 175000, tax = 175000 * 0.125 = 21875
    // With 4% cess: 21875 * 1.04 = 22750
    expect(item.tax).toBe(Math.round(21875 * 1.04));
    expect(item.net).toBe(300000 - item.tax);
    expect(item.rate).toBe("12.5%");
  });

  it("equity LTCG: no tax when below exemption", () => {
    const result = computeCapitalGainsTax(
      { ...noGains, equity_ltcg: 100000 },
      2000000,
      "new",
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].tax).toBe(0); // below 1.25L exemption
    expect(result.items[0].net).toBe(100000);
  });

  it("equity LTCG: exactly at exemption limit", () => {
    const result = computeCapitalGainsTax(
      { ...noGains, equity_ltcg: 125000 },
      2000000,
      "new",
    );

    expect(result.items[0].tax).toBe(0);
  });

  it("equity STCG: flat 20% + 4% cess", () => {
    const result = computeCapitalGainsTax(
      { ...noGains, equity_stcg: 200000 },
      2000000,
      "new",
    );

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.label).toBe("Equity STCG");
    // 200000 * 0.20 = 40000; +4% cess = 41600
    expect(item.tax).toBe(Math.round(40000 * 1.04));
    expect(item.rate).toBe("20%");
  });

  it("debt MF: taxed at slab rate (marginal)", () => {
    const result = computeCapitalGainsTax(
      { ...noGains, debt: 100000 },
      2000000,
      "new",
    );

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.label).toBe("Debt MF");
    expect(item.rate).toBe("Slab");
    // At 20L salary, marginal rate is ~20% + 4% cess ≈ 20.8%
    expect(item.tax).toBeGreaterThan(0);
    expect(item.tax).toBeLessThan(35000); // can't be more than 30%+cess
  });

  it("FD interest: taxed at slab rate (stacked on salary + debt)", () => {
    const result = computeCapitalGainsTax(
      { ...noGains, debt: 100000, fd: 100000 },
      2000000,
      "new",
    );

    expect(result.items).toHaveLength(2);
    const debtItem = result.items.find((i) => i.label === "Debt MF");
    const fdItem = result.items.find((i) => i.label === "FD Interest");
    expect(debtItem).toBeDefined();
    expect(fdItem).toBeDefined();
    // FD tax computed on top of salary + debt income
    expect(fdItem!.tax).toBeGreaterThan(0);
  });

  it("gold LTCG: flat 12.5% + 4% cess", () => {
    const result = computeCapitalGainsTax(
      { ...noGains, gold: 500000 },
      2000000,
      "new",
    );

    expect(result.items).toHaveLength(1);
    // 500000 * 0.125 = 62500; +4% cess = 65000
    expect(result.items[0].tax).toBe(Math.round(62500 * 1.04));
    expect(result.items[0].rate).toBe("12.5%");
  });

  it("real estate LTCG: flat 12.5% + 4% cess", () => {
    const result = computeCapitalGainsTax(
      { ...noGains, real_estate: 1000000 },
      2000000,
      "new",
    );

    expect(result.items).toHaveLength(1);
    // 1000000 * 0.125 = 125000; +4% cess = 130000
    expect(result.items[0].tax).toBe(Math.round(125000 * 1.04));
    expect(result.items[0].rate).toBe("12.5%");
  });

  it("multiple asset types together", () => {
    const gains = {
      equity_ltcg: 200000,
      equity_stcg: 100000,
      debt: 50000,
      fd: 30000,
      gold: 0,
      real_estate: 500000,
    };

    const result = computeCapitalGainsTax(gains, 2000000, "new");

    expect(result.items).toHaveLength(5); // 5 non-zero types (gold=0 excluded)
    expect(result.totalGross).toBe(200000 + 100000 + 50000 + 30000 + 500000);
    expect(result.totalTax).toBeGreaterThan(0);
    expect(result.totalNet).toBe(result.totalGross - result.totalTax);
  });

  it("totals are consistent", () => {
    const gains = {
      equity_ltcg: 300000,
      equity_stcg: 200000,
      debt: 100000,
      fd: 50000,
      gold: 150000,
      real_estate: 400000,
    };

    const result = computeCapitalGainsTax(gains, 2000000, "new");

    const sumGross = result.items.reduce((s, i) => s + i.gross, 0);
    const sumTax = result.items.reduce((s, i) => s + i.tax, 0);

    expect(result.totalGross).toBe(sumGross);
    expect(result.totalTax).toBe(sumTax);
    expect(result.totalNet).toBe(sumGross - sumTax);
  });

  it("uses old regime slabs for slab-rated items", () => {
    // Old regime has 30% slab above 10L. At 20L salary, debt/FD should be at 30% marginal.
    const resultOld = computeCapitalGainsTax(
      { ...noGains, debt: 100000 },
      2000000,
      "old",
    );
    const resultNew = computeCapitalGainsTax(
      { ...noGains, debt: 100000 },
      2000000,
      "new",
    );

    // Old regime marginal rate (30%) should be higher than new regime (20%) for 20L salary
    expect(resultOld.items[0].tax).toBeGreaterThan(resultNew.items[0].tax);
  });

  it("handles zero salary income gracefully", () => {
    const result = computeCapitalGainsTax(
      { ...noGains, equity_ltcg: 200000, debt: 100000 },
      0,
      "new",
    );

    // Equity LTCG still works (fixed rate + cess)
    const equityItem = result.items.find((i) => i.label === "Equity LTCG");
    // 200K - 125K exempt = 75K taxable, 75K * 0.125 = 9375; +4% cess = 9750
    expect(equityItem!.tax).toBe(Math.round(9375 * 1.04));
    // Debt at slab: with 0 salary, 100K debt → taxable after std deduction = max(100K-75K,0)=25K → 0% slab
    const debtItem = result.items.find((i) => i.label === "Debt MF");
    expect(debtItem!.tax).toBe(0);
  });
});
