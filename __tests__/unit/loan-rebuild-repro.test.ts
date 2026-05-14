/**
 * Repro test for user-reported bug: "Amortization does not update after EMI
 * reduction or tenure reduction done when prepayment is recorded."
 *
 * Directly tests applyPrepayment via a realistic scenario (60-month loan,
 * first prepayment at month 4 with reduce_tenure / reduce_emi) and asserts
 * that the tail diverges from the original amortization.
 */

import {
  generateSchedule,
  applyPrepayment,
  type LoanParams,
} from "@/services/loan-engine";

const loan: LoanParams = {
  principal_disbursed: 1000000, // ₹10L
  interest_rate_pa: 10,
  tenure_months: 60,
  emi_amount: 21247, // ~₹21,247 EMI at 10% for 60mo
  disbursement_date: "2026-01-01",
  emi_start_date: "2026-02-01",
  emi_day_of_month: 1,
  round_mode: "rupee",
};

describe("rebuild repro — prepayment updates amortization", () => {
  it("reduce_tenure: prepayment shortens tail and shifts principal/interest", () => {
    const original = generateSchedule(loan);
    // Simulate 3 EMIs paid
    for (let i = 0; i < 3; i++) original[i].status = "paid";

    const afterPrepay = applyPrepayment(original, loan, {
      prepayment_date: "2026-05-02",
      amount: 100000,
      prepayment_charge: 0,
      gst_on_charge: 0,
      kind: "part_payment",
      strategy: "reduce_tenure",
    });

    // Assertions:
    // 1. Total installments should be less than 60 (tail shortened)
    expect(afterPrepay.length).toBeLessThan(60);

    // 2. First unpaid installment (#4) should have the SAME EMI as original
    //    but a LOWER opening_principal (because prepayment reduced it).
    const originalInst4 = original[3];
    const newInst4 = afterPrepay.find((e) => e.installment_num === 4)!;
    expect(newInst4).toBeDefined();
    expect(newInst4.emi_amount).toBe(loan.emi_amount); // EMI unchanged
    expect(newInst4.opening_principal).toBeLessThan(originalInst4.opening_principal);

    // 3. Principal component on #4 should be GREATER than original
    //    (less interest → more principal eaten per EMI)
    expect(newInst4.principal_component).toBeGreaterThan(originalInst4.principal_component);
  });

  it("reduce_emi: prepayment lowers EMI on future installments", () => {
    const original = generateSchedule(loan);
    for (let i = 0; i < 3; i++) original[i].status = "paid";

    const afterPrepay = applyPrepayment(original, loan, {
      prepayment_date: "2026-05-02",
      amount: 100000,
      prepayment_charge: 0,
      gst_on_charge: 0,
      kind: "part_payment",
      strategy: "reduce_emi",
    });

    // Tail length unchanged (57 remaining months)
    const newScheduled = afterPrepay.filter((e) => e.status === "scheduled");
    expect(newScheduled.length).toBeGreaterThanOrEqual(55);
    expect(newScheduled.length).toBeLessThanOrEqual(58);

    // First unpaid installment should have a LOWER EMI than original
    const newInst4 = afterPrepay.find((e) => e.installment_num === 4)!;
    expect(newInst4).toBeDefined();
    expect(newInst4.emi_amount).toBeLessThan(loan.emi_amount);
  });

  it("v17.5.13 — reduce_emi at exactly current EMI further reduces the tail EMI", () => {
    // Real-world scenario: first reduce_emi prepayment of ~₹100k brings the
    // tail EMI down from ~₹21,247 to ~lower. Then a second prepayment at
    // exactly the NEW (current) EMI, with strategy reduce_emi, should
    // further lower the tail EMI — NOT fall through to the trivial path
    // against the sanctioned ₹21,247.
    const fresh = generateSchedule(loan);
    // Stamp first 3 paid.
    for (let i = 0; i < 3; i++) fresh[i].status = "paid";
    const afterFirst = applyPrepayment(fresh, loan, {
      prepayment_date: "2026-05-02",
      amount: 100000,
      prepayment_charge: 0,
      gst_on_charge: 0,
      kind: "part_payment",
      strategy: "reduce_emi",
    });
    // Tail EMI after first reduce_emi prepayment.
    const firstTail = afterFirst.find((e) => e.installment_num === 4)!;
    const newCurrentEmi = firstTail.emi_amount;
    expect(newCurrentEmi).toBeLessThan(loan.emi_amount);

    // Second prepayment — exactly one CURRENT EMI (not sanctioned).
    // Engine's trivial-path gate pre-v17.5.13 was `< loan.emi_amount`, so
    // this would silently fall through and leave the tail EMI unchanged.
    // v17.5.13+: gate is `< currentEmi`, so this prepayment respects the
    // reduce_emi strategy and further reduces the tail EMI.
    //
    // Stamp installment #4 as paid so the second prepayment lands after
    // the fresh batch of "scheduled" entries in afterFirst.
    afterFirst[3].status = "paid";
    const afterSecond = applyPrepayment(afterFirst, loan, {
      prepayment_date: "2026-06-02",
      amount: newCurrentEmi,
      prepayment_charge: 0,
      gst_on_charge: 0,
      kind: "part_payment",
      strategy: "reduce_emi",
    });
    const secondTail = afterSecond.find((e) => e.installment_num === 5);
    expect(secondTail).toBeDefined();
    // Tail EMI should drop further — strictly less than newCurrentEmi.
    expect(secondTail!.emi_amount).toBeLessThan(newCurrentEmi);
  });

  it("v17.5.14 — reduce_emi with non-zero charge still regens tail EMI when gross ≥ currentEmi", () => {
    // Repro for the expense→loan flow: auto-derived charges (v17.5.13)
    // made `net` drop below currentEmi even when the user-entered gross
    // amount equalled currentEmi. Pre-v17.5.14 engine used `net < currentEmi`
    // as the gate, so strategy pick was silently ignored.
    const fresh = generateSchedule(loan);
    for (let i = 0; i < 3; i++) fresh[i].status = "paid";

    // Gross = exactly one EMI (21,247). Charge + GST = 250 + 45 = 295.
    // net = 21,247 − 295 = 20,952 < 21,247. Pre-v17.5.14 gate fires, trivial
    // path runs, tail EMI stays at sanctioned. v17.5.14: gate compares
    // gross (21,247) vs currentEmi (21,247) — NOT trivial — strategy honored.
    const afterPrepay = applyPrepayment(fresh, loan, {
      prepayment_date: "2026-05-02",
      amount: loan.emi_amount,
      prepayment_charge: 250,
      gst_on_charge: 45,
      kind: "part_payment",
      strategy: "reduce_emi",
    });

    const newInst4 = afterPrepay.find((e) => e.installment_num === 4)!;
    expect(newInst4).toBeDefined();
    // Tail EMI should drop — strictly less than sanctioned.
    expect(newInst4.emi_amount).toBeLessThan(loan.emi_amount);
  });

  it("rebuild simulation: fresh regen + replay prepayment produces different schedule", () => {
    // Mirrors what rebuildLoanSchedule does: generate fresh, stamp N paid,
    // replay prepayment via applyPrepayment.
    const fresh = generateSchedule(loan);
    const paidCount = 3;
    const schedule = fresh.map((e) => ({
      ...e,
      status: (e.installment_num <= paidCount ? "paid" : "scheduled") as
        | "paid"
        | "scheduled",
    }));
    const afterRebuild = applyPrepayment(schedule, loan, {
      prepayment_date: "2026-05-02",
      amount: 100000,
      prepayment_charge: 0,
      gst_on_charge: 0,
      kind: "part_payment",
      strategy: "reduce_tenure",
    });

    // The rebuilt schedule's first scheduled installment (#4) should have
    // different opening_principal than the original #4 (because prepayment
    // reduced it).
    const orig4 = fresh.find((e) => e.installment_num === 4)!;
    const new4 = afterRebuild.find((e) => e.installment_num === 4)!;
    expect(new4).toBeDefined();
    expect(new4.opening_principal).not.toBe(orig4.opening_principal);
    expect(afterRebuild.length).toBeLessThan(fresh.length);
  });
});
