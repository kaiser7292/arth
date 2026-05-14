/**
 * Tags service integration tests.
 * Mock the database module to test CRUD logic without a real SQLite instance.
 */

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

jest.mock("../../database", () => ({
  getDatabase: () => mockDb,
}));

let mockUuidCounter = 0;
jest.mock("../../utils/uuid", () => ({
  generateUUID: () => `tag-uuid-${++mockUuidCounter}`,
}));

import {
  getTags,
  getTagsForExpense,
  createTag,
  findOrCreateTag,
  addTagToExpense,
  removeTagFromExpense,
  deleteTag,
  updateTag,
  getTagUsageCount,
} from "../../services/tags";

beforeEach(() => {
  executedRuns = [];
  mockRows = {};
  allAsyncDefault = [];
  mockUuidCounter = 0;
  jest.clearAllMocks();
});

describe("getTags", () => {
  it("fetches all tags for a user", async () => {
    allAsyncDefault = [
      { id: "t1", user_id: "u1", name: "Work", color: "#3B82F6", created_at: "2026-04-13" },
      { id: "t2", user_id: "u1", name: "Personal", color: "#10B981", created_at: "2026-04-13" },
    ];

    const tags = await getTags("u1");
    expect(tags).toHaveLength(2);
    expect(tags[0].name).toBe("Work");
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("SELECT"),
      "u1",
    );
  });
});

describe("createTag", () => {
  it("creates a tag with given name and color", async () => {
    await createTag("u1", "Travel", "#F59E0B");
    expect(executedRuns).toHaveLength(1);
    expect(executedRuns[0].sql).toContain("INSERT INTO tags");
    expect(executedRuns[0].params).toEqual(
      expect.arrayContaining(["u1", "Travel", "#F59E0B"]),
    );
  });

  it("assigns a default color if none provided", async () => {
    await createTag("u1", "Work");
    expect(executedRuns).toHaveLength(1);
    // Color should be from TAG_COLORS palette
    const colorParam = executedRuns[0].params.find(
      (p) => typeof p === "string" && (p as string).startsWith("#"),
    );
    expect(colorParam).toBeDefined();
  });
});

describe("findOrCreateTag", () => {
  it("returns existing tag if found", async () => {
    // findOrCreateTag uses getFirstAsync to look up by name
    mockDb.getFirstAsync.mockResolvedValueOnce(
      { id: "t1", user_id: "u1", name: "Work", color: "#3B82F6", created_at: "2026-04-13" },
    );

    const tag = await findOrCreateTag("u1", "Work");
    expect(tag.id).toBe("t1");
    expect(executedRuns).toHaveLength(0); // No INSERT
  });

  it("creates tag when not found", async () => {
    // getFirstAsync returns null (tag not found), then returns count for color selection
    mockDb.getFirstAsync
      .mockResolvedValueOnce(null)  // findOrCreateTag lookup
      .mockResolvedValueOnce({ count: 0 });  // createTag color count

    const tag = await findOrCreateTag("u1", "New");
    expect(executedRuns.length).toBeGreaterThanOrEqual(1);
    expect(tag.name).toBe("New");
  });
});

describe("addTagToExpense / removeTagFromExpense", () => {
  it("adds a tag-expense association", async () => {
    await addTagToExpense("e1", "t1");
    expect(executedRuns).toHaveLength(1);
    expect(executedRuns[0].sql).toContain("INSERT");
    expect(executedRuns[0].sql).toContain("expense_tags");
  });

  it("removes a tag-expense association", async () => {
    await removeTagFromExpense("e1", "t1");
    expect(executedRuns).toHaveLength(1);
    expect(executedRuns[0].sql).toContain("DELETE");
    expect(executedRuns[0].sql).toContain("expense_tags");
  });
});

describe("getTagsForExpense", () => {
  it("fetches tags linked to an expense", async () => {
    mockDb.getAllAsync.mockResolvedValueOnce([
      { id: "t1", user_id: "u1", name: "Work", color: "#3B82F6", created_at: "2026-04-13" },
    ]);

    const tags = await getTagsForExpense("e1");
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe("Work");
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("expense_tags"),
      "e1",
    );
  });
});

describe("deleteTag", () => {
  it("deletes join rows first, then the tag itself", async () => {
    await deleteTag("t1");
    expect(executedRuns).toHaveLength(2);
    expect(executedRuns[0].sql).toContain("DELETE FROM expense_tags");
    expect(executedRuns[1].sql).toContain("DELETE FROM tags");
  });
});

describe("updateTag", () => {
  it("updates tag name and color", async () => {
    await updateTag("t1", { name: "Updated", color: "#EF4444" });
    expect(executedRuns).toHaveLength(1);
    expect(executedRuns[0].sql).toContain("UPDATE tags");
    expect(executedRuns[0].params).toEqual(
      expect.arrayContaining(["Updated", "#EF4444"]),
    );
  });

  it("updates only name when color not provided", async () => {
    await updateTag("t1", { name: "OnlyName" });
    expect(executedRuns).toHaveLength(1);
    expect(executedRuns[0].sql).toContain("UPDATE tags");
    expect(executedRuns[0].params).toEqual(
      expect.arrayContaining(["OnlyName"]),
    );
  });
});

describe("getTagUsageCount", () => {
  it("returns the number of expenses using a tag", async () => {
    mockDb.getFirstAsync.mockResolvedValueOnce({ count: 5 });
    const count = await getTagUsageCount("t1");
    expect(count).toBe(5);
  });

  it("returns 0 when tag has no usage", async () => {
    mockDb.getFirstAsync.mockResolvedValueOnce({ count: 0 });
    const count = await getTagUsageCount("t1");
    expect(count).toBe(0);
  });
});
