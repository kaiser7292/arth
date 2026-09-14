/**
 * Life milestone effective-due-date resolution, inclusive months-remaining,
 * and due-date sorting — pure date math, no DB involved.
 */
import {
  getMilestoneEffectiveDueDate,
  getMilestoneMonthsRemaining,
  getMilestoneMonthlyNeeded,
  compareMilestonesByDueDate,
  type LifeMilestone,
} from "../../services/life-milestone";

function makeMilestone(overrides: Partial<LifeMilestone> = {}): LifeMilestone {
  return {
    id: "m1",
    user_id: "u1",
    name: "Test",
    target_amount: 120000,
    current_saved: 0,
    target_date: null,
    monthly_contribution_planned: 0,
    start_financial_year: null,
    duration_years: 0,
    duration_months: 0,
    is_completed: 0,
    completed_date: null,
    sort_order: 0,
    ...overrides,
  };
}

const FY_START_MONTH = 4; // April — Indian FY default

describe("getMilestoneEffectiveDueDate", () => {
  it("uses target_date directly when set", () => {
    const m = makeMilestone({ target_date: "2027-08-15", start_financial_year: "2025", duration_years: 1 });
    expect(getMilestoneEffectiveDueDate(m, FY_START_MONTH)).toBe("2027-08-15");
  });

  it("falls back to the FY+duration plan's end month when no target_date is set", () => {
    // FY 2025 starts April 2025. A 12-month plan ends March 2026.
    const m = makeMilestone({ start_financial_year: "2025", duration_years: 1, duration_months: 0 });
    expect(getMilestoneEffectiveDueDate(m, FY_START_MONTH)).toBe("2026-03-31");
  });

  it("handles a duration in months only, spanning a partial year", () => {
    // FY 2025 starts April 2025. A 5-month plan ends August 2025.
    const m = makeMilestone({ start_financial_year: "2025", duration_years: 0, duration_months: 5 });
    expect(getMilestoneEffectiveDueDate(m, FY_START_MONTH)).toBe("2025-08-31");
  });

  it("returns null when neither target_date nor start_financial_year is set", () => {
    const m = makeMilestone();
    expect(getMilestoneEffectiveDueDate(m, FY_START_MONTH)).toBeNull();
  });
});

describe("getMilestoneMonthsRemaining — inclusive of the current month", () => {
  it("counts March-to-June as 4 months, not 3", () => {
    const m = makeMilestone({ target_date: "2026-06-30" });
    const today = new Date(2026, 2, 15); // 15 March 2026
    expect(getMilestoneMonthsRemaining(m, FY_START_MONTH, today)).toBe(4);
  });

  it("counts a due date within the current month as 1 month, not 0", () => {
    const m = makeMilestone({ target_date: "2026-03-31" });
    const today = new Date(2026, 2, 5); // 5 March 2026
    expect(getMilestoneMonthsRemaining(m, FY_START_MONTH, today)).toBe(1);
  });

  it("returns null once the due month has already passed", () => {
    const m = makeMilestone({ target_date: "2026-01-31" });
    const today = new Date(2026, 2, 5); // 5 March 2026
    expect(getMilestoneMonthsRemaining(m, FY_START_MONTH, today)).toBeNull();
  });
});

describe("getMilestoneMonthlyNeeded", () => {
  it("divides the remaining amount by the inclusive months-remaining count", () => {
    const m = makeMilestone({ target_amount: 40000, current_saved: 0, target_date: "2026-06-30" });
    const today = new Date(2026, 2, 15); // 15 March 2026 → 4 months inclusive
    expect(getMilestoneMonthlyNeeded(m, FY_START_MONTH, today)).toBe(10000);
  });

  it("returns null once the target is already met", () => {
    const m = makeMilestone({ target_amount: 40000, current_saved: 40000, target_date: "2026-06-30" });
    expect(getMilestoneMonthlyNeeded(m, FY_START_MONTH, new Date(2026, 2, 15))).toBeNull();
  });
});

describe("compareMilestonesByDueDate", () => {
  it("sorts dated milestones soonest-first", () => {
    const soon = makeMilestone({ id: "soon", target_date: "2026-04-30" });
    const later = makeMilestone({ id: "later", target_date: "2027-01-31" });
    const sorted = [later, soon].sort((a, b) => compareMilestonesByDueDate(a, b, FY_START_MONTH));
    expect(sorted.map((m) => m.id)).toEqual(["soon", "later"]);
  });

  it("places undated milestones after every dated one, preserving their sort_order", () => {
    const dated = makeMilestone({ id: "dated", target_date: "2027-01-31", sort_order: 5 });
    const undatedA = makeMilestone({ id: "undatedA", sort_order: 1 });
    const undatedB = makeMilestone({ id: "undatedB", sort_order: 0 });
    const sorted = [undatedA, dated, undatedB].sort((a, b) => compareMilestonesByDueDate(a, b, FY_START_MONTH));
    expect(sorted.map((m) => m.id)).toEqual(["dated", "undatedB", "undatedA"]);
  });

  it("prefers a milestone's FY+duration end month over an undated one when comparing", () => {
    const fyBased = makeMilestone({ id: "fy", start_financial_year: "2025", duration_months: 5 }); // ends Aug 2025
    const undated = makeMilestone({ id: "undated", sort_order: 0 });
    const sorted = [undated, fyBased].sort((a, b) => compareMilestonesByDueDate(a, b, FY_START_MONTH));
    expect(sorted.map((m) => m.id)).toEqual(["fy", "undated"]);
  });
});
