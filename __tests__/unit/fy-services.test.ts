/**
 * Financial year decoupled service tests.
 * Tests getMilestoneContributionForFY, getMilestonesForFY, getBucketsByFY,
 * getSalaryProfileByFY, and deriveYearlyPlan.
 */

let executedRuns: { sql: string; params: unknown[] }[] = [];

const mockGetAllAsync = jest.fn(async (): Promise<unknown[]> => []);
const mockGetFirstAsync = jest.fn(async (): Promise<unknown> => null);

const mockDb = {
  getAllAsync: mockGetAllAsync,
  getFirstAsync: mockGetFirstAsync,
  runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    executedRuns.push({ sql, params });
    return { changes: 1, lastInsertRowId: 1 };
  }),
};

jest.mock("../../database", () => ({
  getDatabase: () => mockDb,
}));

jest.mock("../../utils/uuid", () => ({
  generateUUID: () => "test-uuid",
}));

import {
  getMilestoneContributionForFY,
  getMilestonesForFY,
} from "../../services/life-milestone";
import type { LifeMilestone } from "../../services/life-milestone";
import { getBucketsByFY } from "../../services/yearly-plan";
import { getSalaryProfileByFY } from "../../services/salary-profile";

beforeEach(() => {
  executedRuns = [];
  jest.clearAllMocks();
  mockGetAllAsync.mockResolvedValue([]);
  mockGetFirstAsync.mockResolvedValue(null);
});

const makeMilestone = (overrides: Partial<LifeMilestone> = {}): LifeMilestone => ({
  id: "ms-1",
  user_id: "user-1",
  name: "Buy Car",
  target_amount: 1000000,
  current_saved: 0,
  target_date: null,
  is_completed: 0,
  completed_date: null,
  monthly_contribution_planned: 0,
  sort_order: 0,
  start_financial_year: "2026",
  duration_years: 1,
  duration_months: 0,
  ...overrides,
});

// ─── getMilestoneContributionForFY ─────────────────────────────

describe("getMilestoneContributionForFY", () => {
  it("returns full amount for 1-year milestone in its start FY", () => {
    const ms = makeMilestone({ target_amount: 1000000, duration_years: 1, start_financial_year: "2026" });
    const contribution = getMilestoneContributionForFY(ms, "2026");
    expect(contribution).toBe(1000000);
  });

  it("returns 1/3 for a 3-year milestone per year", () => {
    const ms = makeMilestone({ target_amount: 1000000, duration_years: 3, start_financial_year: "2026" });

    expect(getMilestoneContributionForFY(ms, "2026")).toBeCloseTo(333333.33, 0);
    expect(getMilestoneContributionForFY(ms, "2027")).toBeCloseTo(333333.33, 0);
    expect(getMilestoneContributionForFY(ms, "2028")).toBeCloseTo(333333.33, 0);
  });

  it("returns 0 for FY before milestone start", () => {
    const ms = makeMilestone({ start_financial_year: "2027", duration_years: 2 });
    expect(getMilestoneContributionForFY(ms, "2026")).toBe(0);
  });

  it("returns 0 for FY after milestone end", () => {
    const ms = makeMilestone({ start_financial_year: "2026", duration_years: 2 });
    expect(getMilestoneContributionForFY(ms, "2028")).toBe(0);
  });

  it("returns 0 for completed milestones", () => {
    const ms = makeMilestone({ is_completed: 1, start_financial_year: "2026" });
    expect(getMilestoneContributionForFY(ms, "2026")).toBe(0);
  });

  it("treats legacy milestones (no start FY) as active everywhere", () => {
    const ms = makeMilestone({
      start_financial_year: null,
      duration_years: 1,
      target_amount: 500000,
    });
    expect(getMilestoneContributionForFY(ms, "2026")).toBe(500000);
    expect(getMilestoneContributionForFY(ms, "2030")).toBe(500000);
  });

  it("handles duration_years default (1) when null/undefined", () => {
    const ms = makeMilestone({
      target_amount: 600000,
      start_financial_year: "2026",
      duration_years: 0, // falsy
    });
    // duration_years || 1 → 1
    expect(getMilestoneContributionForFY(ms, "2026")).toBe(600000);
  });
});

// ─── getMilestonesForFY ────────────────────────────────────────

describe("getMilestonesForFY", () => {
  it("queries user milestones and filters by FY range", async () => {
    const msInRange = makeMilestone({ id: "ms-1", start_financial_year: "2026", duration_years: 2 });
    const msOutOfRange = makeMilestone({ id: "ms-2", start_financial_year: "2024", duration_years: 1 });
    const msLegacy = makeMilestone({ id: "ms-3", start_financial_year: null });

    mockGetAllAsync.mockResolvedValue([msInRange, msOutOfRange, msLegacy]);

    const result = await getMilestonesForFY("user-1", "2026");

    // ms-1 (2026-2027 range, includes 2026) ✓
    // ms-2 (2024 only, 2026 out of range) ✗
    // ms-3 (legacy, always active) ✓
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(["ms-1", "ms-3"]);
  });

  it("excludes completed milestones (via DB query)", async () => {
    mockGetAllAsync.mockResolvedValue([]);

    await getMilestonesForFY("user-1", "2026");

    expect(mockGetAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("is_completed = 0"),
      "user-1",
    );
  });

  it("returns empty array when no active milestones", async () => {
    mockGetAllAsync.mockResolvedValue([]);

    const result = await getMilestonesForFY("user-1", "2026");
    expect(result).toHaveLength(0);
  });
});

// ─── getBucketsByFY ────────────────────────────────────────────

describe("getBucketsByFY", () => {
  it("queries active buckets by user and FY", async () => {
    await getBucketsByFY("user-1", "2026-27");

    expect(mockGetAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("user_id = ?"),
      "user-1",
      "2026-27",
    );
    expect(mockGetAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("financial_year = ?"),
      "user-1",
      "2026-27",
    );
    expect(mockGetAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("is_active = 1"),
      "user-1",
      "2026-27",
    );
  });

  it("returns empty array when no buckets for FY", async () => {
    mockGetAllAsync.mockResolvedValue([]);
    const result = await getBucketsByFY("user-1", "2026-27");
    expect(result).toHaveLength(0);
  });
});

// ─── getSalaryProfileByFY ──────────────────────────────────────

describe("getSalaryProfileByFY", () => {
  it("queries by user_id and financial_year", async () => {
    await getSalaryProfileByFY("user-1", "2026-27");

    expect(mockGetFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining("user_id = ?"),
      "user-1",
      "2026-27",
    );
    expect(mockGetFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining("financial_year = ?"),
      "user-1",
      "2026-27",
    );
  });

  it("returns null when no profile exists for FY", async () => {
    mockGetFirstAsync.mockResolvedValue(null);
    const result = await getSalaryProfileByFY("user-1", "2026-27");
    expect(result).toBeNull();
  });

  it("returns the profile when found", async () => {
    const mockProfile = {
      id: "profile-1",
      user_id: "user-1",
      financial_year: "2026-27",
      computed_monthly_in_hand: 150000,
      expected_bonus: 200000,
      expected_capital_gains: 50000,
    };
    mockGetFirstAsync.mockResolvedValue(mockProfile);

    const result = await getSalaryProfileByFY("user-1", "2026-27");
    expect(result).toEqual(mockProfile);
    expect(result!.computed_monthly_in_hand).toBe(150000);
  });
});
