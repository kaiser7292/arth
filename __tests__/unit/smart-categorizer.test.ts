/**
 * Tests for the Smart Categorization Engine.
 *
 * Tests cover:
 * - Merchant name normalization
 * - Merchant extraction from expense descriptions
 * - Rule-based categorization (Layer 1)
 * - User correction recording and learning (Layer 2)
 * - Edge cases (no merchant, unknown merchant, low confidence)
 */

import {
  normalizeMerchant,
  extractMerchantFromDescription,
  categorizeByMerchant,
  recordCategoryCorrection,
  seedMerchantMappings,
} from "../../services/smart-categorizer";
import { DEFAULT_MERCHANT_MAPPINGS } from "../../database/defaults/merchant-mappings";

// ─── Mock database ───

let mockDbRows: Record<string, unknown[]> = {};
let mockDbInserts: { sql: string; params: unknown[] }[] = [];

jest.mock("@/database", () => ({
  getDatabase: () => ({
    getAllAsync: jest.fn(async (sql: string) => {
      return mockDbRows[sql] ?? mockDbRows["__all__"] ?? [];
    }),
    getFirstAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
      // Build a key from sql + params for specific lookups
      const key = `${sql}|${JSON.stringify(params)}`;
      if (mockDbRows[key]) return mockDbRows[key][0] ?? null;
      if (mockDbRows[sql]) return mockDbRows[sql][0] ?? null;
      return null;
    }),
    runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
      mockDbInserts.push({ sql, params });
    }),
  }),
}));

jest.mock("@/utils/uuid", () => ({
  generateUUID: () => "test-uuid-" + Math.random().toString(36).slice(2, 8),
}));

function resetMocks() {
  mockDbRows = {};
  mockDbInserts = [];
}

// ═══════════════════════════════════════════════
// Merchant Normalization
// ═══════════════════════════════════════════════

describe("normalizeMerchant", () => {
  it("lowercases merchant name", () => {
    expect(normalizeMerchant("ZOMATO LIMITED")).toBe("zomato");
  });

  it("strips 'Limited' suffix", () => {
    expect(normalizeMerchant("Swiggy Limited")).toBe("swiggy");
  });

  it("strips 'Pvt Ltd' suffix", () => {
    expect(normalizeMerchant("Blue Tokai Coffee Pvt Ltd")).toBe("blue tokai coffee");
  });

  it("strips 'Private Limited' suffix", () => {
    expect(normalizeMerchant("Zomato Private Limited")).toBe("zomato");
  });

  it("strips 'India' suffix", () => {
    expect(normalizeMerchant("UBER INDIA")).toBe("uber");
  });

  it("strips 'Payments' suffix", () => {
    expect(normalizeMerchant("NETFLIX PAYMENTS")).toBe("netflix");
  });

  it("strips 'Services' suffix", () => {
    expect(normalizeMerchant("AMAZON SERVICES")).toBe("amazon");
  });

  it("handles 'Inc' suffix", () => {
    expect(normalizeMerchant("Spotify Inc")).toBe("spotify");
  });

  it("trims whitespace", () => {
    expect(normalizeMerchant("  Swiggy  ")).toBe("swiggy");
  });

  it("handles empty string", () => {
    expect(normalizeMerchant("")).toBe("");
  });

  it("chains multiple suffix strippings", () => {
    // "PRIVATE LIMITED" stripped, but "INDIA" stays because it's not at the end
    expect(normalizeMerchant("UBER INDIA SYST PRIVATE LIMITED")).toBe("uber india syst");
  });
});

// ═══════════════════════════════════════════════
// Extract Merchant from Description
// ═══════════════════════════════════════════════

describe("extractMerchantFromDescription", () => {
  it("extracts merchant before 'via'", () => {
    expect(extractMerchantFromDescription("ZOMATO LIMITED via ICICI Bank ****3001")).toBe(
      "ZOMATO LIMITED",
    );
  });

  it("returns full description when no 'via'", () => {
    expect(extractMerchantFromDescription("Manual grocery purchase")).toBe(
      "Manual grocery purchase",
    );
  });

  it("strips (Standing Instruction) suffix", () => {
    expect(
      extractMerchantFromDescription("NETFLIX via ICICI Bank ****3001 (Standing Instruction)"),
    ).toBe("NETFLIX");
  });

  it("strips (Upcoming SI) suffix", () => {
    expect(
      extractMerchantFromDescription("NETFLIX via ICICI ****3001 (Upcoming SI)"),
    ).toBe("NETFLIX");
  });

  it("strips (EMI Due) suffix", () => {
    expect(
      extractMerchantFromDescription("Axis Bank Loan via Axis ****7249 (EMI Due)"),
    ).toBe("Axis Bank Loan");
  });

  it("strips (Amount Due) suffix", () => {
    expect(
      extractMerchantFromDescription("HDFC Credit Card via HDFC ****8957 (Amount Due)"),
    ).toBe("HDFC Credit Card");
  });

  it("handles description without bank info", () => {
    expect(extractMerchantFromDescription("Swiggy delivery")).toBe("Swiggy delivery");
  });
});

// ═══════════════════════════════════════════════
// Rule-based Categorization (Layer 1)
// ═══════════════════════════════════════════════

describe("categorizeByMerchant — rule-based", () => {
  beforeEach(() => {
    resetMocks();

    // Mock merchant_mappings table with a few entries
    mockDbRows[
      "SELECT keyword, category_name, confidence FROM merchant_mappings WHERE is_active = 1;"
    ] = [
      { keyword: "swiggy", category_name: "Food", confidence: 0.95 },
      { keyword: "zomato", category_name: "Food", confidence: 0.95 },
      { keyword: "netflix", category_name: "Subscriptions", confidence: 0.95 },
      { keyword: "shell", category_name: "Car & Vehicles", confidence: 0.9 },
      { keyword: "apollo", category_name: "Health & Medicine", confidence: 0.85 },
      { keyword: "amazon", category_name: "Shopping & Gifts", confidence: 0.85 },
      { keyword: "amazon prime", category_name: "Subscriptions", confidence: 0.9 },
      { keyword: "food", category_name: "Food", confidence: 0.75 },
    ];
  });

  it("returns none for null merchant", async () => {
    const result = await categorizeByMerchant("user1", null);
    expect(result.source).toBe("none");
    expect(result.categoryId).toBeNull();
  });

  it("returns none for empty merchant", async () => {
    const result = await categorizeByMerchant("user1", "");
    expect(result.source).toBe("none");
    expect(result.categoryId).toBeNull();
  });

  it("matches Swiggy to Food", async () => {
    // Mock category lookup: "Food" → "cat-food-id"
    mockDbRows[
      `SELECT id FROM categories WHERE user_id = ? AND name = ? AND is_active = 1;|["user1","Food"]`
    ] = [{ id: "cat-food-id" }];

    const result = await categorizeByMerchant("user1", "SWIGGY");
    expect(result.source).toBe("rule");
    expect(result.categoryId).toBe("cat-food-id");
    expect(result.categoryName).toBe("Food");
    expect(result.confidence).toBe(0.95);
  });

  it("matches Zomato Limited to Food (strips suffix)", async () => {
    mockDbRows[
      `SELECT id FROM categories WHERE user_id = ? AND name = ? AND is_active = 1;|["user1","Food"]`
    ] = [{ id: "cat-food-id" }];

    const result = await categorizeByMerchant("user1", "ZOMATO LIMITED");
    expect(result.source).toBe("rule");
    expect(result.categoryId).toBe("cat-food-id");
    expect(result.categoryName).toBe("Food");
  });

  it("matches Netflix to Subscriptions", async () => {
    mockDbRows[
      `SELECT id FROM categories WHERE user_id = ? AND name = ? AND is_active = 1;|["user1","Subscriptions"]`
    ] = [{ id: "cat-subs-id" }];

    const result = await categorizeByMerchant("user1", "NETFLIX PAYMENTS");
    expect(result.source).toBe("rule");
    expect(result.categoryId).toBe("cat-subs-id");
    expect(result.categoryName).toBe("Subscriptions");
  });

  it("prefers longer keyword match (amazon prime > amazon)", async () => {
    mockDbRows[
      `SELECT id FROM categories WHERE user_id = ? AND name = ? AND is_active = 1;|["user1","Subscriptions"]`
    ] = [{ id: "cat-subs-id" }];

    const result = await categorizeByMerchant("user1", "Amazon Prime Video");
    expect(result.source).toBe("rule");
    expect(result.categoryName).toBe("Subscriptions");
  });

  it("returns none for unknown merchant", async () => {
    const result = await categorizeByMerchant("user1", "RANDOM UNKNOWN MERCHANT");
    expect(result.source).toBe("none");
    expect(result.categoryId).toBeNull();
  });

  it("returns none when user has no matching category", async () => {
    // No mock for category lookup → getFirstAsync returns null
    const result = await categorizeByMerchant("user1", "Shell Petrol");
    expect(result.source).toBe("none");
    expect(result.categoryId).toBeNull();
  });
});

// ═══════════════════════════════════════════════
// Learned Categorization (Layer 2)
// ═══════════════════════════════════════════════

describe("categorizeByMerchant — learned", () => {
  beforeEach(() => {
    resetMocks();

    // Mock merchant_mappings (rules)
    mockDbRows[
      "SELECT keyword, category_name, confidence FROM merchant_mappings WHERE is_active = 1;"
    ] = [{ keyword: "swiggy", category_name: "Food", confidence: 0.95 }];
  });

  it("uses learned mapping when correction_count >= threshold", async () => {
    // Mock: user has corrected "swiggy" 3 times to "Travel & Going Out"
    const correctionQuery = `SELECT category_id, correction_count FROM merchant_corrections
     WHERE user_id = ? AND merchant_keyword = ? AND correction_count >= ?;`;
    mockDbRows[`${correctionQuery}|["user1","swiggy",3]`] = [
      { category_id: "cat-travel-id", correction_count: 3 },
    ];

    const result = await categorizeByMerchant("user1", "SWIGGY");
    expect(result.source).toBe("learned");
    expect(result.categoryId).toBe("cat-travel-id");
    expect(result.confidence).toBe(0.98);
  });

  it("falls back to rule when correction_count < threshold", async () => {
    // No learned mapping returned (count < threshold)
    // Rule match will look up category
    mockDbRows[
      `SELECT id FROM categories WHERE user_id = ? AND name = ? AND is_active = 1;|["user1","Food"]`
    ] = [{ id: "cat-food-id" }];

    const result = await categorizeByMerchant("user1", "SWIGGY");
    expect(result.source).toBe("rule");
    expect(result.categoryId).toBe("cat-food-id");
  });
});

// ═══════════════════════════════════════════════
// Correction Recording
// ═══════════════════════════════════════════════

describe("recordCategoryCorrection", () => {
  beforeEach(resetMocks);

  it("creates new correction record for first correction", async () => {
    await recordCategoryCorrection("user1", "SWIGGY", "cat-travel-id");

    const insert = mockDbInserts.find((r) =>
      r.sql.includes("INSERT INTO merchant_corrections"),
    );
    expect(insert).toBeDefined();
    expect(insert!.params).toContain("user1");
    expect(insert!.params).toContain("swiggy");
    expect(insert!.params).toContain("cat-travel-id");
  });

  it("increments count for same category correction", async () => {
    // Mock existing correction with same category
    const selectQuery = `SELECT id, category_id, correction_count FROM merchant_corrections
     WHERE user_id = ? AND merchant_keyword = ?;`;
    mockDbRows[`${selectQuery}|["user1","swiggy"]`] = [
      { id: "corr-1", category_id: "cat-travel-id", correction_count: 2 },
    ];

    await recordCategoryCorrection("user1", "SWIGGY", "cat-travel-id");

    const update = mockDbInserts.find((r) =>
      r.sql.includes("correction_count = correction_count + 1"),
    );
    expect(update).toBeDefined();
    expect(update!.params).toContain("corr-1");
  });

  it("resets count when corrected to different category", async () => {
    // Mock existing correction with different category
    const selectQuery = `SELECT id, category_id, correction_count FROM merchant_corrections
     WHERE user_id = ? AND merchant_keyword = ?;`;
    mockDbRows[`${selectQuery}|["user1","swiggy"]`] = [
      { id: "corr-1", category_id: "cat-food-id", correction_count: 5 },
    ];

    await recordCategoryCorrection("user1", "SWIGGY", "cat-travel-id");

    const update = mockDbInserts.find((r) =>
      r.sql.includes("SET category_id = ?, correction_count = 1"),
    );
    expect(update).toBeDefined();
    expect(update!.params).toContain("cat-travel-id");
    expect(update!.params).toContain("corr-1");
  });

  it("does nothing for empty merchant", async () => {
    await recordCategoryCorrection("user1", "", "cat-food-id");
    expect(mockDbInserts.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// Default Merchant Mappings Data
// ═══════════════════════════════════════════════

describe("Default Merchant Mappings", () => {
  it("has 200+ entries", () => {
    expect(DEFAULT_MERCHANT_MAPPINGS.length).toBeGreaterThanOrEqual(200);
  });

  it("all entries have required fields", () => {
    for (const mapping of DEFAULT_MERCHANT_MAPPINGS) {
      expect(mapping.keyword).toBeTruthy();
      expect(mapping.categoryName).toBeTruthy();
      expect(mapping.confidence).toBeGreaterThan(0);
      expect(mapping.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("all keywords are lowercase", () => {
    for (const mapping of DEFAULT_MERCHANT_MAPPINGS) {
      expect(mapping.keyword).toBe(mapping.keyword.toLowerCase());
    }
  });

  it("has no duplicate keywords", () => {
    const keywords = DEFAULT_MERCHANT_MAPPINGS.map((m) => m.keyword);
    const unique = new Set(keywords);
    expect(unique.size).toBe(keywords.length);
  });

  it("maps to valid default category names", () => {
    const validCategories = new Set([
      "Car & Vehicles",
      "Health & Medicine",
      "Travel & Going Out",
      "Rent & Utilities",
      "Subscriptions",
      "Grocery & Supplies",
      "Food",
      "Shopping & Gifts",
      "Miscellaneous",
      "Insurance",
      "EMIs",
      "Unknown",
    ]);

    for (const mapping of DEFAULT_MERCHANT_MAPPINGS) {
      expect(validCategories.has(mapping.categoryName)).toBe(true);
    }
  });

  it("covers key Indian food delivery services", () => {
    const keywords = new Set(DEFAULT_MERCHANT_MAPPINGS.map((m) => m.keyword));
    expect(keywords.has("swiggy")).toBe(true);
    expect(keywords.has("zomato")).toBe(true);
  });

  it("covers key Indian e-commerce platforms", () => {
    const keywords = new Set(DEFAULT_MERCHANT_MAPPINGS.map((m) => m.keyword));
    expect(keywords.has("amazon")).toBe(true);
    expect(keywords.has("flipkart")).toBe(true);
    expect(keywords.has("myntra")).toBe(true);
  });

  it("covers streaming subscriptions", () => {
    const keywords = new Set(DEFAULT_MERCHANT_MAPPINGS.map((m) => m.keyword));
    expect(keywords.has("netflix")).toBe(true);
    expect(keywords.has("spotify")).toBe(true);
    expect(keywords.has("hotstar")).toBe(true);
  });

  it("covers fuel stations", () => {
    const keywords = new Set(DEFAULT_MERCHANT_MAPPINGS.map((m) => m.keyword));
    expect(keywords.has("shell")).toBe(true);
    expect(keywords.has("indian oil")).toBe(true);
    expect(keywords.has("bpcl")).toBe(true);
  });

  it("covers grocery delivery", () => {
    const keywords = new Set(DEFAULT_MERCHANT_MAPPINGS.map((m) => m.keyword));
    expect(keywords.has("bigbasket")).toBe(true);
    expect(keywords.has("blinkit")).toBe(true);
    expect(keywords.has("zepto")).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// Seed Merchant Mappings
// ═══════════════════════════════════════════════

describe("seedMerchantMappings", () => {
  beforeEach(resetMocks);

  it("seeds all default mappings when table is empty", async () => {
    // Mock empty table
    const countQuery = "SELECT COUNT(*) as count FROM merchant_mappings;";
    mockDbRows[countQuery] = [{ count: 0 }];

    await seedMerchantMappings();

    const inserts = mockDbInserts.filter((r) =>
      r.sql.includes("INSERT OR IGNORE INTO merchant_mappings"),
    );
    expect(inserts.length).toBe(DEFAULT_MERCHANT_MAPPINGS.length);
  });

  it("skips seeding when table already has data", async () => {
    const countQuery = "SELECT COUNT(*) as count FROM merchant_mappings;";
    mockDbRows[countQuery] = [{ count: 100 }];

    await seedMerchantMappings();

    const inserts = mockDbInserts.filter((r) =>
      r.sql.includes("INSERT OR IGNORE INTO merchant_mappings"),
    );
    expect(inserts.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// Unknown Category Fallback (Task 11.3)
// ═══════════════════════════════════════════════

describe("categorizeByMerchant — Unknown fallback", () => {
  beforeEach(() => {
    resetMocks();

    // Mock empty merchant_mappings (no rule matches)
    mockDbRows[
      "SELECT keyword, category_name, confidence FROM merchant_mappings WHERE is_active = 1;"
    ] = [];
  });

  it("returns none for unrecognized merchant so it lands in Uncategorized review", async () => {
    // Even with Unknown category seeded, unrecognized merchants must return
    // source='none' so the review queue's Uncategorized section can surface them.
    mockDbRows[
      `SELECT id FROM categories WHERE user_id = ? AND name = ? AND is_active = 1;|["user1","Unknown"]`
    ] = [{ id: "cat-unknown-id" }];

    const result = await categorizeByMerchant("user1", "RANDOM_MERCHANT_XYZ");
    expect(result.source).toBe("none");
    expect(result.categoryId).toBeNull();
  });

  it("returns none when Unknown category does not exist", async () => {
    const result = await categorizeByMerchant("user1", "RANDOM_MERCHANT_XYZ");
    expect(result.source).toBe("none");
    expect(result.categoryId).toBeNull();
  });

  it("prefers rule match over leaving uncategorized", async () => {
    // Add a rule match
    mockDbRows[
      "SELECT keyword, category_name, confidence FROM merchant_mappings WHERE is_active = 1;"
    ] = [{ keyword: "swiggy", category_name: "Food", confidence: 0.95 }];

    mockDbRows[
      `SELECT id FROM categories WHERE user_id = ? AND name = ? AND is_active = 1;|["user1","Food"]`
    ] = [{ id: "cat-food-id" }];

    // Also mock Unknown category (should NOT be used)
    mockDbRows[
      `SELECT id FROM categories WHERE user_id = ? AND name = ? AND is_active = 1;|["user1","Unknown"]`
    ] = [{ id: "cat-unknown-id" }];

    const result = await categorizeByMerchant("user1", "SWIGGY");
    expect(result.source).toBe("rule");
    expect(result.categoryId).toBe("cat-food-id");
  });

  it("prefers learned mapping over Unknown fallback", async () => {
    const correctionQuery = `SELECT category_id, correction_count FROM merchant_corrections
     WHERE user_id = ? AND merchant_keyword = ? AND correction_count >= ?;`;
    mockDbRows[`${correctionQuery}|["user1","newmerchant",3]`] = [
      { category_id: "cat-food-id", correction_count: 5 },
    ];

    // Also mock Unknown category (should NOT be used)
    mockDbRows[
      `SELECT id FROM categories WHERE user_id = ? AND name = ? AND is_active = 1;|["user1","Unknown"]`
    ] = [{ id: "cat-unknown-id" }];

    const result = await categorizeByMerchant("user1", "NEWMERCHANT");
    expect(result.source).toBe("learned");
    expect(result.categoryId).toBe("cat-food-id");
  });

  it("returns none when rule matches but user has no matching category", async () => {
    // Rule matches "shell" → "Car & Vehicles" but user doesn't have that category.
    // Stays uncategorized so review queue can surface it — no auto-fallback.
    mockDbRows[
      "SELECT keyword, category_name, confidence FROM merchant_mappings WHERE is_active = 1;"
    ] = [{ keyword: "shell", category_name: "Car & Vehicles", confidence: 0.9 }];

    mockDbRows[
      `SELECT id FROM categories WHERE user_id = ? AND name = ? AND is_active = 1;|["user1","Unknown"]`
    ] = [{ id: "cat-unknown-id" }];

    const result = await categorizeByMerchant("user1", "Shell Petrol");
    expect(result.source).toBe("none");
    expect(result.categoryId).toBeNull();
  });
});

// ═══════════════════════════════════════════════
// Enhanced Learning — last_corrected_at (Task 11.3)
// ═══════════════════════════════════════════════

describe("recordCategoryCorrection — last_corrected_at tracking", () => {
  beforeEach(resetMocks);

  it("sets last_corrected_at when incrementing same-category correction", async () => {
    const selectQuery = `SELECT id, category_id, correction_count FROM merchant_corrections
     WHERE user_id = ? AND merchant_keyword = ?;`;
    mockDbRows[`${selectQuery}|["user1","swiggy"]`] = [
      { id: "corr-1", category_id: "cat-food-id", correction_count: 2 },
    ];

    await recordCategoryCorrection("user1", "SWIGGY", "cat-food-id");

    const update = mockDbInserts.find((r) =>
      r.sql.includes("last_corrected_at = datetime('now')"),
    );
    expect(update).toBeDefined();
  });

  it("sets last_corrected_at when resetting to different category", async () => {
    const selectQuery = `SELECT id, category_id, correction_count FROM merchant_corrections
     WHERE user_id = ? AND merchant_keyword = ?;`;
    mockDbRows[`${selectQuery}|["user1","swiggy"]`] = [
      { id: "corr-1", category_id: "cat-food-id", correction_count: 5 },
    ];

    await recordCategoryCorrection("user1", "SWIGGY", "cat-travel-id");

    const update = mockDbInserts.find(
      (r) =>
        r.sql.includes("last_corrected_at = datetime('now')") &&
        r.sql.includes("correction_count = 1"),
    );
    expect(update).toBeDefined();
  });

  it("Unknown category can be corrected to real category via learning", async () => {
    // First correction: merchant was Unknown, user corrects to Food
    await recordCategoryCorrection("user1", "NEW_RESTAURANT", "cat-food-id");

    const insert = mockDbInserts.find((r) =>
      r.sql.includes("INSERT INTO merchant_corrections"),
    );
    expect(insert).toBeDefined();
    expect(insert!.params).toContain("new_restaurant");
    expect(insert!.params).toContain("cat-food-id");
  });
});

// ═══════════════════════════════════════════════
// Default Categories — Unknown included
// ═══════════════════════════════════════════════

describe("DEFAULT_CATEGORIES includes Unknown", () => {
  it("has 13 default categories (including Unknown)", () => {
    const { DEFAULT_CATEGORIES } = require("../../database/defaults/categories");
    expect(DEFAULT_CATEGORIES.length).toBe(13);
  });

  it("Unknown category has correct properties", () => {
    const { DEFAULT_CATEGORIES } = require("../../database/defaults/categories");
    const unknown = DEFAULT_CATEGORIES.find(
      (c: { name: string }) => c.name === "Unknown",
    );
    expect(unknown).toBeDefined();
    expect(unknown.icon).toBe("help-circle-outline");
    expect(unknown.color).toBe("#9CA3AF");
    expect(unknown.is_unavoidable).toBe(0);
  });
});
