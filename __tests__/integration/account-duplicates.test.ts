import { DatabaseSync } from "node:sqlite";

/**
 * Duplicate accounts against the REAL schema (every migration run on a real SQLite engine, the
 * same way as backup-coverage.test.ts): finding the same card / A/c recorded twice, and merging
 * one into the other without losing anything.
 */
let mockDb: DatabaseSync;
const mockAdapter = {
  execAsync: async (sql: string) => {
    mockDb.exec(sql);
  },
  runAsync: async (sql: string, ...params: unknown[]) => {
    const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
    const r = mockDb.prepare(sql).run(...(flat as never[]));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).all(...(params as never[])),
  getFirstAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).get(...(params as never[])) ?? null,
  withTransactionAsync: async (fn: () => Promise<void>) => {
    mockDb.exec("BEGIN");
    try {
      await fn();
      mockDb.exec("COMMIT");
    } catch (e) {
      mockDb.exec("ROLLBACK");
      throw e;
    }
  },
};

const mockStore = new Map<string, string>();
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: () => undefined,
    getNumber: () => undefined,
    getString: (k: string) => mockStore.get(k),
    set: (k: string, v: string) => mockStore.set(k, String(v)),
    delete: (k: string) => mockStore.delete(k),
    getAllKeys: () => [...mockStore.keys()],
  })),
}));
jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));

import { runMigrations } from "../../database/migrations";
import { dismissDuplicateGroup, findDuplicateAccounts, mergeAccounts } from "../../services/account-duplicates";

const U = "default_user";

beforeEach(async () => {
  mockStore.clear();
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  mockDb.exec(`
    INSERT OR IGNORE INTO users (id, name) VALUES ('${U}', 'Me');
    INSERT INTO financial_accounts (id, user_id, account_identifier, bank_name, account_type, discovered_from_sms, created_at)
      VALUES ('mine', '${U}', '1234', 'HDFC', 'savings', 0, '2026-01-01 00:00:00'),
             ('dup', '${U}', '1234', 'HDFC Bank', 'credit_card', 1, '2026-03-01 00:00:00'),
             ('other', '${U}', '1234', 'SBI', 'savings', 1, '2026-02-01 00:00:00');
  `);
});

const one = (sql: string) => mockDb.prepare(sql).get() as Record<string, unknown>;

describe("findDuplicateAccounts", () => {
  it("groups the same digits at the same bank, loosely, and suggests the one you added", async () => {
    const groups = await findDuplicateAccounts(U);
    expect(groups).toHaveLength(1);
    expect(groups[0].accounts.map((a) => a.id).sort()).toEqual(["dup", "mine"]);
    expect(groups[0].suggestedKeepId).toBe("mine");
    expect(groups[0].canMerge).toBe(true);
  });

  it("forgets a pair marked 'not the same'", async () => {
    const [g] = await findDuplicateAccounts(U);
    dismissDuplicateGroup(g.key);
    expect(await findDuplicateAccounts(U)).toHaveLength(0);
  });
});

describe("mergeAccounts", () => {
  it("moves transactions, transfers, balances and modes, then removes the duplicate", async () => {
    mockDb.exec(`
      INSERT INTO expenses (id, user_id, amount, date, nature, status, source, account_id)
        VALUES ('e1', '${U}', 100, '2026-03-02', 'realized', 'approved', 'sms_auto', 'dup'),
               ('e2', '${U}', 50, '2026-03-03', 'realized', 'approved', 'manual', 'mine');
      INSERT INTO account_transfers (id, user_id, from_account_id, to_account_id, amount, date)
        VALUES ('t-between', '${U}', 'mine', 'dup', 500, '2026-03-04'),
               ('t-out', '${U}', 'dup', 'other', 200, '2026-03-05');
      INSERT INTO account_month_balances (id, account_id, month, opening_balance)
        VALUES ('b1', 'mine', '2026-03', 1000), ('b2', 'dup', '2026-03', 0), ('b3', 'dup', '2026-04', 700);
      INSERT INTO payment_modes (id, user_id, name, type) VALUES ('pm-upi', '${U}', 'UPI', 'upi');
      INSERT INTO account_payment_modes (id, account_id, payment_mode_id) VALUES ('apm1', 'dup', 'pm-upi');
    `);

    await mergeAccounts("mine", "dup");

    expect(one("SELECT account_id FROM expenses WHERE id = 'e1'").account_id).toBe("mine");
    expect(one("SELECT COUNT(*) AS n FROM financial_accounts WHERE id = 'dup'").n).toBe(0);
    // A transfer between the two is now within one account - removed.
    expect(one("SELECT deleted_at FROM account_transfers WHERE id = 't-between'").deleted_at).not.toBeNull();
    expect(one("SELECT from_account_id FROM account_transfers WHERE id = 't-out'").from_account_id).toBe("mine");
    // The kept account's own opening balance wins; the duplicate's other months move over.
    expect(one("SELECT opening_balance FROM account_month_balances WHERE account_id = 'mine' AND month = '2026-03'").opening_balance).toBe(1000);
    expect(one("SELECT opening_balance FROM account_month_balances WHERE account_id = 'mine' AND month = '2026-04'").opening_balance).toBe(700);
    expect(one("SELECT COUNT(*) AS n FROM account_month_balances WHERE account_id = 'dup'").n).toBe(0);
    expect(one("SELECT COUNT(*) AS n FROM account_payment_modes WHERE account_id = 'mine' AND payment_mode_id = 'pm-upi'").n).toBe(1);
  });

  it("refuses when both accounts own an investment record", async () => {
    mockDb.exec(`
      INSERT INTO investment_products (id, financial_account_id, instrument, valuation, status, created_at, updated_at)
        VALUES ('p1', 'mine', 'fd', 'contract', 'active', '2026-01-01', '2026-01-01'),
               ('p2', 'dup', 'fd', 'contract', 'active', '2026-01-01', '2026-01-01');
    `);
    await expect(mergeAccounts("mine", "dup")).rejects.toThrow(/can't be merged/);
    expect(one("SELECT COUNT(*) AS n FROM financial_accounts WHERE id = 'dup'").n).toBe(1);
  });
});
