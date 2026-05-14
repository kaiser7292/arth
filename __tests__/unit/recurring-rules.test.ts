/**
 * Recurring-reminder service tests (v14.7.0 model).
 *
 * Covers:
 *   - createRule rejects duplicates + invalid dates; writes next_due_date
 *   - first next_due_date skips forward past today when start_date is past
 *   - fulfillReminder stamps the expense + inserts a fulfillment + advances
 *     next_due_date from the cycle's due date, not today
 *   - end_date auto-stops the rule at the final cycle
 *   - unfulfillReminder rewinds next_due_date + clears stamps + re-activates
 *   - skipReminderCycle advances without a fulfillment
 *   - onSourceExpenseDeleted auto-stops
 *   - onFulfillingExpenseDeleted triggers unfulfill chain
 */

let executedRuns: { sql: string; params: unknown[] }[] = [];
let firstAsyncQueue: (Record<string, unknown> | null)[] = [];
let allAsyncQueue: Record<string, unknown>[][] = [];
let mockUuidCounter = 0;

const mockDb = {
  getAllAsync: jest.fn(async () => {
    return allAsyncQueue.length > 0 ? allAsyncQueue.shift()! : [];
  }),
  getFirstAsync: jest.fn(async () => {
    return firstAsyncQueue.length > 0 ? firstAsyncQueue.shift()! : null;
  }),
  runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    executedRuns.push({ sql, params });
    return { changes: 1, lastInsertRowId: 1 };
  }),
  withTransactionAsync: jest.fn(async (cb: () => Promise<void>) => cb()),
};

jest.mock("../../database", () => ({ getDatabase: () => mockDb }));
jest.mock("../../services/settings", () => ({ bumpDataVersion: jest.fn() }));
jest.mock("../../utils/uuid", () => ({
  generateUUID: () => `test-id-${++mockUuidCounter}`,
}));

import {
  createRule,
  stopRule,
  fulfillReminder,
  unfulfillReminder,
  skipReminderCycle,
  onSourceExpenseDeleted,
  onFulfillingExpenseDeleted,
} from "../../services/recurring-rules";

beforeEach(() => {
  executedRuns = [];
  firstAsyncQueue = [];
  allAsyncQueue = [];
  mockUuidCounter = 0;
});

describe("createRule", () => {
  it("rejects when the source already has an active rule", async () => {
    // v15.13.1: createRule now checks is_active on the existing row to
    // decide between reactivate and reject. is_active=1 → reject.
    firstAsyncQueue = [{ id: "existing", is_active: 1 }];
    await expect(
      createRule("user-1", {
        source_expense_id: "src-1",
        frequency: "monthly",
        start_date: "2026-04-28",
      }),
    ).rejects.toThrow(/already has an active/);
  });

  it("reactivates a stopped rule (is_active=0) instead of INSERTing", async () => {
    // v15.13.1: was a UNIQUE-constraint bug — stopping a rule left the row
    // in place, and "Set reminder" again hit UNIQUE(source_expense_id) on
    // INSERT. Now we UPDATE the stopped row back to active with the new
    // config. Should resolve (not throw) and return the existing id.
    firstAsyncQueue = [{ id: "existing-stopped", is_active: 0 }];
    const ruleId = await createRule("user-1", {
      source_expense_id: "src-1",
      frequency: "yearly",
      start_date: "2026-04-28",
    });
    expect(ruleId).toBe("existing-stopped");
  });

  it("rejects invalid ISO date", async () => {
    firstAsyncQueue = [null];
    await expect(
      createRule("user-1", {
        source_expense_id: "src-1",
        frequency: "monthly",
        start_date: "not-a-date",
      }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("inserts the rule with a next_due_date set", async () => {
    firstAsyncQueue = [null];
    await createRule("user-1", {
      source_expense_id: "src-1",
      frequency: "monthly",
      // Far-future start to avoid today-dependent assertions.
      start_date: "2099-06-15",
    });

    const insert = executedRuns.find((r) =>
      r.sql.includes("INSERT INTO recurring_expense_rules"),
    );
    expect(insert).toBeDefined();
    // next_due_date (last param) should equal start_date for future start.
    expect(insert!.params[7]).toBe("2099-06-15");
  });
});

describe("fulfillReminder", () => {
  it("advances next_due_date by one cycle (from the cycle's due date)", async () => {
    firstAsyncQueue = [
      {
        id: "rule-1",
        user_id: "user-1",
        source_expense_id: "src-1",
        frequency: "monthly",
        start_date: "2026-04-01",
        end_date: null,
        last_materialized_date: null,
        next_due_date: "2026-05-01",
        is_active: 1,
        notes: null,
      },
      { fulfills_rule_id: null }, // expense not already linked
    ];
    await fulfillReminder("rule-1", "exp-1");

    const fulfillInsert = executedRuns.find((r) =>
      r.sql.includes("INSERT INTO reminder_fulfillments"),
    );
    expect(fulfillInsert).toBeDefined();
    expect(fulfillInsert!.params[1]).toBe("rule-1");
    expect(fulfillInsert!.params[2]).toBe("exp-1");
    expect(fulfillInsert!.params[3]).toBe("2026-05-01");

    const advance = executedRuns.find((r) =>
      r.sql.includes("SET next_due_date = ?"),
    );
    expect(advance).toBeDefined();
    // +1 month → 2026-06-01
    expect(advance!.params[0]).toBe("2026-06-01");

    const stamp = executedRuns.find((r) =>
      r.sql.includes("SET fulfills_rule_id = ?"),
    );
    expect(stamp).toBeDefined();
    expect(stamp!.params[0]).toBe("rule-1");
  });

  it("auto-stops the rule when the next cycle would pass end_date", async () => {
    firstAsyncQueue = [
      {
        id: "rule-end",
        user_id: "user-1",
        source_expense_id: "src-1",
        frequency: "monthly",
        start_date: "2026-01-01",
        end_date: "2026-05-05",
        last_materialized_date: null,
        next_due_date: "2026-05-01",
        is_active: 1,
        notes: null,
      },
      { fulfills_rule_id: null },
    ];
    await fulfillReminder("rule-end", "exp-x");

    const stop = executedRuns.find((r) =>
      r.sql.includes("is_active = 0, next_due_date = NULL"),
    );
    expect(stop).toBeDefined();
  });

  it("rejects when the expense is already linked to another rule", async () => {
    firstAsyncQueue = [
      {
        id: "rule-1",
        user_id: "user-1",
        source_expense_id: "src-1",
        frequency: "monthly",
        start_date: "2026-04-01",
        end_date: null,
        last_materialized_date: null,
        next_due_date: "2026-05-01",
        is_active: 1,
        notes: null,
      },
      { fulfills_rule_id: "some-other-rule" },
    ];
    await expect(fulfillReminder("rule-1", "exp-1")).rejects.toThrow(
      /already linked/,
    );
  });
});

describe("unfulfillReminder", () => {
  it("clears the stamp, deletes the fulfillment row, rewinds next_due_date", async () => {
    firstAsyncQueue = [
      // Fulfillment row
      {
        id: "ff-1",
        rule_id: "rule-1",
        expense_id: "exp-1",
        cycle_due_date: "2026-05-01",
        fulfilled_at: "2026-05-03",
      },
      // The rule itself — next_due_date already advanced to 2026-06-01
      {
        id: "rule-1",
        user_id: "user-1",
        source_expense_id: "src-1",
        frequency: "monthly",
        start_date: "2026-04-01",
        end_date: null,
        last_materialized_date: null,
        next_due_date: "2026-06-01",
        is_active: 1,
        notes: null,
      },
    ];
    await unfulfillReminder("exp-1");

    const del = executedRuns.find((r) =>
      r.sql.includes("DELETE FROM reminder_fulfillments"),
    );
    expect(del).toBeDefined();

    const clearStamp = executedRuns.find((r) =>
      r.sql.includes("SET fulfills_rule_id = NULL"),
    );
    expect(clearStamp).toBeDefined();

    const rewind = executedRuns.find((r) =>
      r.sql.includes("SET next_due_date = ?"),
    );
    expect(rewind).toBeDefined();
    expect(rewind!.params[0]).toBe("2026-05-01");
  });

  it("is a no-op when the expense has no fulfillment", async () => {
    firstAsyncQueue = [null];
    await unfulfillReminder("never-linked");
    expect(
      executedRuns.find((r) => r.sql.includes("DELETE")),
    ).toBeUndefined();
  });
});

describe("skipReminderCycle", () => {
  it("advances next_due_date without recording a fulfillment", async () => {
    firstAsyncQueue = [
      {
        id: "rule-1",
        user_id: "user-1",
        source_expense_id: "src-1",
        frequency: "monthly",
        start_date: "2026-04-01",
        end_date: null,
        last_materialized_date: null,
        next_due_date: "2026-05-01",
        is_active: 1,
        notes: null,
      },
    ];
    await skipReminderCycle("rule-1");

    const fulfillInsert = executedRuns.find((r) =>
      r.sql.includes("INSERT INTO reminder_fulfillments"),
    );
    expect(fulfillInsert).toBeUndefined();

    const advance = executedRuns.find((r) =>
      r.sql.includes("SET next_due_date = ?"),
    );
    expect(advance).toBeDefined();
    expect(advance!.params[0]).toBe("2026-06-01");
  });
});

describe("stopRule", () => {
  it("soft-deactivates the rule", async () => {
    await stopRule("rule-stop");
    const upd = executedRuns.find(
      (r) =>
        r.sql.includes("UPDATE recurring_expense_rules") &&
        r.sql.includes("is_active = 0"),
    );
    expect(upd).toBeDefined();
  });
});

describe("onSourceExpenseDeleted", () => {
  it("deactivates any active rule with this expense as source", async () => {
    await onSourceExpenseDeleted("src-x");
    const upd = executedRuns.find(
      (r) =>
        r.sql.includes("UPDATE recurring_expense_rules") &&
        r.sql.includes("source_expense_id"),
    );
    expect(upd).toBeDefined();
  });
});

describe("onFulfillingExpenseDeleted", () => {
  it("no-ops when the expense has no fulfills_rule_id", async () => {
    firstAsyncQueue = [{ fulfills_rule_id: null }];
    await onFulfillingExpenseDeleted("exp-plain");
    expect(
      executedRuns.find((r) => r.sql.includes("DELETE FROM reminder_fulfillments")),
    ).toBeUndefined();
  });

  it("triggers unfulfillReminder when the expense fulfills a rule", async () => {
    firstAsyncQueue = [
      { fulfills_rule_id: "rule-1" }, // first SELECT in onFulfillingExpenseDeleted
      // then unfulfillReminder's SELECTs:
      {
        id: "ff-1",
        rule_id: "rule-1",
        expense_id: "exp-1",
        cycle_due_date: "2026-05-01",
        fulfilled_at: "2026-05-03",
      },
      {
        id: "rule-1",
        user_id: "user-1",
        source_expense_id: "src-1",
        frequency: "monthly",
        start_date: "2026-04-01",
        end_date: null,
        last_materialized_date: null,
        next_due_date: "2026-06-01",
        is_active: 1,
        notes: null,
      },
    ];
    await onFulfillingExpenseDeleted("exp-1");
    expect(
      executedRuns.find((r) => r.sql.includes("DELETE FROM reminder_fulfillments")),
    ).toBeDefined();
  });
});
