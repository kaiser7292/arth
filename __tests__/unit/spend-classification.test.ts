/**
 * v15.2.1 — Shared spend-classification helper tests.
 *
 * This helper is the single source of truth for unavoidable / discretionary
 * / uncategorized percentages shown on both Monthly Summary and Spending
 * Split. The two screens previously diverged because they ran different
 * SQL; these tests lock down the new unified behaviour.
 */

type SqlMock = jest.Mock<Promise<unknown>>;

let firstAsync: SqlMock = jest.fn();

const mockDb = {
  getFirstAsync: (sql: string, ...params: unknown[]) => firstAsync(sql, ...params),
  getAllAsync: jest.fn(),
  runAsync: jest.fn(),
};

jest.mock("../../database", () => ({
  getDatabase: () => mockDb,
}));

jest.mock("../../services/expense-effective-amount", () => ({
  effectiveAmountSql: (_tbl: string) => "amount",
}));

import {
  getSpendClassificationTotals,
  __test__,
} from "../../services/spend-classification";

beforeEach(() => {
  firstAsync = jest.fn();
});

describe("getSpendClassificationTotals", () => {
  it("bucketizes is_right_spend=1 → unavoidable, 0 → discretionary, NULL → uncategorized", async () => {
    firstAsync.mockResolvedValueOnce({
      unavoidable: 3000,
      discretionary: 2000,
      uncategorized: 1500,
    });
    const result = await getSpendClassificationTotals(
      "user-1",
      "2026-04-01",
      "2026-04-30",
    );
    expect(result.unavoidable).toBe(3000);
    expect(result.discretionary).toBe(2000);
    expect(result.uncategorized).toBe(1500);
    expect(result.total).toBe(6500);
  });

  it("returns zeros when the row is empty (no expenses in range)", async () => {
    firstAsync.mockResolvedValueOnce({
      unavoidable: 0,
      discretionary: 0,
      uncategorized: 0,
    });
    const result = await getSpendClassificationTotals(
      "user-1",
      "2026-04-01",
      "2026-04-30",
    );
    expect(result.total).toBe(0);
    expect(result.unavoidablePct).toBe(0);
    expect(result.discretionaryPct).toBe(0);
    expect(result.uncategorizedPct).toBe(0);
  });

  it("handles null row gracefully", async () => {
    firstAsync.mockResolvedValueOnce(null);
    const result = await getSpendClassificationTotals(
      "user-1",
      "2026-04-01",
      "2026-04-30",
    );
    expect(result.total).toBe(0);
  });

  it("percentages add to exactly 100 (drift absorbed by largest bucket)", async () => {
    firstAsync.mockResolvedValueOnce({
      unavoidable: 333,
      discretionary: 333,
      uncategorized: 334,
    });
    const result = await getSpendClassificationTotals(
      "user-1",
      "2026-04-01",
      "2026-04-30",
    );
    expect(result.unavoidablePct + result.discretionaryPct + result.uncategorizedPct).toBe(100);
  });

  it("sends the correct date params to the SQL layer", async () => {
    firstAsync.mockResolvedValueOnce({ unavoidable: 0, discretionary: 0, uncategorized: 0 });
    await getSpendClassificationTotals("user-xyz", "2026-04-01", "2026-04-30");
    expect(firstAsync).toHaveBeenCalled();
    const call = firstAsync.mock.calls[0];
    expect(call[1]).toBe("user-xyz");
    expect(call[2]).toBe("2026-04-01");
    expect(call[3]).toBe("2026-04-30");
  });
});

describe("computePcts (pure)", () => {
  const { computePcts } = __test__;

  it("returns all zeros when total is 0", () => {
    const p = computePcts(0, 0, 0, 0);
    expect(p).toEqual({ unavoidablePct: 0, discretionaryPct: 0, uncategorizedPct: 0 });
  });

  it("matches Monthly Summary behavior on the concrete bug scenario", () => {
    // 3000 unavoidable + 2000 discretionary + 1000 NULL-categorized
    // + 500 NULL-and-uncategorized-category = 6500 total.
    // Monthly Summary previously showed: 3000/6500 = 46%.
    // Spending Split previously showed: (3000+1000)/(3000+2000+1000) = 4000/6000 = 67%.
    // With the shared helper both screens see 46% for unavoidable.
    const p = computePcts(3000, 2000, 1500, 6500);
    expect(p.unavoidablePct).toBe(46);
  });

  it("adds to 100 even with fractional inputs", () => {
    const p = computePcts(1, 1, 1, 3);
    expect(p.unavoidablePct + p.discretionaryPct + p.uncategorizedPct).toBe(100);
  });
});
