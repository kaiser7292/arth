import { DatabaseSync } from "node:sqlite";

/**
 * Sub-categories (migration 095) on the REAL schema: one level only, a parent's budget total takes
 * in its sub-categories' spending, filtering on a parent finds its sub-categories' transactions,
 * and deleting or hiding a parent moves its sub-categories up instead of stranding them.
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
import {
  createCategory, deleteCategory, getCategoryById, getRecentCategoriesForMerchant, hardDeleteCategory, setCategoryParent, updateCategory,
} from "../../services/category";
import { countFilteredExpenses, getExpenseTotalsByCategory, getExpenseIdsByCategory, getFilteredGroupTotals } from "../../services/expense";
import { TABLE_SCHEMAS } from "../../database/TABLE_SCHEMAS";
import { restoreFromData } from "../../services/backup";
import { applyOrganiseSuggestions, getOrganiseSuggestions } from "../../services/category-organise";

const U = DEFAULT_USER_ID;
let n = 0;
function addExpense(categoryId: string, amount: number, merchant = "Fresh Mart") {
  mockDb.prepare(
    `INSERT INTO expenses (id, user_id, amount, currency, description, merchant_name, category_id, date, transaction_time, source, status, nature)
     VALUES (?, ?, ?, 'INR', ?, ?, ?, '2026-11-10', '10:00:00', 'manual', 'approved', 'realized')`,
  ).run(`e${++n}`, U, amount, merchant, merchant, categoryId);
}

let food: string;
let groceries: string;
let bills: string;
beforeEach(async () => {
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  await seedDefaultUser(mockAdapter as never);
  food = await createCategory({ user_id: U, name: "Food", icon: "fast-food-outline", color: "#B45309" });
  bills = await createCategory({ user_id: U, name: "Bills", icon: "flash-outline", color: "#2563EB" });
  groceries = await createCategory({ user_id: U, name: "Groceries", parent_id: food });
});

describe("sub-categories", () => {
  it("adds the column, and backup restore keeps it", () => {
    const cols = (mockDb.prepare("PRAGMA table_info(categories)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("parent_id");
    expect(TABLE_SCHEMAS.categories).toContain("parent_id");
  });

  it("takes its parent's look unless told otherwise", async () => {
    const g = await getCategoryById(groceries);
    expect(g?.parent_id).toBe(food);
    expect(g?.icon).toBe("fast-food-outline");
    expect(g?.color).toBe("#B45309");
  });

  it("is one level only", async () => {
    await expect(createCategory({ user_id: U, name: "Veg", parent_id: groceries })).rejects.toThrow(/can't have sub-categories/);
    await expect(setCategoryParent(food, bills)).rejects.toThrow(/has sub-categories/);
    await setCategoryParent(bills, food);
    expect((await getCategoryById(bills))?.parent_id).toBe(food);
    await setCategoryParent(bills, null);
    expect((await getCategoryById(bills))?.parent_id).toBeNull();
  });

  it("counts a sub-category's spending toward its parent", async () => {
    addExpense(food, 300);
    addExpense(groceries, 700);
    addExpense(bills, 100);
    const totals = new Map((await getExpenseTotalsByCategory(U, "2026-11-01", "2026-11-30")).map((r) => [r.category_id, r.total]));
    expect(totals.get(food)).toBe(1000);
    expect(totals.get(groceries)).toBeUndefined();
    expect(totals.get(bills)).toBe(100);
    expect((await getExpenseIdsByCategory(U, food, "2026-11-01", "2026-11-30")).length).toBe(2);
  });

  it("filtering on a parent finds its sub-categories' transactions", async () => {
    addExpense(food, 300);
    addExpense(groceries, 700);
    addExpense(bills, 100);
    expect(await countFilteredExpenses(U, { categoryIds: [food] })).toBe(2);
    expect(await countFilteredExpenses(U, { categoryIds: [groceries] })).toBe(1);
  });

  it("deleting, hiding or removing a parent moves its sub-categories up", async () => {
    await deleteCategory(food);
    expect((await getCategoryById(groceries))?.parent_id).toBeNull();

    const travel = await createCategory({ user_id: U, name: "Travel" });
    const cab = await createCategory({ user_id: U, name: "Cab", parent_id: travel });
    await updateCategory(travel, { is_active: 0 });
    expect((await getCategoryById(cab))?.parent_id).toBeNull();

    const home = await createCategory({ user_id: U, name: "Home" });
    const rent = await createCategory({ user_id: U, name: "Rent", parent_id: home });
    expect(await hardDeleteCategory(home)).toBe(true);
    expect((await getCategoryById(rent))?.parent_id).toBeNull();
  });

  it("remembers what a merchant was filed under", async () => {
    addExpense(groceries, 100);
    addExpense(groceries, 200);
    addExpense(bills, 50);
    expect(await getRecentCategoriesForMerchant(U, "fresh mart")).toEqual([groceries, bills]);
    expect(await getRecentCategoriesForMerchant(U, "")).toEqual([]);
  });

  it("survives a backup and restore, and an old backup comes back flat", async () => {
    const saved = mockDb.prepare("SELECT * FROM categories").all() as Record<string, unknown>[];
    // A sub-category whose parent is a sub-category, and one whose parent is missing: both move up.
    const broken = [
      ...saved,
      { ...saved[0], id: "deep", name: "Deep", parent_id: groceries },
      { ...saved[0], id: "lost", name: "Lost", parent_id: "not-in-backup" },
    ];
    await restoreFromData({ categories: broken });
    expect((await getCategoryById(groceries))?.parent_id).toBe(food);
    expect((await getCategoryById(food))?.parent_id).toBeNull();
    expect((await getCategoryById("deep"))?.parent_id).toBeNull();
    expect((await getCategoryById("lost"))?.parent_id).toBeNull();

    // A backup from before migration 095 has no parent_id at all.
    const old = saved.map(({ parent_id: _drop, ...rest }) => rest);
    await restoreFromData({ categories: old });
    expect((await getCategoryById(groceries))?.parent_id).toBeNull();
  });

  it("suggests organising an existing set, and changes nothing until applied", async () => {
    const petrol = await createCategory({ user_id: U, name: "Petrol" });
    const car = await createCategory({ user_id: U, name: "Car & Vehicles" });
    addExpense(petrol, 400, "HP Pump");
    const list = await getOrganiseSuggestions(U);
    const move = list.find((s) => s.kind === "move" && s.categoryId === petrol);
    expect(move).toMatchObject({ parentId: car, transactions: 1 });
    // Fuel is covered by the Petrol move, so it isn't offered as a new one too.
    expect(list.some((s) => s.kind === "add" && s.parentId === car && s.name === "Fuel")).toBe(false);
    expect(list.some((s) => s.kind === "add" && s.parentId === food && s.name === "Eating out")).toBe(true);
    expect((await getCategoryById(petrol))?.parent_id).toBeNull();

    await applyOrganiseSuggestions(U, list.filter((s) => s.key === move!.key || (s.kind === "add" && s.name === "Eating out")));
    expect((await getCategoryById(petrol))?.parent_id).toBe(car);
    const eatingOut = mockDb.prepare("SELECT parent_id FROM categories WHERE name = 'Eating out'").get() as { parent_id: string };
    expect(eatingOut.parent_id).toBe(food);
    // Its spending now counts toward Car & Vehicles.
    const totals = new Map((await getExpenseTotalsByCategory(U, "2026-11-01", "2026-11-30")).map((r) => [r.category_id, r.total]));
    expect(totals.get(car)).toBe(400);
  });

  it("totals the Transactions drawers by whatever the list is grouped by", async () => {
    addExpense(food, 300, "Cafe");
    addExpense(groceries, 700, "Fresh Mart");
    addExpense(bills, 100, "Fresh Mart");
    const byCat = await getFilteredGroupTotals(U, {}, "category");
    // A sub-category's spending is in its parent's drawer.
    expect(byCat.get(food)).toMatchObject({ spent: 1000, count: 2 });
    expect(byCat.get(bills)).toMatchObject({ spent: 100, count: 1 });
    const byMerchant = await getFilteredGroupTotals(U, {}, "merchant");
    expect(byMerchant.get("Fresh Mart")).toMatchObject({ spent: 800, count: 2 });
    expect((await getFilteredGroupTotals(U, {}, "year")).get("2026")).toMatchObject({ count: 3 });
    expect((await getFilteredGroupTotals(U, {}, "date")).get("2026-11-10")).toMatchObject({ count: 3 });
    // No account set: the NOT_SET drawer, which the account filter understands.
    expect((await getFilteredGroupTotals(U, {}, "account")).get("__none__")).toMatchObject({ count: 3 });
    expect(await countFilteredExpenses(U, { accountIds: ["__none__"] })).toBe(3);
  });
});
