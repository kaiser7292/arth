/**
 * LifeMilestone + MilestoneContribution service tests.
 * Mocks the database module to test CRUD logic without a real SQLite instance.
 */

let executedRuns: { sql: string; params: unknown[] }[] = [];
let mockRows: Record<string, unknown[]> = {};

const mockDb = {
  getAllAsync: jest.fn(async (sql: string) => {
    return mockRows[sql] ?? [];
  }),
  getFirstAsync: jest.fn(async (sql: string) => {
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
  generateUUID: () => `test-uuid-${++mockUuidCounter}`,
}));

import {
  getLifeMilestones,
  getLifeMilestoneById,
  createLifeMilestone,
  updateLifeMilestone,
  deleteLifeMilestone,
  getMilestoneContributions,
  createMilestoneContribution,
  deleteMilestoneContribution,
} from "../../services/life-milestone";

beforeEach(() => {
  executedRuns = [];
  mockRows = {};
  mockUuidCounter = 0;
  jest.clearAllMocks();
});

// ─── LifeMilestone CRUD ─────────────────────────────────────

describe("LifeMilestone", () => {
  describe("getLifeMilestones", () => {
    it("queries milestones ordered by sort_order", async () => {
      await getLifeMilestones("user-1");
      expect(mockDb.getAllAsync).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY sort_order ASC"),
        "user-1",
      );
    });
  });

  describe("getLifeMilestoneById", () => {
    it("queries by ID", async () => {
      await getLifeMilestoneById("ms-1");
      expect(mockDb.getFirstAsync).toHaveBeenCalledWith(
        expect.stringContaining("WHERE id = ?"),
        "ms-1",
      );
    });
  });

  describe("createLifeMilestone", () => {
    it("inserts with auto sort_order and defaults", async () => {
      mockRows[
        "SELECT MAX(sort_order) as max_order FROM life_milestones WHERE user_id = ?;"
      ] = [{ max_order: 1 }];

      const id = await createLifeMilestone({
        user_id: "user-1",
        name: "Car Down Payment",
        target_amount: 700000,
      });

      expect(id).toBe("test-uuid-1");

      const insert = executedRuns.find((r) =>
        r.sql.includes("INSERT INTO life_milestones"),
      );
      expect(insert).toBeDefined();
      expect(insert!.params).toContain("user-1");
      expect(insert!.params).toContain("Car Down Payment");
      expect(insert!.params).toContain(700000);
      expect(insert!.params).toContain(null); // target_date default
      expect(insert!.params).toContain(0); // monthly_contribution_planned default
      expect(insert!.params).toContain(2); // sort_order = 1 + 1
    });

    it("uses provided optional fields", async () => {
      await createLifeMilestone({
        user_id: "user-1",
        name: "House Down Payment",
        target_amount: 3800000,
        target_date: "2030-06-30",
        monthly_contribution_planned: 50000,
        sort_order: 0,
      });

      const insert = executedRuns.find((r) =>
        r.sql.includes("INSERT INTO life_milestones"),
      );
      expect(insert!.params).toContain("2030-06-30");
      expect(insert!.params).toContain(50000);
      expect(insert!.params).toContain(0); // explicit sort_order
    });
  });

  describe("updateLifeMilestone", () => {
    it("updates only provided fields", async () => {
      await updateLifeMilestone("ms-1", {
        name: "Updated Milestone",
        target_amount: 800000,
        is_completed: 1,
        completed_date: "2026-12-01",
      });

      const update = executedRuns.find((r) =>
        r.sql.includes("UPDATE life_milestones"),
      );
      expect(update!.sql).toContain("name = ?");
      expect(update!.sql).toContain("target_amount = ?");
      expect(update!.sql).toContain("is_completed = ?");
      expect(update!.sql).toContain("completed_date = ?");
      expect(update!.sql).not.toContain("monthly_contribution_planned = ?");
    });

    it("does nothing when no fields provided", async () => {
      await updateLifeMilestone("ms-1", {});
      expect(executedRuns.length).toBe(0);
    });
  });

  describe("deleteLifeMilestone", () => {
    it("deletes contributions first then the milestone", async () => {
      await deleteLifeMilestone("ms-1");
      expect(executedRuns.length).toBe(2);
      expect(executedRuns[0].sql).toContain(
        "DELETE FROM milestone_contributions",
      );
      expect(executedRuns[1].sql).toContain("DELETE FROM life_milestones");
    });
  });
});

// ─── MilestoneContribution CRUD ─────────────────────────────

describe("MilestoneContribution", () => {
  describe("getMilestoneContributions", () => {
    it("queries by milestone_id ordered by date DESC", async () => {
      await getMilestoneContributions("ms-1");
      expect(mockDb.getAllAsync).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY date DESC"),
        "ms-1",
      );
    });
  });

  describe("createMilestoneContribution", () => {
    it("inserts and recalculates milestone total", async () => {
      const id = await createMilestoneContribution({
        life_milestone_id: "ms-1",
        month: "2026-04",
        amount: 25000,
        date: "2026-04-15",
      });

      expect(id).toBe("test-uuid-1");

      const insert = executedRuns.find((r) =>
        r.sql.includes("INSERT INTO milestone_contributions"),
      );
      expect(insert!.params).toContain("ms-1");
      expect(insert!.params).toContain(25000);
      expect(insert!.params).toContain("2026-04");

      // Should update milestone's current_saved
      const updateMs = executedRuns.find((r) =>
        r.sql.includes("UPDATE life_milestones SET current_saved"),
      );
      expect(updateMs).toBeDefined();
    });
  });

  describe("deleteMilestoneContribution", () => {
    it("deletes and recalculates milestone total", async () => {
      await deleteMilestoneContribution("contrib-1", "ms-1");

      const del = executedRuns.find((r) =>
        r.sql.includes("DELETE FROM milestone_contributions WHERE id"),
      );
      expect(del).toBeDefined();

      const updateMs = executedRuns.find((r) =>
        r.sql.includes("UPDATE life_milestones SET current_saved"),
      );
      expect(updateMs).toBeDefined();
    });
  });
});
