/**
 * Category service tests.
 * Mock the database module to test CRUD logic without a real SQLite instance.
 */

import { DEFAULT_CATEGORIES } from "../../database/defaults/categories";

// Track all SQL operations
let executedRuns: { sql: string; params: unknown[] }[] = [];
let mockRows: Record<string, unknown[]> = {};
let allAsyncDefault: unknown[] = [];

const mockDb = {
  getAllAsync: jest.fn(async (sql: string, ..._params: unknown[]) => {
    return mockRows[sql] ?? allAsyncDefault;
  }),
  getFirstAsync: jest.fn(async (sql: string, ..._params: unknown[]) => {
    const rows = mockRows[sql] ?? [];
    return rows[0] ?? null;
  }),
  runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    executedRuns.push({ sql, params });
    return { changes: 1, lastInsertRowId: 1 };
  }),
};

// Mock the database module
jest.mock("../../database", () => ({
  getDatabase: () => mockDb,
}));

// Mock UUID to return predictable values
// Variable must be prefixed with "mock" for jest.mock() factory scope
let mockUuidCounter = 0;
jest.mock("../../utils/uuid", () => ({
  generateUUID: () => `test-uuid-${++mockUuidCounter}`,
}));

import {
  getCategories,
  getAllCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  seedDefaultCategories,
} from "../../services/category";

beforeEach(() => {
  executedRuns = [];
  mockRows = {};
  allAsyncDefault = [];
  mockUuidCounter = 0;
  jest.clearAllMocks();
});

describe("getCategories", () => {
  it("queries active categories ordered by sort_order", async () => {
    await getCategories("user-1");
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("is_active = 1"),
      "user-1",
    );
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY sort_order"),
      "user-1",
    );
  });
});

describe("getAllCategories", () => {
  it("queries all categories including inactive", async () => {
    await getAllCategories("user-1");
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.not.stringContaining("is_active"),
      "user-1",
    );
  });
});

describe("getCategoryById", () => {
  it("queries by ID", async () => {
    await getCategoryById("cat-1");
    expect(mockDb.getFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = ?"),
      "cat-1",
    );
  });
});

describe("createCategory", () => {
  it("inserts with generated UUID and auto sort_order", async () => {
    // Mock max sort_order query
    mockRows["SELECT MAX(sort_order) as max_order FROM categories WHERE user_id = ?;"] = [
      { max_order: 5 },
    ];

    const id = await createCategory({
      user_id: "user-1",
      name: "New Category",
      icon: "star-outline",
      color: "#FF0000",
    });

    expect(id).toBe("test-uuid-1");

    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO categories"));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain("user-1");
    expect(insert!.params).toContain("New Category");
    expect(insert!.params).toContain("star-outline");
    expect(insert!.params).toContain("#FF0000");
    expect(insert!.params).toContain(6); // sort_order = 5 + 1
  });

  it("uses default icon and color when not provided", async () => {
    const id = await createCategory({
      user_id: "user-1",
      name: "Basic",
    });

    expect(id).toBe("test-uuid-1");
    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO categories"));
    expect(insert!.params).toContain("ellipsis-horizontal-circle-outline");
    expect(insert!.params).toContain("#6B7280");
  });
});

describe("updateCategory", () => {
  it("updates only provided fields", async () => {
    await updateCategory("cat-1", { name: "Renamed", color: "#00FF00" });

    const update = executedRuns.find((r) => r.sql.includes("UPDATE categories"));
    expect(update).toBeDefined();
    expect(update!.sql).toContain("name = ?");
    expect(update!.sql).toContain("color = ?");
    expect(update!.sql).not.toContain("icon = ?");
    expect(update!.params).toEqual(["Renamed", "#00FF00", "cat-1"]);
  });

  it("does nothing when no fields provided", async () => {
    await updateCategory("cat-1", {});
    expect(executedRuns.length).toBe(0);
  });
});

describe("deleteCategory", () => {
  it("soft-deletes by setting is_active = 0", async () => {
    mockRows["SELECT COUNT(*) as count FROM expenses WHERE category_id = ? AND nature = 'realized' AND deleted_at IS NULL;"] = [
      { count: 3 },
    ];

    const linkedCount = await deleteCategory("cat-1");

    expect(linkedCount).toBe(3);
    const update = executedRuns.find((r) => r.sql.includes("UPDATE categories SET is_active = 0"));
    expect(update).toBeDefined();
  });
});

describe("seedDefaultCategories", () => {
  it("seeds 13 categories when user has none", async () => {
    mockRows["SELECT COUNT(*) as count FROM categories WHERE user_id = ?;"] = [
      { count: 0 },
    ];

    const count = await seedDefaultCategories("user-1");

    expect(count).toBe(13);
    const inserts = executedRuns.filter((r) =>
      r.sql.includes("INSERT INTO categories"),
    );
    expect(inserts.length).toBe(13);

    // Verify first category matches template
    expect(inserts[0].params).toContain("user-1");
    expect(inserts[0].params).toContain(DEFAULT_CATEGORIES[0].name);
    expect(inserts[0].params).toContain(DEFAULT_CATEGORIES[0].icon);
    expect(inserts[0].params).toContain(DEFAULT_CATEGORIES[0].color);
  });

  it("skips seeding when user already has categories", async () => {
    mockRows["SELECT COUNT(*) as count FROM categories WHERE user_id = ?;"] = [
      { count: 5 },
    ];

    const count = await seedDefaultCategories("user-1");

    expect(count).toBe(0);
    expect(executedRuns.length).toBe(0);
  });
});

describe("DEFAULT_CATEGORIES", () => {
  it("has exactly 13 categories", () => {
    expect(DEFAULT_CATEGORIES.length).toBe(13);
  });

  it("all categories have required fields", () => {
    DEFAULT_CATEGORIES.forEach((cat) => {
      expect(cat.name).toBeTruthy();
      expect(cat.icon).toBeTruthy();
      expect(cat.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect([0, 1]).toContain(cat.is_unavoidable);
    });
  });
});
