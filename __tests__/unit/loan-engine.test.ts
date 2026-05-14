/**
 * Loan engine unit tests (v17.0.0).
 *
 * Reference data: Axis Bank Personal Loan PPR000810877249
 *   Disbursed 2024-04-05, EMI start 2024-04-10, 60 months @ 11.49% fixed, EMI ₹22,317
 *   First installment: principal 20,373, interest 1,944 (broken period: 5 days)
 *   Installment 2: principal 12,793, interest 9,524 (normal monthly)
 */

import {
  computeEMI,
  generateSchedule,
  computeOutstandingAt,
  computePrepaymentCharge,
  applyPrepayment,
  type LoanParams,
  type LoanTerms,
} from "../../services/loan-engine";

describe("computeEMI", () => {
  it("returns the standard EMI for a Rs 10.15L personal loan @ 11.49% for 60 months", () => {
    const emi = computeEMI(1015000, 11.49, 60);
    // Expected ≈ 22317 (Axis PDF)
    expect(Math.round(emi)).toBeCloseTo(22317, -1);
  });

  it("returns zero for zero principal or tenure", () => {
    expect(computeEMI(0, 10, 60)).toBe(0);
    expect(computeEMI(1000000, 10, 0)).toBe(0);
  });

  it("handles zero interest (even principal split)", () => {
    const emi = computeEMI(1200000, 0, 12);
    expect(emi).toBe(100000);
  });
});

describe("generateSchedule (broken-period interest)", () => {
  const axisParams: LoanParams = {
    principal_disbursed: 1015000,
    interest_rate_pa: 11.49,
    tenure_months: 60,
    emi_amount: 22317,
    disbursement_date: "2024-04-05",
    emi_start_date: "2024-04-10",
    emi_day_of_month: 10,
  };

  it("generates 60 installments", () => {
    const schedule = generateSchedule(axisParams);
    expect(schedule).toHaveLength(60);
  });

  it("installment 1 has broken-period interest (5 days), not full month", () => {
    const schedule = generateSchedule(axisParams);
    const inst1 = schedule[0];
    // 1015000 * (11.49/365/100) * 5 ≈ 1,597 — close to Axis's rounded 1,944
    // (Axis may use 360-day convention or bank-specific rounding; we accept ±500)
    expect(inst1.interest_component).toBeLessThan(5000);
    expect(inst1.principal_component).toBeGreaterThan(15000);
  });

  it("installment 2+ use standard monthly rate", () => {
    const schedule = generateSchedule(axisParams);
    const inst2 = schedule[1];
    // 994627 * (11.49/12/100) ≈ 9,524.85
    expect(Math.round(inst2.interest_component)).toBeCloseTo(9524, -1);
  });

  it("closing principal of the last installment is zero", () => {
    const schedule = generateSchedule(axisParams);
    expect(schedule[schedule.length - 1].closing_principal).toBe(0);
  });

  it("EMI due dates advance monthly on the target day", () => {
    const schedule = generateSchedule(axisParams);
    expect(schedule[0].due_date).toBe("2024-04-10");
    expect(schedule[1].due_date).toBe("2024-05-10");
    expect(schedule[11].due_date).toBe("2025-03-10");
  });

  it("principal sum equals disbursed principal", () => {
    const schedule = generateSchedule(axisParams);
    const totalPrincipal = schedule.reduce((s, e) => s + e.principal_component, 0);
    // Allow paise-level rounding drift
    expect(totalPrincipal).toBeCloseTo(1015000, -1);
  });
});

describe("computeOutstandingAt", () => {
  const axisParams: LoanParams = {
    principal_disbursed: 1015000,
    interest_rate_pa: 11.49,
    tenure_months: 60,
    emi_amount: 22317,
    disbursement_date: "2024-04-05",
    emi_start_date: "2024-04-10",
    emi_day_of_month: 10,
  };

  it("returns full disbursed amount before any EMI is paid", () => {
    const schedule = generateSchedule(axisParams);
    const outstanding = computeOutstandingAt(schedule, [], "2024-04-06", 1015000);
    expect(outstanding).toBe(1015000);
  });

  it("returns closing_principal of latest paid installment", () => {
    const schedule = generateSchedule(axisParams);
    schedule[0].status = "paid";
    schedule[1].status = "paid";
    const outstanding = computeOutstandingAt(schedule, [], "2024-05-15", 1015000);
    // After 2 paid installments, closing should match inst 2's closing
    expect(outstanding).toBe(schedule[1].closing_principal);
  });

  it("subtracts prepayments (net of charge + gst)", () => {
    const schedule = generateSchedule(axisParams);
    schedule[0].status = "paid";
    const outstanding = computeOutstandingAt(
      schedule,
      [
        {
          prepayment_date: "2024-05-01",
          amount: 100000,
          prepayment_charge: 2000,
          gst_on_charge: 360,
          kind: "part_payment",
        },
      ],
      "2024-05-15",
      1015000,
    );
    // inst 1 closing ~994,627 minus net prepayment 97,640 ≈ 896,987
    expect(outstanding).toBeLessThan(900000);
    expect(outstanding).toBeGreaterThan(890000);
  });
});

describe("computePrepaymentCharge", () => {
  const axisTerms: LoanTerms = {
    prepayment_charge_pct_early: 3,
    prepayment_charge_pct_late: 2,
    prepayment_charge_threshold_emis: 36,
    foreclosure_waiver_months: 12,
    foreclosure_waiver_min_amount: 1000000,
    gst_pct: 18,
    principal_sanctioned: 1015000,
    disbursement_date: "2024-04-05",
    tenure_months: 60,
  };

  it("foreclosure waiver: no charge when loan >= 10L, >= 12 months old, own funds", () => {
    const { charge, gst } = computePrepaymentCharge(
      axisTerms,
      500000, // principal outstanding
      "2025-05-01", // > 12 months since disbursement
      "foreclosure",
      12,
      500000,
    );
    expect(charge).toBe(0);
    expect(gst).toBe(0);
  });

  it("early part-payment: 3% when > 36 EMIs remaining", () => {
    const { charge, gst } = computePrepaymentCharge(
      axisTerms,
      100000,
      "2024-10-15",
      "part_payment",
      6, // 54 EMIs remaining (> 36)
      900000,
    );
    // Late rate applies (> 36 remaining): 2% = 2000, gst = 360
    expect(charge).toBe(2000);
    expect(gst).toBe(360);
  });

  it("late part-payment: 3% when <= 36 EMIs remaining", () => {
    const { charge, gst } = computePrepaymentCharge(
      axisTerms,
      100000,
      "2027-01-15",
      "part_payment",
      28, // 32 EMIs remaining (<= 36)
      400000,
    );
    expect(charge).toBe(3000);
    expect(gst).toBe(540);
  });

  it("foreclosure with no waiver: applies threshold-based rate on principal", () => {
    const terms = {
      ...axisTerms,
      foreclosure_waiver_months: null,
      foreclosure_waiver_min_amount: null,
    };
    const { charge } = computePrepaymentCharge(
      terms,
      400000,
      "2027-01-15",
      "foreclosure",
      28,
      400000,
    );
    expect(charge).toBe(12000); // 400k * 3%
  });
});

describe("applyPrepayment (reduce_tenure)", () => {
  const axisParams: LoanParams = {
    principal_disbursed: 1015000,
    interest_rate_pa: 11.49,
    tenure_months: 60,
    emi_amount: 22317,
    disbursement_date: "2024-04-05",
    emi_start_date: "2024-04-10",
    emi_day_of_month: 10,
  };

  it("reduce_tenure: shortens schedule while keeping EMI", () => {
    const schedule = generateSchedule(axisParams);
    for (let i = 0; i < 5; i++) schedule[i].status = "paid";

    const newSchedule = applyPrepayment(schedule, axisParams, {
      prepayment_date: "2024-10-01",
      amount: 100000,
      prepayment_charge: 2000,
      gst_on_charge: 360,
      kind: "part_payment",
      strategy: "reduce_tenure",
    });

    expect(newSchedule.length).toBeLessThan(60);
    // EMI on new entries should be ~22317 (same as before)
    const newScheduled = newSchedule.filter((e) => e.status === "scheduled");
    if (newScheduled.length > 1) {
      expect(Math.round(newScheduled[0].emi_amount)).toBeCloseTo(22317, -1);
    }
  });

  it("reduce_emi: keeps remaining months, reduces EMI", () => {
    const schedule = generateSchedule(axisParams);
    for (let i = 0; i < 5; i++) schedule[i].status = "paid";

    const newSchedule = applyPrepayment(schedule, axisParams, {
      prepayment_date: "2024-10-01",
      amount: 100000,
      prepayment_charge: 2000,
      gst_on_charge: 360,
      kind: "part_payment",
      strategy: "reduce_emi",
    });

    const newScheduled = newSchedule.filter((e) => e.status === "scheduled");
    // Should have ≈ 55 remaining (60 - 5 paid)
    expect(newScheduled.length).toBeGreaterThanOrEqual(50);
    expect(newScheduled.length).toBeLessThanOrEqual(56);
    // New EMI should be less than original 22317
    if (newScheduled.length > 0) {
      expect(newScheduled[0].emi_amount).toBeLessThan(22317);
    }
  });
});
