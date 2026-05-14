/**
 * Tests for data cleanup service.
 * Mocks the database layer.
 */

const mockRunAsync = jest.fn();
const mockGetAllAsync = jest.fn();
jest.mock("../../database", () => ({
  getDatabase: () => ({
    runAsync: mockRunAsync,
    getAllAsync: mockGetAllAsync,
  }),
}));

import { cleanupData } from "../../services/data-cleanup";
import type { CleanupScope } from "../../services/data-cleanup";

describe("cleanupData", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunAsync.mockResolvedValue({ changes: 5 });
    mockGetAllAsync.mockResolvedValue([]);
  });

  it("deletes all expenses and budgets for 'all' scope", async () => {
    const result = await cleanupData("user-1", "all");

    expect(result.expensesDeleted).toBe(5);
    expect(result.budgetsDeleted).toBe(5);
    expect(result.errors).toHaveLength(0);

    // Should have called DELETE FROM expenses somewhere in the chain
    const expenseDeleteCall = mockRunAsync.mock.calls.find(
      (call) => call[0].includes("DELETE FROM expenses") && !call[0].includes("SELECT"),
    );
    expect(expenseDeleteCall).toBeDefined();
    expect(expenseDeleteCall![0]).not.toContain("date >=");

    // Should have called DELETE FROM budgets
    const budgetDeleteCall = mockRunAsync.mock.calls.find(
      (call) => call[0].includes("DELETE FROM budgets"),
    );
    expect(budgetDeleteCall).toBeDefined();
    expect(budgetDeleteCall![0]).not.toContain("month >=");
  });

  it("uses date filter for 'day' scope", async () => {
    const result = await cleanupData("user-1", "day");

    expect(result.expensesDeleted).toBe(5);
    const expenseDeleteCall = mockRunAsync.mock.calls.find(
      (call) => call[0].includes("DELETE FROM expenses WHERE") && !call[0].includes("SELECT"),
    );
    expect(expenseDeleteCall).toBeDefined();
    expect(expenseDeleteCall![0]).toContain("date >=");
  });

  it("uses date filter for 'week' scope", async () => {
    await cleanupData("user-1", "week");

    const expenseDeleteCall = mockRunAsync.mock.calls.find(
      (call) => call[0].includes("DELETE FROM expenses WHERE") && !call[0].includes("SELECT"),
    );
    expect(expenseDeleteCall).toBeDefined();
    expect(expenseDeleteCall![0]).toContain("date >=");
  });

  it("uses date filter for 'month' scope", async () => {
    await cleanupData("user-1", "month");

    const expenseDeleteCall = mockRunAsync.mock.calls.find(
      (call) => call[0].includes("DELETE FROM expenses WHERE") && !call[0].includes("SELECT"),
    );
    expect(expenseDeleteCall).toBeDefined();
    expect(expenseDeleteCall![0]).toContain("date >=");

    const budgetDeleteCall = mockRunAsync.mock.calls.find(
      (call) => call[0].includes("DELETE FROM budgets"),
    );
    expect(budgetDeleteCall).toBeDefined();
    expect(budgetDeleteCall![0]).toContain("month >=");
  });

  it("uses date filter for 'quarter' scope", async () => {
    await cleanupData("user-1", "quarter");

    const expenseDeleteCall = mockRunAsync.mock.calls.find(
      (call) => call[0].includes("DELETE FROM expenses WHERE") && !call[0].includes("SELECT"),
    );
    expect(expenseDeleteCall).toBeDefined();
    expect(expenseDeleteCall![0]).toContain("date >=");
  });

  it("handles expense deletion error gracefully", async () => {
    mockRunAsync.mockRejectedValue(new Error("DB locked"));
    // Only budgets succeed (after expenses fail, budgets are attempted separately)
    mockRunAsync.mockRejectedValueOnce(new Error("DB locked"));
    // Reset: all remaining calls succeed
    mockRunAsync.mockResolvedValue({ changes: 3 });

    const result = await cleanupData("user-1", "all");

    expect(result.expensesDeleted).toBe(0);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain("DB locked");
  });

  it("handles budget deletion error gracefully", async () => {
    // All expense-related calls succeed
    mockRunAsync.mockResolvedValue({ changes: 10 });

    // The budget call (7th call for "all" scope) should fail
    // Since we can't easily target a specific call index with the new multi-step approach,
    // we test that the function handles errors by type
    let callCount = 0;
    mockRunAsync.mockImplementation(async (sql: string) => {
      callCount++;
      if (sql.includes("DELETE FROM budgets")) {
        throw new Error("constraint violation");
      }
      return { changes: 10 };
    });

    const result = await cleanupData("user-1", "all");

    expect(result.expensesDeleted).toBe(10);
    expect(result.budgetsDeleted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("constraint violation");
  });

  it("clears FK references before deleting expenses", async () => {
    await cleanupData("user-1", "all");

    const calls = mockRunAsync.mock.calls.map((c) => c[0] as string);

    // Should clear split hisaab entries
    expect(calls.some((sql) => sql.includes("DELETE FROM hisaab_entries WHERE id IN"))).toBe(true);
    // Should nullify refund_of_expense_id
    expect(calls.some((sql) => sql.includes("refund_of_expense_id = NULL"))).toBe(true);
    // Should nullify matched_forecast_id
    expect(calls.some((sql) => sql.includes("matched_forecast_id = NULL"))).toBe(true);
    // Should clear linked_expense_id in hisaab
    expect(calls.some((sql) => sql.includes("linked_expense_id = NULL"))).toBe(true);
    // Should delete expense_splits
    expect(calls.some((sql) => sql.includes("DELETE FROM expense_splits"))).toBe(true);
  });

  it("passes correct user_id in delete queries", async () => {
    await cleanupData("my-user-id", "all");

    // The main delete calls should use user_id
    const expenseDeleteCall = mockRunAsync.mock.calls.find(
      (call) => call[0].includes("DELETE FROM expenses WHERE") && !call[0].includes("SELECT"),
    );
    expect(expenseDeleteCall).toBeDefined();
    expect(expenseDeleteCall!.slice(1)).toContain("my-user-id");
  });

  it("returns zero counts when nothing deleted", async () => {
    mockRunAsync.mockResolvedValue({ changes: 0 });

    const result = await cleanupData("user-1", "day");

    expect(result.expensesDeleted).toBe(0);
    expect(result.budgetsDeleted).toBe(0);
  });

  const scopes: CleanupScope[] = ["day", "week", "month", "quarter", "all"];
  it.each(scopes)("handles '%s' scope without throwing", async (scope) => {
    const result = await cleanupData("user-1", scope);
    expect(result).toBeDefined();
    expect(result.errors).toHaveLength(0);
  });
});
