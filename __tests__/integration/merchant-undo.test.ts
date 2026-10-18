import { DatabaseSync } from "node:sqlite";

/**
 * Undo on the Merchants screens, against the REAL schema: rename, merge, category rules and
 * "apply to past" are all put back exactly as they were.
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
import { learnMerchantAlias, propagateMerchantRename, renameCanonical } from "../../services/merchant-alias";
import { applyRuleToPastTransactions, setMerchantRule } from "../../services/merchant-categories";
import { dismissMerchantUndo, getPendingMerchantUndo, undoMerchantChange, withMerchantUndo } from "../../services/merchant-undo";

const U = "default_user";
const all = (sql: string) => mockDb.prepare(sql).all();

beforeEach(async () => {
  mockStore.clear();
  dismissMerchantUndo();
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  mockDb.exec(`
    INSERT OR IGNORE INTO users (id, name) VALUES ('${U}', 'Me');
    INSERT INTO categories (id, user_id, name, is_active) VALUES ('c-food', '${U}', 'Food Delivery', 1), ('c-other', '${U}', 'Other Stuff', 1);
    INSERT INTO expenses (id, user_id, amount, date, nature, status, source, merchant_name, raw_merchant_name, category_id)
      VALUES ('e1', '${U}', 100, '2026-10-01', 'realized', 'approved', 'sms_auto', 'ZOMATO LTD', 'ZOMATO LTD', 'c-other'),
             ('e2', '${U}', 200, '2026-10-02', 'realized', 'approved', 'sms_auto', 'ZOMATO LTD', 'ZOMATO LTD', NULL),
             ('e3', '${U}', 300, '2026-10-03', 'realized', 'approved', 'manual', 'Uber', 'Uber', 'c-other');
  `);
});

const state = () => ({
  expenses: all("SELECT id, merchant_name, category_id FROM expenses ORDER BY id"),
  aliases: all("SELECT sms_name, canonical_name FROM merchant_aliases ORDER BY sms_name"),
  mappings: all("SELECT keyword, category_name, is_active FROM merchant_mappings ORDER BY keyword"),
});

describe("merchant undo", () => {
  it("undoes a rename on every transaction and alias", async () => {
    const before = state();
    await withMerchantUndo(async () => {
      await learnMerchantAlias(U, "ZOMATO LTD", "Zomato");
      await renameCanonical(U, "ZOMATO LTD", "Zomato");
      return propagateMerchantRename(U, "ZOMATO LTD", "Zomato");
    }, (n) => `Renamed on ${n}`, U);
    expect(getPendingMerchantUndo()?.message).toBe("Renamed on 2");
    expect(state()).not.toEqual(before);

    await undoMerchantChange(U);
    expect(state()).toEqual(before);
    expect(getPendingMerchantUndo()).toBeNull();
  });

  it("undoes a category rule and moving past transactions", async () => {
    const before = state();
    await withMerchantUndo(async () => {
      const k = await setMerchantRule("ZOMATO LTD", "Food Delivery");
      return applyRuleToPastTransactions(k, "Food Delivery", U);
    }, (n) => `Moved ${n}`, U);
    expect(all("SELECT category_id FROM expenses WHERE id IN ('e1','e2')")).toEqual([{ category_id: "c-food" }, { category_id: "c-food" }]);

    await undoMerchantChange(U);
    expect(state()).toEqual(before);
  });

  it("stays offered until closed, and only the latest change", async () => {
    await withMerchantUndo(async () => "a", (m) => m);
    await withMerchantUndo(async () => "b", (m) => m);
    expect(getPendingMerchantUndo()?.message).toBe("b");
    dismissMerchantUndo();
    expect(getPendingMerchantUndo()).toBeNull();
  });
});
