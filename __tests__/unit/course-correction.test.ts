import { evaluateCourseCorrection } from "@/utils/course-correction";

describe("evaluateCourseCorrection", () => {
  test("no alert when on track", () => {
    const result = evaluateCourseCorrection({
      actualSavingsRatePct: 30,
      targetSavingsRatePct: 25,
      savingsGap: 5000,
      courseCorrectionPerMonth: 8000,
      avgMonthlySavings: 10000,
      monthsRemaining: 9,
    });

    expect(result.shouldAlert).toBe(false);
    expect(result.severity).toBe("info");
    expect(result.rateGapPct).toBe(0);
    expect(result.message).toBe("");
  });

  test("no alert when exactly on target", () => {
    const result = evaluateCourseCorrection({
      actualSavingsRatePct: 25,
      targetSavingsRatePct: 25,
      savingsGap: 0,
      courseCorrectionPerMonth: 8000,
      avgMonthlySavings: 8000,
      monthsRemaining: 9,
    });

    expect(result.shouldAlert).toBe(false);
  });

  test("info severity when gap is 0-5% (no visible alert)", () => {
    const result = evaluateCourseCorrection({
      actualSavingsRatePct: 22,
      targetSavingsRatePct: 25,
      savingsGap: -3000,
      courseCorrectionPerMonth: 9000,
      avgMonthlySavings: 8000,
      monthsRemaining: 9,
    });

    expect(result.shouldAlert).toBe(false);
    expect(result.severity).toBe("info");
    expect(result.rateGapPct).toBe(3);
  });

  test("warning severity when gap is 5-10%", () => {
    const result = evaluateCourseCorrection({
      actualSavingsRatePct: 18,
      targetSavingsRatePct: 25,
      savingsGap: -15000,
      courseCorrectionPerMonth: 12000,
      avgMonthlySavings: 8000,
      monthsRemaining: 9,
    });

    expect(result.shouldAlert).toBe(true);
    expect(result.severity).toBe("warning");
    expect(result.rateGapPct).toBe(7);
    expect(result.extraPerMonth).toBe(4000);
  });

  test("critical severity when gap exceeds 10%", () => {
    const result = evaluateCourseCorrection({
      actualSavingsRatePct: 10,
      targetSavingsRatePct: 25,
      savingsGap: -50000,
      courseCorrectionPerMonth: 20000,
      avgMonthlySavings: 5000,
      monthsRemaining: 6,
    });

    expect(result.shouldAlert).toBe(true);
    expect(result.severity).toBe("critical");
    expect(result.rateGapPct).toBe(15);
    expect(result.amountBehind).toBe(50000);
    expect(result.extraPerMonth).toBe(15000);
  });

  test("message includes amount and months for critical", () => {
    const result = evaluateCourseCorrection({
      actualSavingsRatePct: 10,
      targetSavingsRatePct: 25,
      savingsGap: -50000,
      courseCorrectionPerMonth: 20000,
      avgMonthlySavings: 5000,
      monthsRemaining: 6,
    });

    expect(result.message).toContain("50,000");
    expect(result.message).toContain("15,000");
    expect(result.message).toContain("6 months");
  });

  test("handles end of year (0 months remaining)", () => {
    const result = evaluateCourseCorrection({
      actualSavingsRatePct: 15,
      targetSavingsRatePct: 25,
      savingsGap: -30000,
      courseCorrectionPerMonth: 0,
      avgMonthlySavings: 5000,
      monthsRemaining: 0,
    });

    expect(result.shouldAlert).toBe(true);
    expect(result.message).toContain("ended the year");
    expect(result.message).toContain("30,000");
  });

  test("extraPerMonth is 0 when correction is below current pace", () => {
    const result = evaluateCourseCorrection({
      actualSavingsRatePct: 23,
      targetSavingsRatePct: 25,
      savingsGap: -2000,
      courseCorrectionPerMonth: 7000,
      avgMonthlySavings: 8000,
      monthsRemaining: 9,
    });

    expect(result.extraPerMonth).toBe(0);
  });
});
