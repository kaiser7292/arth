/**
 * Simulator service (DB layer) tests.
 *
 * Mocks expo-sqlite and verifies SQL shape for CRUD, seeding, reconciliation,
 * retention. Does NOT exercise the pure engine (see simulator-engine.test.ts).
 */

import {
  getOrCreateDefaultScenario,
  createScenario,
  updateScenario,
  archiveScenario,
  deleteScenario,
  duplicateScenario,
  createEntry,
  updateEntry,
  duplicateEntry,
  rescheduleEntry,
  fulfillEntry,
  dismissEntry,
  deleteEntry,
  purgeRetention,
} from "../../services/simulator";

let executedRuns: { sql: string; params: unknown[] }[] = [];
let mockFirstAsyncQueue: unknown[] = [];
let mockAllAsyncQueue: unknown[][] = [];

const mockDb = {
  getAllAsync: jest.fn(async () => (mockAllAsyncQueue.length > 0 ? mockAllAsyncQueue.shift()! : [])),
  getFirstAsync: jest.fn(async () => (mockFirstAsyncQueue.length > 0 ? mockFirstAsyncQueue.shift() : null)),
  runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    executedRuns.push({ sql, params });
    return { changes: 1, lastInsertRowId: 1 };
  }),
  withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => {
    await fn();
  }),
};

jest.mock("../../database", () => ({ getDatabase: () => mockDb }));
jest.mock("../../services/settings", () => ({ bumpDataVersion: jest.fn() }));

let mockUuidCounter = 0;
jest.mock("../../utils/uuid", () => ({
  generateUUID: () => `sim-${++mockUuidCounter}`,
}));

beforeEach(() => {
  executedRuns = [];
  mockFirstAsyncQueue = [];
  mockAllAsyncQueue = [];
  mockUuidCounter = 0;
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════
// Scenario CRUD
// ═══════════════════════════════════════════════════════════════════════

describe("Scenario CRUD", () => {
  it("creates the default scenario on first open", async () => {
    // v16.0.1 — service now uses getAllAsync for the initial defaults fetch.
    // Empty array → no existing default → insert + refetch.
    mockAllAsyncQueue = [[]];
    mockFirstAsyncQueue = [
      {
        id: "sim-1",
        user_id: "user-1",
        name: "This month",
        horizon_date: "2026-05-31",
        is_default: 1,
        created_at: "x",
        updated_at: "x",
        archived_at: null,
      },
    ];
    const res = await getOrCreateDefaultScenario("user-1");
    expect(res.scenario.is_default).toBe(1);
    expect(res.justSeeded).toBe(true);
    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO simulation_scenarios"));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain("user-1");
    // Default name is hard-coded in the SQL literal, not a param.
    expect(insert!.sql).toContain("'This month'");
  });

  it("demotes duplicate default scenarios down to is_default=0 (race / historic dupe cleanup)", async () => {
    // v16.0.1 — if multiple is_default=1 rows exist (shipped without a
    // uniqueness guard in v16.0.0), keep the oldest, demote the rest.
    mockAllAsyncQueue = [
      [
        { id: "oldest", user_id: "user-1", name: "This month", horizon_date: "2099-12-31", is_default: 1, created_at: "2026-05-01", updated_at: "x", archived_at: null },
        { id: "dupe-1", user_id: "user-1", name: "This month", horizon_date: "2099-12-31", is_default: 1, created_at: "2026-05-02", updated_at: "x", archived_at: null },
        { id: "dupe-2", user_id: "user-1", name: "This month", horizon_date: "2099-12-31", is_default: 1, created_at: "2026-05-03", updated_at: "x", archived_at: null },
      ],
    ];
    await getOrCreateDefaultScenario("user-1");
    const demote = executedRuns.find(
      (r) => r.sql.includes("UPDATE simulation_scenarios") && r.sql.includes("is_default = 0"),
    );
    expect(demote).toBeDefined();
    expect(demote!.params).toEqual(["dupe-1", "dupe-2"]);
  });

  it("rolls the default scenario's horizon forward when it's passed", async () => {
    const oldHorizon = "1999-01-01";
    mockAllAsyncQueue = [
      [
        {
          id: "sim-default",
          user_id: "user-1",
          name: "This month",
          horizon_date: oldHorizon,
          is_default: 1,
          created_at: "x",
          updated_at: "x",
          archived_at: null,
        },
      ],
    ];
    mockFirstAsyncQueue = [
      // After roll-forward — refetch returns the updated row (test only checks SQL)
      {
        id: "sim-default",
        user_id: "user-1",
        name: "This month",
        horizon_date: "2099-01-01",
        is_default: 1,
        created_at: "x",
        updated_at: "x",
        archived_at: null,
      },
    ];
    const res = await getOrCreateDefaultScenario("user-1");
    expect(res.justSeeded).toBe(true);
    const update = executedRuns.find(
      (r) => r.sql.includes("UPDATE simulation_scenarios") && r.sql.includes("horizon_date"),
    );
    expect(update).toBeDefined();
    const cleanup = executedRuns.find((r) =>
      r.sql.includes("DELETE FROM simulation_entries") && r.sql.includes("status IN"),
    );
    expect(cleanup).toBeDefined();
  });

  it("does NOT roll forward when horizon is in the future (justSeeded = false)", async () => {
    mockAllAsyncQueue = [
      [
        {
          id: "sim-default",
          user_id: "user-1",
          name: "This month",
          horizon_date: "2099-12-31",
          is_default: 1,
          created_at: "x",
          updated_at: "x",
          archived_at: null,
        },
      ],
    ];
    const res = await getOrCreateDefaultScenario("user-1");
    expect(res.justSeeded).toBe(false);
  });

  it("creates a named scenario with validated horizon", async () => {
    const id = await createScenario("user-1", {
      name: "With Goa trip",
      horizon_date: "2026-06-30",
    });
    expect(id).toBe("sim-1");
    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO simulation_scenarios"));
    expect(insert!.params).toContain("With Goa trip");
    expect(insert!.params).toContain("2026-06-30");
  });

  it("rejects an empty scenario name", async () => {
    await expect(
      createScenario("user-1", { name: "   ", horizon_date: "2026-06-30" }),
    ).rejects.toThrow(/name/i);
  });

  it("rejects a malformed horizon date", async () => {
    await expect(
      createScenario("user-1", { name: "Trip", horizon_date: "not-a-date" }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("updates scenario name", async () => {
    await updateScenario("sim-1", { name: "Renamed" });
    const update = executedRuns.find((r) => r.sql.includes("UPDATE simulation_scenarios"));
    expect(update!.params).toContain("Renamed");
  });

  it("archives a scenario regardless of is_default flag (v16.0.5)", async () => {
    await archiveScenario("sim-1");
    const update = executedRuns.find((r) =>
      r.sql.includes("UPDATE simulation_scenarios") && r.sql.includes("archived_at"),
    );
    expect(update).toBeDefined();
    // v16.0.5: no is_default guard anymore.
    expect(update!.sql).not.toContain("is_default");
    expect(update!.params).toContain("sim-1");
  });

  it("deletes a scenario regardless of is_default flag (v16.0.5)", async () => {
    await deleteScenario("sim-1");
    const del = executedRuns.find((r) => r.sql.includes("DELETE FROM simulation_scenarios"));
    expect(del).toBeDefined();
    expect(del!.sql).not.toContain("is_default");
    expect(del!.params).toContain("sim-1");
  });

  it("duplicates a scenario, cloning only upcoming entries", async () => {
    mockFirstAsyncQueue = [
      {
        id: "src",
        user_id: "user-1",
        name: "Original",
        horizon_date: "2026-05-31",
        is_default: 0,
        created_at: "x",
        updated_at: "x",
        archived_at: null,
      },
    ];
    mockAllAsyncQueue = [
      [
        {
          id: "e1",
          scenario_id: "src",
          direction: "out",
          amount: 1000,
          date: "2026-05-10",
          status: "upcoming",
        },
      ],
    ];
    const newId = await duplicateScenario("src");
    expect(newId).toBe("sim-1");
    const inserts = executedRuns.filter((r) => r.sql.includes("INSERT INTO simulation_"));
    expect(inserts.length).toBe(2); // 1 scenario + 1 entry
    const entryInsert = executedRuns.find((r) => r.sql.includes("INSERT INTO simulation_entries"));
    expect(entryInsert!.params).toContain(1000);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Entry CRUD
// ═══════════════════════════════════════════════════════════════════════

describe("Entry CRUD", () => {
  it("creates an entry with validated amount + date", async () => {
    const id = await createEntry("sim-1", {
      direction: "out",
      amount: 3500,
      date: "2026-05-20",
      account_id: "acct-1",
    });
    expect(id).toBe("sim-1");
    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO simulation_entries"));
    expect(insert!.params).toContain(3500);
    expect(insert!.params).toContain("2026-05-20");
    const bump = executedRuns.find((r) =>
      r.sql.includes("UPDATE simulation_scenarios") && r.sql.includes("updated_at"),
    );
    expect(bump).toBeDefined();
  });

  it("rejects a non-positive amount", async () => {
    await expect(
      createEntry("sim-1", { direction: "out", amount: 0, date: "2026-05-20" }),
    ).rejects.toThrow(/positive/);
    await expect(
      createEntry("sim-1", { direction: "out", amount: -500, date: "2026-05-20" }),
    ).rejects.toThrow(/positive/);
  });

  it("rejects a bad date", async () => {
    await expect(
      createEntry("sim-1", { direction: "out", amount: 100, date: "bad" }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("updates an entry's amount", async () => {
    await updateEntry("entry-1", { amount: 200 });
    const update = executedRuns.find((r) => r.sql.includes("UPDATE simulation_entries"));
    expect(update!.params).toContain(200);
  });

  it("rejects an update with invalid direction", async () => {
    await expect(
      updateEntry("entry-1", { direction: "sideways" as unknown as "out" }),
    ).rejects.toThrow(/direction/);
  });

  it("duplicates an entry with fresh id + manual source", async () => {
    mockFirstAsyncQueue = [
      {
        id: "e1",
        scenario_id: "sim-1",
        direction: "out",
        amount: 500,
        date: "2026-05-10",
        account_id: null,
        category_id: null,
        merchant_name: "Swiggy",
        description: null,
      },
    ];
    const newId = await duplicateEntry("e1");
    expect(newId).toBe("sim-1");
    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO simulation_entries"));
    expect(insert!.params).toContain(500);
    expect(insert!.params).toContain("Swiggy");
    expect(insert!.sql).toContain("'manual'");
  });

  it("reschedule moves date + stamps originally_planned_for", async () => {
    mockFirstAsyncQueue = [{ date: "2026-05-15", originally_planned_for: null }];
    await rescheduleEntry("e1", "2026-05-25");
    const update = executedRuns.find((r) => r.sql.includes("UPDATE simulation_entries"));
    expect(update!.params).toContain("2026-05-25");
    expect(update!.params).toContain("2026-05-15"); // original preserved
    expect(update!.sql).toContain("status = 'upcoming'");
    expect(update!.sql).toContain("fulfilled_expense_id = NULL");
  });

  it("reschedule preserves an existing originally_planned_for on subsequent reschedule", async () => {
    mockFirstAsyncQueue = [{ date: "2026-05-20", originally_planned_for: "2026-05-15" }];
    await rescheduleEntry("e1", "2026-05-28");
    const update = executedRuns.find((r) => r.sql.includes("UPDATE simulation_entries"));
    // Still the very first original, not the intermediate "2026-05-20".
    expect(update!.params).toContain("2026-05-15");
  });

  it("fulfill links entry to a real expense id", async () => {
    await fulfillEntry("e1", "real-expense-123");
    const update = executedRuns.find((r) => r.sql.includes("UPDATE simulation_entries"));
    expect(update!.params).toContain("real-expense-123");
    expect(update!.sql).toContain("status = 'fulfilled'");
  });

  it("dismiss sets status=dismissed", async () => {
    await dismissEntry("e1");
    const update = executedRuns.find((r) => r.sql.includes("UPDATE simulation_entries"));
    expect(update!.sql).toContain("status = 'dismissed'");
  });

  it("delete hard-deletes the row", async () => {
    await deleteEntry("e1");
    const del = executedRuns.find((r) => r.sql.includes("DELETE FROM simulation_entries"));
    expect(del).toBeDefined();
    expect(del!.params).toContain("e1");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Retention
// ═══════════════════════════════════════════════════════════════════════

describe("purgeRetention", () => {
  it("runs three passes (entries, archive, delete)", async () => {
    await purgeRetention("user-1");
    // Pass 1: hard-delete old fulfilled/dismissed entries
    expect(
      executedRuns.find((r) =>
        r.sql.includes("DELETE FROM simulation_entries") && r.sql.includes("fulfilled"),
      ),
    ).toBeDefined();
    // Pass 2: archive 90d+ scenarios
    expect(
      executedRuns.find((r) =>
        r.sql.includes("UPDATE simulation_scenarios") && r.sql.includes("archived_at = datetime('now')"),
      ),
    ).toBeDefined();
    // Pass 3: hard-delete 180d+ scenarios
    expect(
      executedRuns.find((r) =>
        r.sql.includes("DELETE FROM simulation_scenarios") && r.sql.includes("180 days"),
      ),
    ).toBeDefined();
  });

  it("retention passes no longer guard by is_default (v16.0.5)", async () => {
    await purgeRetention("user-1");
    const archiveSql = executedRuns.find(
      (r) => r.sql.includes("UPDATE simulation_scenarios") && r.sql.includes("archived_at"),
    );
    expect(archiveSql!.sql).not.toContain("is_default");
    const deleteSql = executedRuns.find(
      (r) => r.sql.includes("DELETE FROM simulation_scenarios"),
    );
    expect(deleteSql!.sql).not.toContain("is_default");
  });
});
