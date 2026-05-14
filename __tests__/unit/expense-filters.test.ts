/**
 * Tests for expense filter query building.
 *
 * Validates that multi-select filters (categoryIds, paymentModeIds,
 * accountIds, tagIds) generate correct SQL IN clauses.
 * Uses a mock DB to inspect generated SQL without running actual queries.
 */

let capturedSql: string[] = [];
let capturedParams: unknown[][] = [];

const mockDb = {
  getAllAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    capturedSql.push(sql);
    capturedParams.push(params.flat());
    return [];
  }),
  getFirstAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    capturedSql.push(sql);
    capturedParams.push(params.flat());
    return { total: 0 };
  }),
  runAsync: jest.fn(async () => ({ changes: 0, lastInsertRowId: 0 })),
};

jest.mock("../../database", () => ({
  getDatabase: () => mockDb,
}));

import { getExpensesPaginated } from "../../services/expense";

beforeEach(() => {
  capturedSql = [];
  capturedParams = [];
  jest.clearAllMocks();
});

describe("getExpensesPaginated — multi-select filters", () => {
  it("adds accountIds IN clause when filter set", async () => {
    await getExpensesPaginated("u1", { accountIds: ["acc-123"] }, 10, 0);
    const sql = capturedSql[0];
    expect(sql).toContain("account_id IN");
    expect(capturedParams[0]).toContain("acc-123");
  });

  it("adds multiple accountIds to IN clause", async () => {
    await getExpensesPaginated("u1", { accountIds: ["acc-1", "acc-2", "acc-3"] }, 10, 0);
    const sql = capturedSql[0];
    expect(sql).toContain("account_id IN (?,?,?)");
    expect(capturedParams[0]).toContain("acc-1");
    expect(capturedParams[0]).toContain("acc-2");
    expect(capturedParams[0]).toContain("acc-3");
  });

  it("adds tagIds subquery when filter set", async () => {
    await getExpensesPaginated("u1", { tagIds: ["t1", "t2"] }, 10, 0);
    const sql = capturedSql[0];
    expect(sql).toContain("SELECT expense_id FROM expense_tags WHERE tag_id IN");
    expect(capturedParams[0]).toContain("t1");
    expect(capturedParams[0]).toContain("t2");
  });

  it("adds categoryIds IN clause when filter set", async () => {
    await getExpensesPaginated("u1", { categoryIds: ["cat-1", "cat-2"] }, 10, 0);
    const sql = capturedSql[0];
    expect(sql).toContain("category_id IN (?,?)");
    expect(capturedParams[0]).toContain("cat-1");
    expect(capturedParams[0]).toContain("cat-2");
  });

  it("adds paymentModeIds IN clause when filter set", async () => {
    await getExpensesPaginated("u1", { paymentModeIds: ["pm-1"] }, 10, 0);
    const sql = capturedSql[0];
    expect(sql).toContain("payment_mode_id IN");
    expect(capturedParams[0]).toContain("pm-1");
  });

  it("does NOT add accountIds clause when not set", async () => {
    await getExpensesPaginated("u1", {}, 10, 0);
    const sql = capturedSql[0];
    expect(sql).not.toContain("account_id IN");
  });

  it("does NOT add tagIds clause when not set", async () => {
    await getExpensesPaginated("u1", {}, 10, 0);
    const sql = capturedSql[0];
    expect(sql).not.toContain("expense_tags");
  });

  it("combines multiple multi-select filters", async () => {
    await getExpensesPaginated("u1", {
      accountIds: ["acc-456"],
      tagIds: ["t3"],
      categoryIds: ["cat-1"],
      paymentModeIds: ["pm-1", "pm-2"],
    }, 10, 0);
    const sql = capturedSql[0];
    expect(sql).toContain("account_id IN");
    expect(sql).toContain("expense_tags");
    expect(sql).toContain("category_id IN");
    expect(sql).toContain("payment_mode_id IN");
  });

  it("handles empty tagIds array (no filter)", async () => {
    await getExpensesPaginated("u1", { tagIds: [] }, 10, 0);
    const sql = capturedSql[0];
    expect(sql).not.toContain("expense_tags");
  });

  it("handles empty categoryIds array (no filter)", async () => {
    await getExpensesPaginated("u1", { categoryIds: [] }, 10, 0);
    const sql = capturedSql[0];
    expect(sql).not.toContain("category_id IN");
  });

  it("defaults to nature='realized' when nature filter not set", async () => {
    await getExpensesPaginated("u1", {}, 10, 0);
    const sql = capturedSql[0];
    expect(sql).toContain("nature = ?");
    expect(capturedParams[0]).toContain("realized");
    expect(capturedParams[0]).not.toContain("credit");
  });

  it("binds nature='credit' when filter set to credit", async () => {
    await getExpensesPaginated("u1", { nature: "credit" }, 10, 0);
    const sql = capturedSql[0];
    expect(sql).toContain("nature = ?");
    expect(capturedParams[0]).toContain("credit");
  });
});
