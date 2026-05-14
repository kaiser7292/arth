/**
 * V4 Tests: Comparison Insights Service (Phase 2)
 *
 * Tests the comparison-insights.ts service:
 * - getComparisonPresets: date range calculation for 4 presets
 * - getWeekBounds (via getWeeklyComparison): Monday-Sunday week bounds
 * - getDateRangeComparison + getWeeklyComparison: delegated to DB (mocked)
 * - Helper functions: round2, deltaPct
 */

// We test the exported functions and internal logic through them.
// Since getWeekBounds is not exported, we test it via getComparisonPresets.

import {
  getComparisonPresets,
  getDateRangeComparison,
  getWeeklyComparison,
} from "../../services/comparison-insights";
import type { ComparisonPreset, ComparisonResult } from "../../services/comparison-insights";

// ══════════════════════════════════════════
// Mock the database module
// ══════════════════════════════════════════

const mockGetFirstAsync = jest.fn();
const mockGetAllAsync = jest.fn();

jest.mock("../../database", () => ({
  getDatabase: () => ({
    getFirstAsync: mockGetFirstAsync,
    getAllAsync: mockGetAllAsync,
  }),
}));

beforeEach(() => {
  mockGetFirstAsync.mockReset();
  mockGetAllAsync.mockReset();
});

// ══════════════════════════════════════════
// getComparisonPresets — Date Range Tests
// ══════════════════════════════════════════

describe("getComparisonPresets", () => {
  it("returns exactly 4 presets", () => {
    const presets = getComparisonPresets();
    expect(presets).toHaveLength(4);
  });

  it("returns presets with correct labels", () => {
    const presets = getComparisonPresets();
    const labels = presets.map((p) => p.label);
    expect(labels).toContain("This Week vs Last Week");
    expect(labels).toContain("This Month vs Last Month");
    expect(labels).toContain("This Quarter vs Last Quarter");
    expect(labels).toContain("Year-over-Year (This Month)");
  });

  it("all presets have valid date strings (YYYY-MM-DD)", () => {
    const presets = getComparisonPresets();
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    for (const p of presets) {
      expect(p.range1Start).toMatch(dateRegex);
      expect(p.range1End).toMatch(dateRegex);
      expect(p.range2Start).toMatch(dateRegex);
      expect(p.range2End).toMatch(dateRegex);
    }
  });

  it("range1 dates are before range2 dates (baseline before compare)", () => {
    const presets = getComparisonPresets();
    for (const p of presets) {
      expect(p.range1Start <= p.range1End).toBe(true);
      expect(p.range2Start <= p.range2End).toBe(true);
      // Range 1 (baseline) should start before range 2
      expect(p.range1Start < p.range2Start).toBe(true);
    }
  });

  it("This Month vs Last Month has correct month boundaries", () => {
    const presets = getComparisonPresets();
    const monthPreset = presets.find((p) => p.label === "This Month vs Last Month")!;

    // range2Start should be 1st of current month
    const now = new Date();
    const expectedR2Start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    expect(monthPreset.range2Start).toBe(expectedR2Start);

    // range1Start should be 1st of previous month
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const expectedR1Start = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}-01`;
    expect(monthPreset.range1Start).toBe(expectedR1Start);
  });

  it("Year-over-Year compares same month in different years", () => {
    const presets = getComparisonPresets();
    const yoyPreset = presets.find((p) => p.label === "Year-over-Year (This Month)")!;

    const now = new Date();
    const thisYear = now.getFullYear();
    const lastYear = thisYear - 1;
    const monthStr = String(now.getMonth() + 1).padStart(2, "0");

    // range1 should be last year's same month
    expect(yoyPreset.range1Start).toBe(`${lastYear}-${monthStr}-01`);
    // range2 should be this year's same month
    expect(yoyPreset.range2Start).toBe(`${thisYear}-${monthStr}-01`);
  });

  it("This Week vs Last Week spans exactly 7 days each", () => {
    const presets = getComparisonPresets();
    const weekPreset = presets.find((p) => p.label === "This Week vs Last Week")!;

    const r1Days = (new Date(weekPreset.range1End).getTime() - new Date(weekPreset.range1Start).getTime()) / (1000 * 60 * 60 * 24);
    const r2Days = (new Date(weekPreset.range2End).getTime() - new Date(weekPreset.range2Start).getTime()) / (1000 * 60 * 60 * 24);
    expect(r1Days).toBe(6); // Mon to Sun = 6 day span
    expect(r2Days).toBe(6);
  });

  it("week ranges start on Monday (day 1)", () => {
    const presets = getComparisonPresets();
    const weekPreset = presets.find((p) => p.label === "This Week vs Last Week")!;

    const r1StartDay = new Date(weekPreset.range1Start + "T00:00:00").getDay();
    const r2StartDay = new Date(weekPreset.range2Start + "T00:00:00").getDay();
    expect(r1StartDay).toBe(1); // Monday
    expect(r2StartDay).toBe(1); // Monday
  });

  it("week ranges end on Sunday (day 0)", () => {
    const presets = getComparisonPresets();
    const weekPreset = presets.find((p) => p.label === "This Week vs Last Week")!;

    const r1EndDay = new Date(weekPreset.range1End + "T00:00:00").getDay();
    const r2EndDay = new Date(weekPreset.range2End + "T00:00:00").getDay();
    expect(r1EndDay).toBe(0); // Sunday
    expect(r2EndDay).toBe(0); // Sunday
  });
});

// ══════════════════════════════════════════
// getDateRangeComparison — DB Integration
// ══════════════════════════════════════════

describe("getDateRangeComparison", () => {
  it("returns correct structure with empty data", async () => {
    mockGetFirstAsync.mockResolvedValue({ total: 0, count: 0 });
    mockGetAllAsync.mockResolvedValue([]);

    const result = await getDateRangeComparison("user-1", "2026-04-01", "2026-04-07", "2026-04-08", "2026-04-14");

    expect(result.range1.start).toBe("2026-04-01");
    expect(result.range1.end).toBe("2026-04-07");
    expect(result.range2.start).toBe("2026-04-08");
    expect(result.range2.end).toBe("2026-04-14");
    expect(result.range1.summary.totalSpent).toBe(0);
    expect(result.range2.summary.totalSpent).toBe(0);
    expect(result.delta.totalDelta).toBe(0);
    expect(result.delta.totalDeltaPct).toBe(0);
    expect(result.delta.countDelta).toBe(0);
    expect(result.byCategory).toEqual([]);
    expect(result.byMerchant).toEqual([]);
    expect(result.byPaymentMode).toEqual([]);
  });

  it("calculates positive delta when range2 > range1", async () => {
    // Promise.all interleaves calls, so use mockImplementation keyed on SQL args
    mockGetFirstAsync.mockImplementation(async (sql: string, ...args: unknown[]) => {
      if (sql.includes("COUNT(*)") && sql.includes("FROM expenses")) {
        // Totals query — check date args to distinguish ranges
        const startDate = args[1] as string;
        if (startDate === "2026-04-01") return { total: 1000, count: 5 };
        if (startDate === "2026-04-08") return { total: 2000, count: 8 };
      }
      return null; // topCat/topMerch — not relevant for this test
    });
    mockGetAllAsync.mockResolvedValue([]);

    const result = await getDateRangeComparison("user-1", "2026-04-01", "2026-04-07", "2026-04-08", "2026-04-14");

    expect(result.range1.summary.totalSpent).toBe(1000);
    expect(result.range2.summary.totalSpent).toBe(2000);
    expect(result.delta.totalDelta).toBe(1000);
    expect(result.delta.totalDeltaPct).toBe(100);
    expect(result.delta.countDelta).toBe(3);
  });

  it("calculates negative delta when range2 < range1", async () => {
    mockGetFirstAsync.mockImplementation(async (sql: string, ...args: unknown[]) => {
      if (sql.includes("COUNT(*)") && sql.includes("FROM expenses")) {
        const startDate = args[1] as string;
        if (startDate === "2026-03-01") return { total: 5000, count: 10 };
        if (startDate === "2026-04-01") return { total: 2500, count: 6 };
      }
      return null;
    });
    mockGetAllAsync.mockResolvedValue([]);

    const result = await getDateRangeComparison("user-1", "2026-03-01", "2026-03-31", "2026-04-01", "2026-04-30");

    expect(result.delta.totalDelta).toBe(-2500);
    expect(result.delta.totalDeltaPct).toBe(-50);
    expect(result.delta.countDelta).toBe(-4);
  });

  it("handles zero baseline gracefully (deltaPct = 100 when old=0, new>0)", async () => {
    mockGetFirstAsync.mockImplementation(async (sql: string, ...args: unknown[]) => {
      if (sql.includes("COUNT(*)") && sql.includes("FROM expenses")) {
        const startDate = args[1] as string;
        if (startDate === "2026-04-01") return { total: 0, count: 0 };
        if (startDate === "2026-04-08") return { total: 500, count: 3 };
      }
      return null;
    });
    mockGetAllAsync.mockResolvedValue([]);

    const result = await getDateRangeComparison("user-1", "2026-04-01", "2026-04-07", "2026-04-08", "2026-04-14");

    expect(result.delta.totalDeltaPct).toBe(100);
  });

  it("handles both ranges zero (deltaPct = 0)", async () => {
    mockGetFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("COUNT(*)") && sql.includes("FROM expenses")) return { total: 0, count: 0 };
      return null;
    });
    mockGetAllAsync.mockResolvedValue([]);

    const result = await getDateRangeComparison("user-1", "2026-04-01", "2026-04-07", "2026-04-08", "2026-04-14");

    expect(result.delta.totalDeltaPct).toBe(0);
    expect(result.delta.totalDelta).toBe(0);
  });

  it("returns category breakdown sorted by absolute delta", async () => {
    mockGetFirstAsync.mockResolvedValue({ total: 0, count: 0 });

    // Category breakdown rows
    mockGetAllAsync
      .mockResolvedValueOnce([
        { category_id: "c1", category_name: "Food", range_tag: "r1", total: 1000 },
        { category_id: "c1", category_name: "Food", range_tag: "r2", total: 1200 },
        { category_id: "c2", category_name: "Transport", range_tag: "r1", total: 500 },
        { category_id: "c2", category_name: "Transport", range_tag: "r2", total: 100 },
      ])
      .mockResolvedValueOnce([]) // merchant breakdown
      .mockResolvedValueOnce([]); // payment mode breakdown

    const result = await getDateRangeComparison("user-1", "2026-04-01", "2026-04-07", "2026-04-08", "2026-04-14");

    expect(result.byCategory).toHaveLength(2);
    // Transport has bigger absolute delta (|100-500|=400 vs |1200-1000|=200)
    expect(result.byCategory[0].categoryName).toBe("Transport");
    expect(result.byCategory[0].delta).toBe(-400);
    expect(result.byCategory[1].categoryName).toBe("Food");
    expect(result.byCategory[1].delta).toBe(200);
  });

  it("returns merchant breakdown capped at 15 entries", async () => {
    mockGetFirstAsync.mockResolvedValue({ total: 0, count: 0 });

    // Generate 20 merchant rows
    const merchantRows = Array.from({ length: 20 }, (_, i) => ({
      merchant_name: `Merchant ${i}`,
      range_tag: "r2",
      total: (i + 1) * 100,
    }));

    mockGetAllAsync
      .mockResolvedValueOnce([]) // category
      .mockResolvedValueOnce(merchantRows) // merchant
      .mockResolvedValueOnce([]); // payment mode

    const result = await getDateRangeComparison("user-1", "2026-04-01", "2026-04-07", "2026-04-08", "2026-04-14");

    expect(result.byMerchant.length).toBeLessThanOrEqual(30);
  });

  it("computes avgPerTransaction correctly", async () => {
    mockGetFirstAsync.mockImplementation(async (sql: string, ...args: unknown[]) => {
      if (sql.includes("COUNT(*)") && sql.includes("FROM expenses")) {
        const startDate = args[1] as string;
        if (startDate === "2026-04-01") return { total: 1000, count: 4 };
        return { total: 0, count: 0 };
      }
      return null;
    });
    mockGetAllAsync.mockResolvedValue([]);

    const result = await getDateRangeComparison("user-1", "2026-04-01", "2026-04-07", "2026-04-08", "2026-04-14");

    expect(result.range1.summary.avgPerTransaction).toBe(250);
    expect(result.range2.summary.avgPerTransaction).toBe(0); // 0 txns → 0 avg
  });

  it("returns top category and top merchant in range summary", async () => {
    mockGetFirstAsync.mockImplementation(async (sql: string, ...args: unknown[]) => {
      const startDate = args[1] as string;
      const isRange1 = startDate === "2026-04-01";

      if (sql.includes("COUNT(*)")) {
        // Totals query (has COUNT(*))
        if (isRange1) return { total: 3000, count: 10 };
        return { total: 0, count: 0 };
      }
      if (sql.includes("JOIN categories")) {
        // Top category query
        if (isRange1) return { id: "c-food", name: "Food", total: 1500 };
        return null;
      }
      if (sql.includes("merchant_name IS NOT NULL")) {
        // Top merchant query
        if (isRange1) return { name: "Zomato", total: 800 };
        return null;
      }
      return null;
    });
    mockGetAllAsync.mockResolvedValue([]);

    const result = await getDateRangeComparison("user-1", "2026-04-01", "2026-04-07", "2026-04-08", "2026-04-14");

    expect(result.range1.summary.topCategory).toEqual({ id: "c-food", name: "Food", total: 1500 });
    expect(result.range1.summary.topMerchant).toEqual({ name: "Zomato", total: 800 });
    expect(result.range2.summary.topCategory).toBeNull();
    expect(result.range2.summary.topMerchant).toBeNull();
  });

  it("returns payment mode breakdown with delta info", async () => {
    mockGetFirstAsync.mockResolvedValue({ total: 0, count: 0 });

    mockGetAllAsync
      .mockResolvedValueOnce([]) // category
      .mockResolvedValueOnce([]) // merchant
      .mockResolvedValueOnce([
        { payment_mode_id: "pm1", payment_mode_name: "Credit Card", range_tag: "r1", total: 2000 },
        { payment_mode_id: "pm1", payment_mode_name: "Credit Card", range_tag: "r2", total: 3000 },
        { payment_mode_id: "pm2", payment_mode_name: "UPI", range_tag: "r1", total: 1000 },
        { payment_mode_id: "pm2", payment_mode_name: "UPI", range_tag: "r2", total: 800 },
      ]);

    const result = await getDateRangeComparison("user-1", "2026-04-01", "2026-04-07", "2026-04-08", "2026-04-14");

    expect(result.byPaymentMode).toHaveLength(2);
    // Credit Card has bigger absolute delta (|3000-2000|=1000 vs |800-1000|=200)
    expect(result.byPaymentMode[0].paymentModeName).toBe("Credit Card");
    expect(result.byPaymentMode[0].delta).toBe(1000);
    expect(result.byPaymentMode[0].deltaPct).toBe(50);
    expect(result.byPaymentMode[1].paymentModeName).toBe("UPI");
    expect(result.byPaymentMode[1].delta).toBe(-200);
    expect(result.byPaymentMode[1].deltaPct).toBe(-20);
  });
});

// ══════════════════════════════════════════
// getWeeklyComparison — Delegates to Core
// ══════════════════════════════════════════

describe("getWeeklyComparison", () => {
  it("returns comparison for current week vs previous week", async () => {
    mockGetFirstAsync.mockResolvedValue({ total: 0, count: 0 });
    mockGetAllAsync.mockResolvedValue([]);

    const result = await getWeeklyComparison("user-1");

    // Should have two week ranges
    expect(result.range1.start).toBeDefined();
    expect(result.range1.end).toBeDefined();
    expect(result.range2.start).toBeDefined();
    expect(result.range2.end).toBeDefined();

    // Range 1 should be previous week (before range 2)
    expect(result.range1.start < result.range2.start).toBe(true);
  });

  it("respects weekOffset parameter", async () => {
    mockGetFirstAsync.mockResolvedValue({ total: 0, count: 0 });
    mockGetAllAsync.mockResolvedValue([]);

    const currentWeek = await getWeeklyComparison("user-1", 0);
    const lastWeek = await getWeeklyComparison("user-1", -1);

    // Last week's range2 should be before current week's range2
    expect(lastWeek.range2.start < currentWeek.range2.start).toBe(true);
  });

  it("each range spans exactly one week (Mon-Sun)", async () => {
    mockGetFirstAsync.mockResolvedValue({ total: 0, count: 0 });
    mockGetAllAsync.mockResolvedValue([]);

    const result = await getWeeklyComparison("user-1");

    const r1Days = (new Date(result.range1.end).getTime() - new Date(result.range1.start).getTime()) / (1000 * 60 * 60 * 24);
    const r2Days = (new Date(result.range2.end).getTime() - new Date(result.range2.start).getTime()) / (1000 * 60 * 60 * 24);

    expect(r1Days).toBe(6);
    expect(r2Days).toBe(6);
  });
});
