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
  applyRuleToPastTransactions, countMerchantRulesForCategory, countPastTransactionsForRule, findRuleForMerchant,
  forgetLearnedMerchant, keywordForAlwaysFile, keywordFromMerchant, listLearnedMerchants,
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
  // The bundled brand registry (exact SMS spellings like PYU*Swiggy Food), as the app seeds it.
  const brands = require("../../assets/data/merchant-brands.json").entries as Array<Record<string, string | null>>;
  const ins = mockDb.prepare(
    "INSERT OR IGNORE INTO merchant_brand_registry (id, brand_canonical, alias, category_name, mcc_code, source_version) VALUES (?, ?, ?, ?, ?, 'test');",
  );
  for (const b of brands) ins.run(b.id, b.brand_canonical, b.alias, b.category_name, b.mcc_code ?? null);
});

const addSpend = (id: string, merchant: string, category: string | null, extra = "") =>
  mockDb.exec(
    `INSERT INTO expenses (id, user_id, amount, merchant_name, category_id, date, nature, status, source${extra ? ", applied_rule_id" : ""})
     VALUES ('${id}', '${U}', 100, '${merchant}', ${category ? `'${category}'` : "NULL"}, '2026-09-10', 'realized', 'approved', 'sms_auto'${extra ? `, '${extra}'` : ""});`,
  );

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

  it("turning a rule off really stops it filing, brand spellings included", async () => {
    await setMerchantRuleActive("swiggy", false);
    expect(await rule("swiggy")).toMatchObject({ isActive: false, source: "edited" });
    // Before the fix the brand registry caught these and put them back in Food.
    for (const m of ["SWIGGY", "PYU*Swiggy Food", "SWIGGY BANGALORE"]) {
      expect((await categorizeByMerchant(U, m)).categoryId).toBeNull();
    }
    // A longer, still-on rule is unaffected.
    expect((await categorizeByMerchant(U, "SWIGGY INSTAMART")).categoryId).toBe(await catId("Grocery & Supplies"));
  });

  it("'Always file' changes the rule that covers the merchant, so every spelling follows", async () => {
    const keyword = await keywordForAlwaysFile("RSP*SWIGGY PVT LTD");
    expect(keyword).toBe("swiggy");
    await setMerchantRule(keyword, "Dining");
    for (const m of ["RSP*SWIGGY PVT LTD", "SWIGGY BANGALORE", "PYU*Swiggy Food"]) {
      expect((await categorizeByMerchant(U, m)).categoryId).toBe(await catId("Dining"));
    }
    expect((await listMerchantRules()).some((r) => r.keyword.startsWith("rsp"))).toBe(false);
  });

  it("makes a clean keyword from a messy SMS merchant when no rule covers it", async () => {
    expect(keywordFromMerchant("RSP*KAURS KITCHEN 560102")).toBe("kaurs kitchen");
    expect(keywordFromMerchant("PYU*Chai Shop 12-34")).toBe("chai shop");
    expect(await keywordForAlwaysFile("RSP*KAURS KITCHEN 560102")).toBe("kaurs kitchen");
  });

  it("moves past transactions the rule covers, but not ones a longer rule or a Smart Rule owns", async () => {
    const food = await catId("Food");
    addSpend("e1", "SWIGGY BANGALORE", food);
    addSpend("e2", "PYU*Swiggy Food", food);
    addSpend("e3", "SWIGGY INSTAMART", await catId("Grocery & Supplies")); // longer rule owns it
    addSpend("e4", "SWIGGY", food, "smart-rule-1"); // a Smart Rule filed it
    addSpend("e5", "ZOMATO", food); // different merchant
    await setMerchantRule("swiggy", "Dining");
    expect(await countPastTransactionsForRule("swiggy", "Dining")).toBe(2);
    expect(await applyRuleToPastTransactions("swiggy", "Dining")).toBe(2);
    const cat = (id: string) => (mockDb.prepare("SELECT category_id c FROM expenses WHERE id = ?").get(id) as { c: string }).c;
    expect([cat("e1"), cat("e2")]).toEqual([await catId("Dining"), await catId("Dining")]);
    expect(cat("e3")).toBe(await catId("Grocery & Supplies"));
    expect(cat("e4")).toBe(food);
    expect(cat("e5")).toBe(food);
    expect(await countPastTransactionsForRule("swiggy", "Dining")).toBe(0);
  });

  it("knows Indian store brands from OpenStreetMap, matched as whole words", async () => {
    expect((await categorizeByMerchant(U, "THEOBROMA FOODS BANDRA")).categoryId).toBe(await catId("Food"));
    expect((await categorizeByMerchant(U, "RSP*TANISHQ JEWELLERY")).categoryId).toBe(await catId("Shopping & Gifts"));
    expect((await categorizeByMerchant(U, "METRO SHOES PHOENIX")).categoryId).toBe(await catId("Shopping & Gifts"));
    expect((await categorizeByMerchant(U, "AIRTEL PAYMENTS")).categoryId).toBe(await catId("Rent & Utilities"));
    // Whole words only: no store brand hiding inside other words
    // ("metro rail" is the hand-written "metro" → Travel rule, not the "metro shoes" store)
    expect((await categorizeByMerchant(U, "BANGALORE METRO RAIL")).categoryId).toBe(await catId("Travel & Going Out"));
    expect((await categorizeByMerchant(U, "TANISHQUE TRADERS")).categoryId).toBeNull();
    expect(await rule("theobroma")).toMatchObject({ source: "builtin", matchMode: "word" });
  });

  it("OpenStreetMap brands can be changed and turned off like any built-in", async () => {
    await setMerchantRule("theobroma", "Dining");
    expect(await rule("theobroma")).toMatchObject({ source: "edited", categoryName: "Dining", matchMode: "word" });
    await setMerchantRuleActive("theobroma", false);
    expect((await categorizeByMerchant(U, "THEOBROMA FOODS")).categoryId).toBeNull();
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
