import { DatabaseSync } from "node:sqlite";

/**
 * Merchant categories (Settings → Merchant Categories) on the REAL schema: built-in rules can be
 * changed, turned off and reset; your own rules win; renaming a category carries its rules; and
 * categorizeByMerchant actually follows what the user chose.
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
import { createCategory, getCategories, seedDefaultCategories, updateCategory } from "../../services/category";
import {
  countMerchantRulesForCategory, findRuleForMerchant, forgetLearnedMerchant, listLearnedMerchants,
  listMerchantRules, moveMerchantRules, resetOrRemoveMerchantRule, setMerchantRule, setMerchantRuleActive,
} from "../../services/merchant-categories";
import { categorizeByMerchant, recordCategoryCorrection, seedMerchantMappings } from "../../services/smart-categorizer";

const U = DEFAULT_USER_ID;
const catId = async (name: string) => (await getCategories(U)).find((c) => c.name === name)!.id;
const rule = async (k: string) => (await listMerchantRules()).find((r) => r.keyword === k)!;

beforeEach(async () => {
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  await seedDefaultUser(mockAdapter as never);
  await seedDefaultCategories(U);
  await seedMerchantMappings();
  await createCategory({ user_id: U, name: "Dining", icon: "restaurant-outline", color: "#F97316" } as never);
});

describe("merchant categories", () => {
  it("lists built-in rules and lets the user change one", async () => {
    expect(await rule("swiggy")).toMatchObject({ categoryName: "Food", source: "builtin", isActive: true });
    expect((await categorizeByMerchant(U, "SWIGGY BANGALORE")).categoryId).toBe(await catId("Food"));

    await setMerchantRule("Swiggy", "Dining");
    expect(await rule("swiggy")).toMatchObject({ categoryName: "Dining", source: "edited", builtInCategory: "Food" });
    expect((await categorizeByMerchant(U, "SWIGGY BANGALORE")).categoryId).toBe(await catId("Dining"));

    await resetOrRemoveMerchantRule("swiggy");
    expect(await rule("swiggy")).toMatchObject({ categoryName: "Food", source: "builtin" });
  });

  it("turning a rule off stops it filing", async () => {
    await setMerchantRuleActive("zomato", false);
    expect(await rule("zomato")).toMatchObject({ isActive: false, source: "edited" });
    const r = await categorizeByMerchant(U, "ZOMATO ORDER");
    expect(r.source).not.toBe("rule"); // brand registry may still match, but not the keyword rule
  });

  it("adds the user's own merchants and removes them again", async () => {
    await setMerchantRule("Kaur's Kitchen Pvt Ltd", "Food");
    expect(await rule("kaur's kitchen")).toMatchObject({ source: "custom", categoryName: "Food" });
    expect((await categorizeByMerchant(U, "KAUR'S KITCHEN HSR")).categoryId).toBe(await catId("Food"));
    await resetOrRemoveMerchantRule("kaur's kitchen");
    expect((await listMerchantRules()).some((r) => r.keyword === "kaur's kitchen")).toBe(false);
  });

  it("prefers the longest matching rule", async () => {
    await setMerchantRule("swiggy instamart", "Grocery & Supplies");
    expect((await findRuleForMerchant("SWIGGY INSTAMART"))?.categoryName).toBe("Grocery & Supplies");
    expect((await findRuleForMerchant("SWIGGY"))?.categoryName).toBe("Food");
  });

  it("an explicit rule clears an older learned habit for the same merchant", async () => {
    for (let i = 0; i < 3; i++) await recordCategoryCorrection(U, "swiggy", await catId("Shopping & Gifts"));
    expect((await listLearnedMerchants()).find((l) => l.keyword === "swiggy")?.count).toBe(3);
    await setMerchantRule("swiggy", "Dining");
    expect((await listLearnedMerchants()).some((l) => l.keyword === "swiggy")).toBe(false);
    expect((await categorizeByMerchant(U, "swiggy")).categoryId).toBe(await catId("Dining"));
  });

  it("learned habits can be forgotten", async () => {
    await recordCategoryCorrection(U, "chai point", await catId("Food"));
    const [l] = await listLearnedMerchants();
    await forgetLearnedMerchant(l.id);
    expect(await listLearnedMerchants()).toEqual([]);
  });

  it("renaming a category carries its rules; a missing category is flagged", async () => {
    const before = await countMerchantRulesForCategory("Food");
    expect(before).toBeGreaterThan(5);
    await updateCategory(await catId("Food"), { name: "Eating out" });
    expect(await countMerchantRulesForCategory("Eating out")).toBe(before);
    expect((await categorizeByMerchant(U, "zomato")).categoryId).toBe(await catId("Eating out"));

    await updateCategory(await catId("Eating out"), { is_active: 0 });
    expect((await rule("swiggy")).categoryMissing).toBe(true);
    await moveMerchantRules("Eating out", "Dining");
    expect(await rule("swiggy")).toMatchObject({ categoryName: "Dining", categoryMissing: false });
  });
});
