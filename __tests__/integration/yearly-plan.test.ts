/**
 * YearlyPlan + InvestmentBucket + InvestmentContribution service tests.
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
  withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => {
    await fn();
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
  getYearlyPlans,
  getYearlyPlanById,
  getYearlyPlanByFY,
  createYearlyPlan,
  updateYearlyPlan,
  deleteYearlyPlan,
  getInvestmentBuckets,
  getInvestmentBucketById,
  createInvestmentBucket,
  updateInvestmentBucket,
  deleteInvestmentBucket,
  getInvestmentContributions,
  createInvestmentContribution,
  deleteInvestmentContribution,
} from "../../services/yearly-plan";

beforeEach(() => {
  executedRuns = [];
  mockRows = {};
  mockUuidCounter = 0;
  jest.clearAllMocks();
});

// ─── YearlyPlan CRUD ────────────────────────────────────────

describe("YearlyPlan", () => {
  describe("getYearlyPlans", () => {
    it("queries plans ordered by financial_year DESC", async () => {
      await getYearlyPlans("user-1");
      expect(mockDb.getAllAsync).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY financial_year DESC"),
        "user-1",
      );
    });
  });

  describe("getYearlyPlanById", () => {
    it("queries by ID", async () => {
      await getYearlyPlanById("plan-1");
      expect(mockDb.getFirstAsync).toHaveBeenCalledWith(
        expect.stringContaining("WHERE id = ?"),
        "plan-1",
      );
    });
  });

  describe("getYearlyPlanByFY", () => {
    it("queries by user_id and normalizes financial_year", async () => {
      await getYearlyPlanByFY("user-1", "2026-27");
      expect(mockDb.getFirstAsync).toHaveBeenCalledWith(
        expect.stringContaining("financial_year = ?"),
        "user-1",
        "2026",
        "2026-%",
      );
    });

    it("handles plain year format", async () => {
      await getYearlyPlanByFY("user-1", "2026");
      expect(mockDb.getFirstAsync).toHaveBeenCalledWith(
        expect.stringContaining("financial_year = ?"),
        "user-1",
        "2026",
        "2026-%",
      );
    });
  });

  describe("createYearlyPlan", () => {
    it("inserts with all required fields and defaults", async () => {
      const id = await createYearlyPlan({
        user_id: "user-1",
        financial_year: "2026-27",
        annual_salary_in_hand: 1800000,
        total_planned_expenses: 1360680,
        total_planned_investments: 302000,
        savings_rate_target_pct: 25,
      });

      expect(id).toBe("test-uuid-1");

      const insert = executedRuns.find((r) =>
        r.sql.includes("INSERT INTO yearly_plans"),
      );
      expect(insert).toBeDefined();
      expect(insert!.params).toContain("user-1");
      expect(insert!.params).toContain("2026-27");
      expect(insert!.params).toContain(1800000);
      expect(insert!.params).toContain(0); // default expected_bonus
      expect(insert!.params).toContain(25);
    });

    it("uses provided optional fields", async () => {
      await createYearlyPlan({
        user_id: "user-1",
        financial_year: "2026-27",
        annual_salary_in_hand: 1800000,
        expected_bonus: 200000,
        salary_hike_pct: 10,
        total_planned_expenses: 1360680,
        total_planned_investments: 302000,
        total_planned_milestones: 100000,
        savings_rate_target_pct: 25,
        notes: "Ambitious year",
      });

      const insert = executedRuns.find((r) =>
        r.sql.includes("INSERT INTO yearly_plans"),
      );
      expect(insert!.params).toContain(200000);
      expect(insert!.params).toContain(10);
      expect(insert!.params).toContain(100000);
      expect(insert!.params).toContain("Ambitious year");
    });
  });

  describe("updateYearlyPlan", () => {
    it("updates only provided fields", async () => {
      await updateYearlyPlan("plan-1", {
        annual_salary_in_hand: 2000000,
        savings_rate_target_pct: 30,
      });

      const update = executedRuns.find((r) =>
        r.sql.includes("UPDATE yearly_plans"),
      );
      expect(update).toBeDefined();
      expect(update!.sql).toContain("annual_salary_in_hand = ?");
      expect(update!.sql).toContain("savings_rate_target_pct = ?");
      expect(update!.sql).toContain("updated_at = datetime('now')");
      expect(update!.sql).not.toContain("notes = ?");
    });

    it("does nothing when no fields provided", async () => {
      await updateYearlyPlan("plan-1", {});
      expect(executedRuns.length).toBe(0);
    });
  });

  describe("deleteYearlyPlan", () => {
    it("cascades delete: contributions → buckets → plan", async () => {
      await deleteYearlyPlan("plan-1");

      expect(executedRuns.length).toBe(3);
      // First: delete investment contributions
      expect(executedRuns[0].sql).toContain(
        "DELETE FROM investment_contributions",
      );
      // Second: delete investment buckets
      expect(executedRuns[1].sql).toContain(
        "DELETE FROM investment_buckets",
      );
      // Third: delete the plan itself
      expect(executedRuns[2].sql).toContain("DELETE FROM yearly_plans");
    });
  });
});

// ─── InvestmentBucket CRUD ──────────────────────────────────

describe("InvestmentBucket", () => {
  describe("getInvestmentBuckets", () => {
    it("queries by yearly_plan_id ordered by sort_order", async () => {
      await getInvestmentBuckets("plan-1");
      expect(mockDb.getAllAsync).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY sort_order ASC"),
        "plan-1",
      );
    });
  });

  describe("getInvestmentBucketById", () => {
    it("queries by ID", async () => {
      await getInvestmentBucketById("bucket-1");
      expect(mockDb.getFirstAsync).toHaveBeenCalledWith(
        expect.stringContaining("WHERE id = ?"),
        "bucket-1",
      );
    });
  });

  describe("createInvestmentBucket", () => {
    it("inserts with auto sort_order when not provided", async () => {
      mockRows[
        "SELECT MAX(sort_order) as max_order FROM investment_buckets WHERE yearly_plan_id = ?;"
      ] = [{ max_order: 2 }];

      const id = await createInvestmentBucket({
        yearly_plan_id: "plan-1",
        name: "Emergency Fund",
        annual_target: 420000,
      });

      expect(id).toBe("test-uuid-1");
      const insert = executedRuns.find((r) =>
        r.sql.includes("INSERT INTO investment_buckets"),
      );
      expect(insert!.params).toContain("plan-1");
      expect(insert!.params).toContain("Emergency Fund");
      expect(insert!.params).toContain(420000);
      expect(insert!.params).toContain(null); // linked_milestone_id defaults to null
      expect(insert!.params).toContain(3); // sort_order = 2 + 1
    });

    it("uses provided sort_order", async () => {
      const id = await createInvestmentBucket({
        yearly_plan_id: "plan-1",
        name: "Equity",
        annual_target: 65000,
        sort_order: 5,
      });

      expect(id).toBe("test-uuid-1");
      const insert = executedRuns.find((r) =>
        r.sql.includes("INSERT INTO investment_buckets"),
      );
      expect(insert!.params).toContain(5);
    });

    it("accepts linked_milestone_id", async () => {
      const id = await createInvestmentBucket({
        yearly_plan_id: "plan-1",
        name: "House Fund",
        annual_target: 760000,
        linked_milestone_id: "milestone-1",
      });

      expect(id).toBe("test-uuid-1");
      const insert = executedRuns.find((r) =>
        r.sql.includes("INSERT INTO investment_buckets"),
      );
      expect(insert!.params).toContain("milestone-1");
    });
  });

  describe("updateInvestmentBucket", () => {
    it("updates only provided fields", async () => {
      await updateInvestmentBucket("bucket-1", {
        name: "Mutual Funds SIP",
        annual_target: 100000,
      });

      const update = executedRuns.find((r) =>
        r.sql.includes("UPDATE investment_buckets"),
      );
      expect(update!.sql).toContain("name = ?");
      expect(update!.sql).toContain("annual_target = ?");
      expect(update!.sql).not.toContain("current_contributed = ?");
      expect(update!.sql).not.toContain("linked_milestone_id = ?");
    });

    it("does nothing when no fields provided", async () => {
      await updateInvestmentBucket("bucket-1", {});
      expect(executedRuns.length).toBe(0);
    });

    it("can update linked_milestone_id", async () => {
      await updateInvestmentBucket("bucket-1", {
        linked_milestone_id: "milestone-2",
      });

      const update = executedRuns.find((r) =>
        r.sql.includes("UPDATE investment_buckets"),
      );
      expect(update!.sql).toContain("linked_milestone_id = ?");
    });

    it("can unlink milestone by setting null", async () => {
      await updateInvestmentBucket("bucket-1", {
        linked_milestone_id: null,
      });

      const update = executedRuns.find((r) =>
        r.sql.includes("UPDATE investment_buckets"),
      );
      expect(update!.sql).toContain("linked_milestone_id = ?");
      expect(update!.params).toContain(null);
    });
  });

  describe("deleteInvestmentBucket", () => {
    it("deletes contributions first then the bucket", async () => {
      await deleteInvestmentBucket("bucket-1");
      expect(executedRuns.length).toBe(2);
      expect(executedRuns[0].sql).toContain(
        "DELETE FROM investment_contributions",
      );
      expect(executedRuns[1].sql).toContain(
        "DELETE FROM investment_buckets",
      );
    });
  });
});

// ─── InvestmentContribution CRUD ────────────────────────────

describe("InvestmentContribution", () => {
  describe("getInvestmentContributions", () => {
    it("queries by bucket_id, excludes rejected, orders by date DESC", async () => {
      await getInvestmentContributions("bucket-1");
      expect(mockDb.getAllAsync).toHaveBeenCalledWith(
        expect.stringContaining("status != 'rejected'"),
        "bucket-1",
      );
    });
  });

  describe("createInvestmentContribution", () => {
    it("inserts and recalculates bucket total", async () => {
      // v17.3.0: recomputeBucketContributed fetches bucket_type first — default to investment
      mockDb.getFirstAsync.mockImplementation(async (sql: string) => {
        if (sql.includes("bucket_type, linked_loan_account_id")) {
          return { bucket_type: "investment", linked_loan_account_id: null, financial_year: null };
        }
        const rows = mockRows[sql] ?? [];
        return rows[0] ?? null;
      });
      const id = await createInvestmentContribution({
        investment_bucket_id: "bucket-1",
        month: "2026-04",
        amount: 6000,
        date: "2026-04-05",
        notes: "SIP April",
      });

      expect(id).toBe("test-uuid-1");

      const insert = executedRuns.find((r) =>
        r.sql.includes("INSERT INTO investment_contributions"),
      );
      expect(insert!.params).toContain("bucket-1");
      expect(insert!.params).toContain(6000);
      expect(insert!.params).toContain("SIP April");

      // Should also update bucket total
      const updateBucket = executedRuns.find((r) =>
        r.sql.includes("UPDATE investment_buckets SET current_contributed"),
      );
      expect(updateBucket).toBeDefined();
    });
  });

  describe("deleteInvestmentContribution", () => {
    it("deletes and recalculates bucket total", async () => {
      mockDb.getFirstAsync.mockImplementation(async (sql: string) => {
        if (sql.includes("bucket_type, linked_loan_account_id")) {
          return { bucket_type: "investment", linked_loan_account_id: null, financial_year: null };
        }
        const rows = mockRows[sql] ?? [];
        return rows[0] ?? null;
      });
      await deleteInvestmentContribution("contrib-1", "bucket-1");

      const del = executedRuns.find((r) =>
        r.sql.includes("DELETE FROM investment_contributions"),
      );
      expect(del).toBeDefined();

      const updateBucket = executedRuns.find((r) =>
        r.sql.includes("UPDATE investment_buckets SET current_contributed"),
      );
      expect(updateBucket).toBeDefined();
    });
  });

  describe("milestone sync on contribution", () => {
    it("syncs linked milestone when contribution is added", async () => {
      // Mock: bucket is linked to a milestone
      mockDb.getFirstAsync.mockImplementation(async (sql: string) => {
        if (sql.includes("linked_milestone_id")) {
          return { linked_milestone_id: "milestone-1" };
        }
        const rows = mockRows[sql] ?? [];
        return rows[0] ?? null;
      });

      await createInvestmentContribution({
        investment_bucket_id: "bucket-1",
        month: "2026-04",
        amount: 10000,
        date: "2026-04-05",
      });

      // Should update life_milestones current_saved
      const milestoneUpdate = executedRuns.find(
        (r) =>
          r.sql.includes("UPDATE life_milestones SET current_saved") &&
          r.params.includes("milestone-1"),
      );
      expect(milestoneUpdate).toBeDefined();
    });

    it("does not sync when bucket has no linked milestone", async () => {
      // Mock: bucket has no linked milestone
      mockDb.getFirstAsync.mockImplementation(async (sql: string) => {
        if (sql.includes("linked_milestone_id")) {
          return { linked_milestone_id: null };
        }
        const rows = mockRows[sql] ?? [];
        return rows[0] ?? null;
      });

      await createInvestmentContribution({
        investment_bucket_id: "bucket-2",
        month: "2026-04",
        amount: 5000,
        date: "2026-04-10",
      });

      const milestoneUpdate = executedRuns.find((r) =>
        r.sql.includes("UPDATE life_milestones SET current_saved"),
      );
      expect(milestoneUpdate).toBeUndefined();
    });

    it("syncs linked milestone when contribution is deleted", async () => {
      mockDb.getFirstAsync.mockImplementation(async (sql: string) => {
        if (sql.includes("linked_milestone_id")) {
          return { linked_milestone_id: "milestone-1" };
        }
        const rows = mockRows[sql] ?? [];
        return rows[0] ?? null;
      });

      await deleteInvestmentContribution("contrib-1", "bucket-1");

      const milestoneUpdate = executedRuns.find(
        (r) =>
          r.sql.includes("UPDATE life_milestones SET current_saved") &&
          r.params.includes("milestone-1"),
      );
      expect(milestoneUpdate).toBeDefined();
    });
  });
});
