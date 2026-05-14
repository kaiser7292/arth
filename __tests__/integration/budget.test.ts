/**
 * Budget service tests.
 */

let executedRuns: { sql: string; params: unknown[] }[] = [];
let mockRows: Record<string, unknown[]> = {};

const mockDb = {
  getAllAsync: jest.fn(async (sql: string) => mockRows[sql] ?? []),
  getFirstAsync: jest.fn(async (sql: string) => {
    const rows = mockRows[sql] ?? [];
    return rows[0] ?? null;
  }),
  runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    executedRuns.push({ sql, params });
    return { changes: 1, lastInsertRowId: 1 };
  }),
  withTransactionAsync: jest.fn(async (cb: () => Promise<void>) => cb()),
};

jest.mock("../../database", () => ({
  getDatabase: () => mockDb,
}));

let mockUuidCounter = 0;
jest.mock("../../utils/uuid", () => ({
  generateUUID: () => `test-budget-uuid-${++mockUuidCounter}`,
}));

import {
  getBudgetsForMonth,
  getBudget,
  getBudgetById,
  upsertBudget,
  updateBudget,
  deleteBudget,
  getBreakdowns,
  addBreakdown,
  deleteBreakdown,
  getCurrentMonth,
} from "../../services/budget";

beforeEach(() => {
  executedRuns = [];
  mockRows = {};
  mockUuidCounter = 0;
  jest.clearAllMocks();
});

describe("getBudgetsForMonth", () => {
  it("queries budgets for a user and month", async () => {
    await getBudgetsForMonth("user-1", "2026-04");
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE b.user_id = ? AND b.month = ?"),
      "user-1",
      "2026-04",
    );
  });
});

describe("getBudget", () => {
  it("queries by user, category, and month", async () => {
    await getBudget("user-1", "cat-1", "2026-04");
    expect(mockDb.getFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE user_id = ? AND category_id = ? AND month = ?"),
      "user-1",
      "cat-1",
      "2026-04",
    );
  });
});

describe("getBudgetById", () => {
  it("queries by ID", async () => {
    await getBudgetById("budget-1");
    expect(mockDb.getFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = ?"),
      "budget-1",
    );
  });
});

describe("upsertBudget", () => {
  it("inserts new budget when none exists", async () => {
    const id = await upsertBudget({
      user_id: "user-1",
      category_id: "cat-1",
      month: "2026-04",
      amount: 10000,
    });

    expect(id).toBe("test-budget-uuid-1");
    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO budgets"));
    expect(insert).toBeDefined();
    expect(insert!.params).toEqual([
      "test-budget-uuid-1",
      "user-1",
      "cat-1",
      "2026-04",
      10000,
      null,
    ]);
  });

  it("updates existing budget when one exists", async () => {
    // Mock an existing budget
    mockDb.getFirstAsync.mockResolvedValueOnce({
      id: "existing-budget",
      user_id: "user-1",
      category_id: "cat-1",
      month: "2026-04",
      amount: 5000,
      notes: null,
    });

    const id = await upsertBudget({
      user_id: "user-1",
      category_id: "cat-1",
      month: "2026-04",
      amount: 10000,
      notes: "Updated",
    });

    expect(id).toBe("existing-budget");
    const update = executedRuns.find((r) => r.sql.includes("UPDATE budgets SET amount"));
    expect(update).toBeDefined();
    expect(update!.params).toEqual([10000, "Updated", "existing-budget"]);
  });
});

describe("updateBudget", () => {
  it("updates only provided fields", async () => {
    await updateBudget("budget-1", { amount: 15000 });

    const update = executedRuns.find((r) => r.sql.includes("UPDATE budgets"));
    expect(update!.sql).toContain("amount = ?");
    expect(update!.sql).not.toContain("notes = ?");
    expect(update!.params).toEqual([15000, "budget-1"]);
  });

  it("does nothing when no fields provided", async () => {
    await updateBudget("budget-1", {});
    expect(executedRuns.length).toBe(0);
  });
});

describe("deleteBudget", () => {
  it("deletes breakdowns first, then the budget", async () => {
    await deleteBudget("budget-1");

    expect(executedRuns.length).toBe(2);
    expect(executedRuns[0].sql).toContain("DELETE FROM budget_breakdowns");
    expect(executedRuns[0].params).toEqual(["budget-1"]);
    expect(executedRuns[1].sql).toContain("DELETE FROM budgets");
    expect(executedRuns[1].params).toEqual(["budget-1"]);
  });
});

describe("getBreakdowns", () => {
  it("queries breakdowns for a budget", async () => {
    await getBreakdowns("budget-1");
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE budget_id = ?"),
      "budget-1",
    );
  });
});

describe("addBreakdown", () => {
  it("inserts a breakdown line", async () => {
    const id = await addBreakdown({
      budget_id: "budget-1",
      line_item: "Petrol",
      formula: "697.5 km / 10 * Rs 110",
      amount: 7673,
    });

    expect(id).toBe("test-budget-uuid-1");
    const insert = executedRuns.find((r) =>
      r.sql.includes("INSERT INTO budget_breakdowns"),
    );
    expect(insert!.params).toEqual([
      "test-budget-uuid-1",
      "budget-1",
      "Petrol",
      "697.5 km / 10 * Rs 110",
      7673,
    ]);
  });

  it("sets formula to null when not provided", async () => {
    await addBreakdown({
      budget_id: "budget-1",
      line_item: "Misc",
      amount: 500,
    });

    const insert = executedRuns.find((r) =>
      r.sql.includes("INSERT INTO budget_breakdowns"),
    );
    expect(insert!.params[3]).toBeNull();
  });
});

describe("deleteBreakdown", () => {
  it("deletes a breakdown line", async () => {
    await deleteBreakdown("bd-1");
    const del = executedRuns.find((r) =>
      r.sql.includes("DELETE FROM budget_breakdowns WHERE id"),
    );
    expect(del!.params).toEqual(["bd-1"]);
  });
});


describe("getCurrentMonth", () => {
  it("returns current month in YYYY-MM format", () => {
    const result = getCurrentMonth();
    expect(result).toMatch(/^\d{4}-\d{2}$/);
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    expect(result).toBe(expected);
  });
});
