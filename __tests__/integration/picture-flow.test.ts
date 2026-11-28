import { DatabaseSync } from "node:sqlite";

/** Payment pictures get the bank-message treatment: merchant names, category, rules. Real schema. */
let mockDb: DatabaseSync;
const flat = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params);
const mockAdapter = {
  execAsync: async (sql: string) => {
    mockDb.exec(sql);
  },
  runAsync: async (sql: string, ...params: unknown[]) => {
    const r = mockDb.prepare(sql).run(...(flat(params) as never[]));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).all(...(flat(params) as never[])),
  getFirstAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).get(...(flat(params) as never[])) ?? null,
  withTransactionAsync: async (fn: () => Promise<void>) => fn(),
};
const mockStore = new Map<string, string | number | boolean>();
jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: (k: string) => mockStore.get(k) as boolean | undefined,
    getNumber: (k: string) => mockStore.get(k) as number | undefined,
    getString: (k: string) => mockStore.get(k) as string | undefined,
    set: (k: string, v: string | number | boolean) => mockStore.set(k, v),
    delete: (k: string) => mockStore.delete(k),
    getAllKeys: () => [...mockStore.keys()],
    contains: (k: string) => mockStore.has(k),
  })),
}));

import { runMigrations } from "../../database/migrations";
import { seedDefaultUser } from "../../database/seed";
import { createExpense } from "../../services/expense-crud";
import { recordCategoryCorrection } from "../../services/smart-categorizer";
import { prepareFromPicture } from "../../services/receipt/picture-flow";

let U = "";
let food = "";
// Made-up merchants.
function alias(sms: string, canonical: string) {
  mockDb
    .prepare(`INSERT INTO merchant_aliases (id, user_id, sms_name, canonical_name) VALUES (?, ?, ?, ?)`)
    .run(`al-${sms}`, U, sms, canonical);
}

beforeEach(async () => {
  mockDb = new DatabaseSync(":memory:");
  mockStore.clear();
  await runMigrations(mockAdapter as never);
  U = await seedDefaultUser(mockAdapter as never);
  food = "cat-food";
  mockDb.prepare(`INSERT INTO categories (id, user_id, name, icon, color, sort_order, is_active, is_unavoidable) VALUES (?, ?, 'Food', 'x', '#000', 1, 1, 0)`).run(food, U);
});

it("a picture's merchant takes the name you merged it into, and that merchant's category", async () => {
  alias("Test Canteen Group", "Office Cafe");
  // Corrections count once you've made them a few times (LEARNING_THRESHOLD).
  for (let i = 0; i < 3; i++) await recordCategoryCorrection(U, "Office Cafe", food);

  const p = await prepareFromPicture(U, {
    merchant: "Test Canteen Group",
    amount: 141.75,
    date: "2026-11-25",
    accountId: null,
    note: null,
    credit: false,
  });

  expect(p.merchant).toBe("Office Cafe");
  expect(p.rawMerchant).toBe("Test Canteen Group");
  expect(p.categoryId).toBe(food);
});

it("money in keeps the payer's name as read and learns nothing, as bank-message credits do", async () => {
  alias("Test Payer Pvt Ltd", "Test Payer");
  const before = (mockDb.prepare(`SELECT COUNT(*) AS n FROM merchant_aliases`).get() as { n: number }).n;
  const p = await prepareFromPicture(U, { merchant: "Test Payer Pvt Ltd", amount: 500, date: "2026-11-25", accountId: null, note: null, credit: true });
  expect(p.merchant).toBe("Test Payer Pvt Ltd");
  expect(p.categoryId).toBeNull();
  expect((mockDb.prepare(`SELECT COUNT(*) AS n FROM merchant_aliases`).get() as { n: number }).n).toBe(before);
});

it("saving keeps the picture's own name underneath, so Separate can undo the merge", async () => {
  const id = await createExpense({ user_id: U, amount: 100, date: "2026-11-25", merchant_name: "Office Cafe", raw_merchant_name: "Test Canteen Group" });
  expect(mockDb.prepare(`SELECT merchant_name, raw_merchant_name FROM expenses WHERE id = ?`).get(id)).toEqual({
    merchant_name: "Office Cafe",
    raw_merchant_name: "Test Canteen Group",
  });
});
