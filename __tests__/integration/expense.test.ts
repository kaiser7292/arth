/**
 * Expense service tests.
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
};

jest.mock("../../database", () => ({
  getDatabase: () => mockDb,
}));

let mockUuidCounter = 0;
jest.mock("../../utils/uuid", () => ({
  generateUUID: () => `test-exp-uuid-${++mockUuidCounter}`,
}));

import {
  getExpenses,
  getExpensesPaginated,
  getExpenseById,
  createExpense,
  updateExpense,
  deleteExpense,
  getExpenseTotal,
  getCategoryMonthlyTrend,
  getRightSpendTotal,
  getTopCategoriesBySpending,
  getExpenseCount,
  getPendingExpensesForReview,
  getPendingExpenseCount,
  approveExpense,
  rejectExpense,
} from "../../services/expense";

beforeEach(() => {
  executedRuns = [];
  mockRows = {};
  mockUuidCounter = 0;
  jest.clearAllMocks();
});

describe("getExpenses", () => {
  it("queries expenses for a user ordered by date descending", async () => {
    await getExpenses("user-1");
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE user_id = ?"),
      "user-1",
    );
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY date DESC"),
      "user-1",
    );
  });

  it("filters by date range when provided", async () => {
    await getExpenses("user-1", "2026-01-01", "2026-01-31");
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("date >= ?"),
      "user-1",
      "2026-01-01",
      "2026-01-31",
    );
  });

  it("excludes rejected expenses", async () => {
    await getExpenses("user-1");
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("status != 'rejected'"),
      "user-1",
    );
  });
});

describe("getExpenseById", () => {
  it("queries by ID", async () => {
    await getExpenseById("exp-1");
    expect(mockDb.getFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = ?"),
      "exp-1",
    );
  });
});

describe("createExpense", () => {
  it("inserts with generated UUID and defaults", async () => {
    const id = await createExpense({
      user_id: "user-1",
      amount: 500,
      description: "Lunch",
      category_id: "cat-1",
      payment_mode_id: "pm-1",
      date: "2026-04-12",
      is_right_spend: 1,
    });

    expect(id).toBe("test-exp-uuid-1");
    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO expenses"));
    expect(insert).toBeDefined();
    expect(insert!.params).toEqual([
      "test-exp-uuid-1",
      "user-1",
      500,
      "INR",
      "Lunch",
      null, // merchant_name
      "cat-1",
      "pm-1",
      null, // account_id (not provided)
      "2026-04-12",
      "00:00:00", // transaction_time default
      "realized", // nature default
      1, // is_right_spend
      null, // refund_of_expense_id
      null, // purchase_group_id
      null, // due_date
      null, // v15.2: applied_rule_id (smart-rules returned null in mock DB)
    ]);
  });

  it("uses default currency INR when not specified", async () => {
    await createExpense({
      user_id: "user-1",
      amount: 100,
      date: "2026-04-12",
    });

    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO expenses"));
    expect(insert!.params[3]).toBe("INR");
  });

  it("sets null for optional fields when not provided", async () => {
    await createExpense({
      user_id: "user-1",
      amount: 100,
      date: "2026-04-12",
    });

    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO expenses"));
    // description, merchant_name, category_id, payment_mode_id, is_right_spend should be null
    expect(insert!.params[4]).toBeNull(); // description
    expect(insert!.params[5]).toBeNull(); // merchant_name
    expect(insert!.params[6]).toBeNull(); // category_id
    expect(insert!.params[7]).toBeNull(); // payment_mode_id
    expect(insert!.params[8]).toBeNull(); // account_id
    expect(insert!.params[9]).toBe("2026-04-12"); // date
    expect(insert!.params[10]).toBe("00:00:00"); // transaction_time
    expect(insert!.params[11]).toBe("realized"); // nature
    expect(insert!.params[12]).toBeNull(); // is_right_spend
    expect(insert!.params[13]).toBeNull(); // refund_of_expense_id
    expect(insert!.params[14]).toBeNull(); // purchase_group_id
    expect(insert!.params[15]).toBeNull(); // due_date
  });

  it("sets source as manual and status as approved", async () => {
    await createExpense({
      user_id: "user-1",
      amount: 100,
      date: "2026-04-12",
    });

    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO expenses"));
    expect(insert!.sql).toContain("'manual'");
    expect(insert!.sql).toContain("'approved'");
  });
});

describe("updateExpense", () => {
  it("updates only provided fields", async () => {
    await updateExpense("exp-1", { amount: 750, description: "Dinner" });

    const update = executedRuns.find((r) => r.sql.includes("UPDATE expenses"));
    expect(update!.sql).toContain("amount = ?");
    expect(update!.sql).toContain("description = ?");
    expect(update!.sql).not.toContain("category_id = ?");
    expect(update!.params).toEqual([750, "Dinner", "exp-1"]);
  });

  it("includes updated_at timestamp", async () => {
    await updateExpense("exp-1", { amount: 100 });

    const update = executedRuns.find((r) => r.sql.includes("UPDATE expenses"));
    expect(update!.sql).toContain("updated_at = datetime('now')");
  });

  it("does nothing when no fields provided", async () => {
    await updateExpense("exp-1", {});
    expect(executedRuns.length).toBe(0);
  });

  it("can set optional fields to null", async () => {
    await updateExpense("exp-1", {
      category_id: null,
      payment_mode_id: null,
      is_right_spend: null,
    });

    const update = executedRuns.find((r) => r.sql.includes("UPDATE expenses"));
    expect(update!.params).toEqual([null, null, null, "exp-1"]);
  });
});

describe("deleteExpense", () => {
  it("soft-deletes the expense by setting deleted_at", async () => {
    await deleteExpense("exp-1");

    const del = executedRuns.find((r) => r.sql.includes("UPDATE expenses SET deleted_at"));
    expect(del).toBeDefined();
    expect(del!.params).toEqual(["exp-1"]);
  });
});

describe("getExpensesPaginated", () => {
  it("applies LIMIT and OFFSET", async () => {
    await getExpensesPaginated("user-1", {}, 50, 0);
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT ? OFFSET ?"),
      "user-1",
      "realized",
      50,
      0,
    );
  });

  it("filters by category when provided", async () => {
    await getExpensesPaginated("user-1", { categoryIds: ["cat-1"] });
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("category_id IN"),
      "user-1",
      "realized",
      "cat-1",
      50,
      0,
    );
  });

  it("filters by payment mode when provided", async () => {
    await getExpensesPaginated("user-1", { paymentModeIds: ["pm-1"] });
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("payment_mode_id IN"),
      "user-1",
      "realized",
      "pm-1",
      50,
      0,
    );
  });

  it("searches by description and merchant_name with LIKE", async () => {
    await getExpensesPaginated("user-1", { search: "lunch" });
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("description LIKE ?"),
      "user-1",
      "realized",
      "%lunch%",
      "%lunch%",
      50,
      0,
    );
  });

  it("combines multiple filters", async () => {
    await getExpensesPaginated("user-1", {
      startDate: "2026-04-01",
      endDate: "2026-04-30",
      categoryIds: ["cat-1"],
      search: "food",
    });
    const call = mockDb.getAllAsync.mock.calls[0];
    const sql = call[0] as string;
    expect(sql).toContain("date >= ?");
    expect(sql).toContain("date <= ?");
    expect(sql).toContain("category_id IN");
    expect(sql).toContain("description LIKE ?");
    expect(sql).toContain("merchant_name LIKE ?");
    // params: userId, nature, startDate, endDate, categoryIds, search (x2), limit, offset
    expect(call.slice(1)).toEqual([
      "user-1",
      "realized",
      "2026-04-01",
      "2026-04-30",
      "cat-1",
      "%food%",
      "%food%",
      50,
      0,
    ]);
  });

  it("uses default limit of 50 and offset of 0", async () => {
    await getExpensesPaginated("user-1");
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT ? OFFSET ?"),
      "user-1",
      "realized",
      50,
      0,
    );
  });

  it("uses custom limit and offset", async () => {
    await getExpensesPaginated("user-1", {}, 25, 100);
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT ? OFFSET ?"),
      "user-1",
      "realized",
      25,
      100,
    );
  });
});

describe("getExpenseTotal", () => {
  it("sums approved expenses in date range", async () => {
    // Capture whatever SQL getExpenseTotal ships so the mock matches the
    // current effective-amount query text exactly (subquery + MAX wrapper).
    mockDb.getFirstAsync.mockImplementationOnce(async (sql: string) => {
      expect(sql).toContain("SUM(");
      expect(sql).toContain("refund_of_expense_id");
      return { total: 15000 };
    });

    const total = await getExpenseTotal("user-1", "2026-04-01", "2026-04-30");
    expect(total).toBe(15000);
  });

  it("returns 0 when no expenses found", async () => {
    const total = await getExpenseTotal("user-1", "2026-04-01", "2026-04-30");
    expect(total).toBe(0);
  });
});

describe("getCategoryMonthlyTrend", () => {
  it("queries 6 months of data with a single GROUP BY query", async () => {
    mockDb.getAllAsync.mockResolvedValue([]);

    const result = await getCategoryMonthlyTrend("user-1", "cat-1");

    expect(result).toHaveLength(6);
    // Single query instead of 6 separate ones (N+1 fix)
    expect(mockDb.getAllAsync).toHaveBeenCalledTimes(1);
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("GROUP BY"),
      "user-1",
      "cat-1",
      expect.any(String),
      expect.any(String),
    );
  });

  it("queries custom number of months", async () => {
    mockDb.getAllAsync.mockResolvedValue([]);

    const result = await getCategoryMonthlyTrend("user-1", "cat-1", 3);

    expect(result).toHaveLength(3);
    expect(mockDb.getAllAsync).toHaveBeenCalledTimes(1);
  });

  it("returns months sorted oldest to newest", async () => {
    mockDb.getAllAsync.mockResolvedValue([]);

    const result = await getCategoryMonthlyTrend("user-1", "cat-1", 3);

    // Each month string should be before the next
    for (let i = 1; i < result.length; i++) {
      expect(result[i].month > result[i - 1].month).toBe(true);
    }
  });

  it("returns 0 for months with no spending", async () => {
    mockDb.getAllAsync.mockResolvedValue([]);

    const result = await getCategoryMonthlyTrend("user-1", "cat-1", 2);

    expect(result[0].total).toBe(0);
    expect(result[1].total).toBe(0);
  });

  it("passes correct parameters to SQL query", async () => {
    mockDb.getAllAsync.mockResolvedValue([]);

    await getCategoryMonthlyTrend("user-1", "cat-food", 1);

    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("category_id = ?"),
      "user-1",
      "cat-food",
      expect.stringMatching(/^\d{4}-\d{2}-01$/),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it("each month entry has correct format", async () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    mockDb.getAllAsync.mockResolvedValue([{ month, total: 750 }]);

    const result = await getCategoryMonthlyTrend("user-1", "cat-1", 2);

    for (const entry of result) {
      expect(entry.month).toMatch(/^\d{4}-\d{2}$/);
      expect(typeof entry.total).toBe("number");
    }
  });
});

describe("getRightSpendTotal", () => {
  it("sums only right-spend expenses in date range", async () => {
    mockDb.getFirstAsync.mockResolvedValue({ total: 5000 });

    const total = await getRightSpendTotal("user-1", "2026-04-01", "2026-04-30");
    expect(total).toBe(5000);
    expect(mockDb.getFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining("is_right_spend = 1"),
      "user-1",
      "2026-04-01",
      "2026-04-30",
    );
  });

  it("returns 0 when no right-spend expenses exist", async () => {
    mockDb.getFirstAsync.mockResolvedValue(null);
    const total = await getRightSpendTotal("user-1", "2026-04-01", "2026-04-30");
    expect(total).toBe(0);
  });
});

describe("getTopCategoriesBySpending", () => {
  it("queries top 5 categories by default", async () => {
    mockDb.getAllAsync.mockResolvedValue([
      { category_id: "cat-1", total: 5000 },
      { category_id: "cat-2", total: 3000 },
    ]);

    const result = await getTopCategoriesBySpending("user-1", "2026-04-01", "2026-04-30");
    expect(result).toHaveLength(2);
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY total DESC"),
      "user-1",
      "2026-04-01",
      "2026-04-30",
      5,
    );
  });

  it("accepts custom limit", async () => {
    mockDb.getAllAsync.mockResolvedValue([]);
    await getTopCategoriesBySpending("user-1", "2026-04-01", "2026-04-30", 3);
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT ?"),
      "user-1",
      "2026-04-01",
      "2026-04-30",
      3,
    );
  });
});

describe("getExpenseCount", () => {
  it("returns count of approved expenses in date range", async () => {
    mockDb.getFirstAsync.mockResolvedValue({ count: 42 });

    const count = await getExpenseCount("user-1", "2026-04-01", "2026-04-30");
    expect(count).toBe(42);
    expect(mockDb.getFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining("COUNT(*)"),
      "user-1",
      "2026-04-01",
      "2026-04-30",
    );
  });

  it("returns 0 when no expenses found", async () => {
    mockDb.getFirstAsync.mockResolvedValue(null);
    const count = await getExpenseCount("user-1", "2026-04-01", "2026-04-30");
    expect(count).toBe(0);
  });
});

describe("Review Queue: getPendingExpensesForReview", () => {
  it("queries pending_review items ordered by created_at DESC", async () => {
    mockDb.getAllAsync.mockResolvedValue([
      { id: "exp-1", status: "pending_review", nature: "realized" },
      { id: "exp-2", status: "pending_review", nature: "forecast" },
    ]);

    const result = await getPendingExpensesForReview("user-1");
    expect(result).toHaveLength(2);
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("status = 'pending_review'"),
      "user-1",
    );
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY created_at DESC"),
      "user-1",
    );
  });

  it("returns empty array when no pending items", async () => {
    mockDb.getAllAsync.mockResolvedValue([]);
    const result = await getPendingExpensesForReview("user-1");
    expect(result).toHaveLength(0);
  });
});

describe("Review Queue: getPendingExpenseCount", () => {
  it("returns count of pending review items", async () => {
    mockDb.getFirstAsync.mockResolvedValue({ count: 7 });
    const count = await getPendingExpenseCount("user-1");
    expect(count).toBe(7);
    expect(mockDb.getFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining("COUNT(*)"),
      "user-1",
    );
  });

  it("returns 0 when no pending items", async () => {
    mockDb.getFirstAsync.mockResolvedValue(null);
    const count = await getPendingExpenseCount("user-1");
    expect(count).toBe(0);
  });
});

describe("Review Queue: approveExpense", () => {
  it("updates status to approved", async () => {
    // approveExpense reads the row first (to check nature/source for credit account resolution)
    mockDb.getFirstAsync.mockResolvedValueOnce({
      user_id: "user-1",
      nature: "realized",
      account_id: "acc-1",
      raw_source_text: null,
      source: "manual",
    });
    await approveExpense("exp-123");
    expect(mockDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("status = 'approved'"),
      "exp-123",
    );
  });
});

describe("Review Queue: rejectExpense", () => {
  it("updates status to rejected", async () => {
    await rejectExpense("exp-456");
    expect(mockDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("status = 'rejected'"),
      "exp-456",
    );
  });
});
