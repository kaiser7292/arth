import { DatabaseSync } from "node:sqlite";

/**
 * A positive balance adjustment, edited as money in, becomes a credit with a type, and the
 * account's balance doesn't move. Negative and opening-balance adjustments are refused.
 */
let mockDb: DatabaseSync;
const flat = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params);
const mockAdapter = {
  execAsync: async (sql: string) => { mockDb.exec(sql); },
  runAsync: async (sql: string, ...params: unknown[]) => {
    const r = mockDb.prepare(sql).run(...(flat(params) as never[]));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).all(...(flat(params) as never[])),
  getFirstAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).get(...(flat(params) as never[])) ?? null,
  withTransactionAsync: async (fn: () => Promise<void>) => {
    mockDb.exec("BEGIN");
    try { await fn(); mockDb.exec("COMMIT"); } catch (e) { mockDb.exec("ROLLBACK"); throw e; }
  },
};
jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: () => undefined, getNumber: () => undefined, getString: () => undefined,
    set: () => {}, delete: () => {}, getAllKeys: () => [], contains: () => false,
  })),
}));

import { runMigrations } from "../../database/migrations";
import { seedDefaultUser } from "../../database/seed";
import { DEFAULT_USER_ID } from "../../constants/app";
import { adjustmentToCredit, getExpenseById, updateExpense } from "../../services/expense";
import { computeUnseededBalance } from "../../services/account-balance";

const U = DEFAULT_USER_ID;
function add(id: string, description: string, amount = 500) {
  mockDb.prepare(
    `INSERT INTO expenses (id, user_id, amount, currency, description, date, transaction_time, nature, source, status, account_id, created_at)
     VALUES (?, ?, ?, 'INR', ?, '2026-11-01', '00:00:00', 'ledger_adjustment', 'manual', 'approved', 'acc1', '2026-11-01T00:00:00Z')`,
  ).run(id, U, amount, description);
}

beforeEach(async () => {
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  await seedDefaultUser(mockAdapter as never);
  mockDb.prepare(
    `INSERT INTO financial_accounts (id, user_id, bank_name, account_type, account_identifier, is_active) VALUES ('acc1', ?, 'HDFC', 'savings', '1234', 1)`,
  ).run(U);
});

describe("adjustmentToCredit", () => {
  it("turns a positive balance adjustment into a typed credit, balance unchanged", async () => {
    add("a1", "[Balance Adjustment +] Interest the SMS missed");
    const before = await computeUnseededBalance("acc1", "2026-11");
    await adjustmentToCredit("a1");
    await updateExpense("a1", { description: "Interest the SMS missed", credit_kind: "interest" });
    const e = await getExpenseById("a1");
    expect(e).toMatchObject({ nature: "credit", credit_kind: "interest", description: "Interest the SMS missed" });
    const after = await computeUnseededBalance("acc1", "2026-11");
    expect(after.closing).toBe(before.closing);
  });

  it("refuses negative and opening-balance adjustments", async () => {
    add("n1", "[Balance Adjustment -] Cash spent");
    add("o1", "[Opening Adjustment +]");
    await expect(adjustmentToCredit("n1")).rejects.toThrow(/added money/);
    await expect(adjustmentToCredit("o1")).rejects.toThrow(/added money/);
    expect((await getExpenseById("n1"))?.nature).toBe("ledger_adjustment");
  });
});
