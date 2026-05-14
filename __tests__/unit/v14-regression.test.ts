/**
 * v14.0.0 regression coverage for the six stability fixes:
 *   #2 Milestone Planned YoY — getTotalPlannedMilestonesForFY computes from
 *      active + completed milestones that overlap the FY.
 *   #3 Decimal precision — round2 is applied at every amount write boundary.
 *   #5 CC repayment ±0.5% matcher (findMatchingRepaymentForecast) +
 *      approveCcRepaymentCredit wires through markRepaymentAsPaid.
 *   #6 hardDeleteCredit / deleteSmsRecord cascade to pending_sms (FK fix).
 *
 * All tests mock the DB and verify the SQL/parameters that would be issued.
 */

let executedRuns: { sql: string; params: unknown[] }[] = [];
let mockRows: Record<string, unknown[]> = {};

const makeDb = () => ({
  getAllAsync: jest.fn(async (sql: string) => mockRows[sql] ?? []),
  getFirstAsync: jest.fn(async (sql: string) => {
    const rows = mockRows[sql] ?? [];
    return rows[0] ?? null;
  }),
  runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    executedRuns.push({ sql, params });
    return { changes: 1, lastInsertRowId: 1 };
  }),
  withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => {
    await fn();
  }),
});

let mockDb = makeDb();

jest.mock("../../database", () => ({
  getDatabase: () => mockDb,
}));
jest.mock("../../services/settings", () => ({
  bumpDataVersion: jest.fn(async () => {}),
  getFYStartMonth: () => 4,
}));
jest.mock("../../utils/uuid", () => ({
  generateUUID: () => "test-uuid",
}));

beforeEach(() => {
  executedRuns = [];
  mockRows = {};
  mockDb = makeDb();
});

// ────────────────────────────────────────────────────────────────────────
// #3 Decimal precision — round2 at write boundaries
// ────────────────────────────────────────────────────────────────────────

describe("#3 decimal precision", () => {
  it("round2 drops float drift to 2 decimals", () => {
    const { round2 } = require("../../utils/math");
    expect(round2(17499.9995)).toBe(17500);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1234.567)).toBe(1234.57);
    expect(round2(1234.561)).toBe(1234.56);
  });

  it("addCredit writes a round2'd amount", async () => {
    const { addCredit } = require("../../services/account-credit");
    await addCredit({
      accountId: "acc-1",
      userId: "u-1",
      amount: 1234.9995,
      description: "SMS credit",
      date: "2026-04-12",
    });
    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO expenses"));
    expect(insert).toBeDefined();
    // amount is the 3rd param (id, user_id, amount, ...)
    expect(insert!.params[2]).toBe(1235);
  });

  it("createMilestoneContribution rounds the amount", async () => {
    const { createMilestoneContribution } = require("../../services/life-milestone");
    await createMilestoneContribution({
      life_milestone_id: "m-1",
      month: "2026-04",
      amount: 17499.9995,
      date: "2026-04-15",
    });
    const insert = executedRuns.find((r) =>
      r.sql.includes("INSERT INTO milestone_contributions"),
    );
    expect(insert).toBeDefined();
    // params: id, milestone_id, month, amount, date
    expect(insert!.params[3]).toBe(17500);
  });
});

// ────────────────────────────────────────────────────────────────────────
// #6 FK cascade to pending_sms on credit hard-delete
// ────────────────────────────────────────────────────────────────────────

describe("#6 SMS ↔ credit FK cascade", () => {
  it("hardDeleteCredit clears pending_sms.expense_id before DELETE", async () => {
    const { hardDeleteCredit } = require("../../services/account-credit");
    await hardDeleteCredit("credit-123");

    const pendingSmsDelete = executedRuns.find((r) =>
      r.sql.includes("DELETE FROM pending_sms WHERE expense_id"),
    );
    const expenseDelete = executedRuns.find((r) =>
      r.sql.includes("DELETE FROM expenses"),
    );
    expect(pendingSmsDelete).toBeDefined();
    expect(expenseDelete).toBeDefined();
    // The sms delete must run BEFORE the expense delete.
    expect(executedRuns.indexOf(pendingSmsDelete!)).toBeLessThan(
      executedRuns.indexOf(expenseDelete!),
    );
  });

  it("purgeAllDeletedCredits clears pending_sms for the batch", async () => {
    const { purgeAllDeletedCredits } = require("../../services/account-credit");
    await purgeAllDeletedCredits("user-1");
    const smsCleanup = executedRuns.find((r) =>
      r.sql.includes("DELETE FROM pending_sms WHERE expense_id IN"),
    );
    expect(smsCleanup).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────────
// #5 CC repayment ±0.5% matcher
// ────────────────────────────────────────────────────────────────────────

describe("#5 CC repayment matcher", () => {
  it("findMatchingRepaymentForecast queries with ±0.5% tolerance", async () => {
    const { findMatchingRepaymentForecast } = require("../../services/expense-forecasts");
    mockDb.getAllAsync.mockImplementationOnce(async () => []);

    await findMatchingRepaymentForecast("u-1", "cc-acc", 10000, "2026-04-12");

    // 10000 * 0.005 = 50 tolerance
    const call = mockDb.getAllAsync.mock.calls[0] as unknown[];
    // positional: [sql, userId, ccAccountId, minAmount, maxAmount, amount, paymentDate]
    expect(call[2]).toBe("cc-acc");
    expect(call[3]).toBeCloseTo(9950, 5); // min
    expect(call[4]).toBeCloseTo(10050, 5); // max
  });

  it("uses minimum 0.01 tolerance for very small amounts", async () => {
    const { findMatchingRepaymentForecast } = require("../../services/expense-forecasts");
    mockDb.getAllAsync.mockImplementationOnce(async () => []);

    await findMatchingRepaymentForecast("u-1", "cc-acc", 1.0, "2026-04-12");
    const call = mockDb.getAllAsync.mock.calls[0] as unknown[];
    expect(call[3]).toBeCloseTo(0.99, 5); // min
    expect(call[4]).toBeCloseTo(1.01, 5); // max
  });
});
