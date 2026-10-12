/**
 * Catch Up writes: category is set before approval, and hand-picked categories teach the
 * merchant mapping.
 */

const mockApproveExpense = jest.fn(async (_id: string) => {});
const mockApproveExpenses = jest.fn(async (_ids: string[]) => {});
const mockBulkAssignCategory = jest.fn(async (_ids: string[], _cat: string) => 1);
const mockRecordCorrection = jest.fn(async (_u: string, _m: string, _c: string) => {});
const mockSplitExisting = jest.fn(async (_id: string, _c: unknown, _o: unknown) => {});
const mockRemoveSplit = jest.fn(async (_id: string) => {});
const mockGetExpenseById = jest.fn(async (id: string) => ({ id, amount: 250 }));
const calls: string[] = [];

jest.mock("../../constants/app", () => ({ DEFAULT_USER_ID: "user-1" }));
jest.mock("../../services/expense", () => ({
  approveExpense: (id: string) => { calls.push("approve"); return mockApproveExpense(id); },
  approveExpenses: (ids: string[]) => { calls.push("approveMany"); return mockApproveExpenses(ids); },
  bulkAssignCategory: (ids: string[], c: string) => { calls.push("assign"); return mockBulkAssignCategory(ids, c); },
  splitExistingExpense: (id: string, c: unknown, o: unknown) => { calls.push("split"); return mockSplitExisting(id, c, o); },
  removeSplit: (id: string) => { calls.push("unsplit"); return mockRemoveSplit(id); },
  getExpenseById: (id: string) => { calls.push("read"); return mockGetExpenseById(id); },
}));
jest.mock("../../services/smart-categorizer", () => ({
  recordCategoryCorrection: (u: string, m: string, c: string) => mockRecordCorrection(u, m, c),
}));

import type { Expense } from "../../services/expense";
import {
  approveBatchWithCategory,
  approveWithCategory,
  assignCategory,
  removeCardSplit,
  saveCardSplit,
} from "../../services/catch-up-actions";

const e = (id: string, over: Partial<Expense> = {}) =>
  ({ id, merchant_name: "Swiggy", category_id: null, ...over }) as Expense;

beforeEach(() => {
  jest.clearAllMocks();
  calls.length = 0;
});

describe("approveWithCategory", () => {
  it("sets the category before approving", async () => {
    await approveWithCategory(e("1"), "food", false);
    expect(calls).toEqual(["assign", "approve"]);
    expect(mockBulkAssignCategory).toHaveBeenCalledWith(["1"], "food");
    expect(mockRecordCorrection).not.toHaveBeenCalled();
  });

  it("doesn't rewrite a category the row already has", async () => {
    await approveWithCategory(e("1", { category_id: "food" }), "food", false);
    expect(calls).toEqual(["approve"]);
  });

  it("records a correction when the user picked the category", async () => {
    await approveWithCategory(e("1"), "food", true);
    expect(mockRecordCorrection).toHaveBeenCalledWith("user-1", "Swiggy", "food");
  });

  it("approves without a category when there is none", async () => {
    await approveWithCategory(e("1"), null, false);
    expect(calls).toEqual(["approve"]);
  });
});

describe("approveBatchWithCategory", () => {
  it("categorizes only rows that need it, then approves all in one call", async () => {
    await approveBatchWithCategory([e("1"), e("2", { category_id: "food" }), e("3")], "food");
    expect(mockBulkAssignCategory).toHaveBeenCalledWith(["1", "3"], "food");
    expect(mockApproveExpenses).toHaveBeenCalledWith(["1", "2", "3"]);
    expect(calls).toEqual(["assign", "approveMany"]);
  });
});

describe("assignCategory", () => {
  it("assigns every row and teaches once when hand-picked", async () => {
    await assignCategory([e("1"), e("2")], "food", true);
    expect(mockBulkAssignCategory).toHaveBeenCalledWith(["1", "2"], "food");
    expect(mockRecordCorrection).toHaveBeenCalledTimes(1);
  });
});

describe("card split", () => {
  const config = { paidBy: "me", splitMode: "equal", personId: "p1" } as const;

  it("splits without approving, then returns the row as it now stands", async () => {
    const fresh = await saveCardSplit("1", config);
    expect(mockSplitExisting).toHaveBeenCalledWith("1", config, { skipAutoApprove: true });
    expect(calls).toEqual(["split", "read"]);
    expect(fresh).toEqual({ id: "1", amount: 250 });
  });

  it("removes the split and returns the restored row", async () => {
    await removeCardSplit("1");
    expect(calls).toEqual(["unsplit", "read"]);
  });
});
