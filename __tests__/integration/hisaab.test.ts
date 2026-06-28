/**
 * Hisaab (Family Ledger) integration tests.
 *
 * Since expo-sqlite is a native module, we mock it to verify:
 * 1. Person CRUD operations
 * 2. Entry CRUD operations (debit, credit, settlement)
 * 3. Running balance calculation
 * 4. Summary aggregation (owed to you / you owe)
 * 5. Settlement recording
 * 6. Date range filtering
 */

import {
    createEntry,
    createPerson,
    deactivateHisaabPerson,
    deleteEntry,
    getEntries,
    getEntriesByDateRange,
    getHisaabSummary,
    getPerson,
    getPersonBalance,
    getPersonsWithBalances,
    recordSettlement,
    updateEntry,
    updatePerson,
} from "../../services/hisaab";

// ─── Mock database ───

let executedRuns: { sql: string; params: unknown[] }[] = [];
let mockFirstRows: Record<string, unknown> = {};
let mockAllRows: unknown[] = [];

const mockDb = {
  getAllAsync: jest.fn(async () => mockAllRows),
  getFirstAsync: jest.fn(async (sql: string) => {
    return mockFirstRows[sql] ?? null;
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
  generateUUID: () => `test-hisaab-uuid-${++mockUuidCounter}`,
}));

beforeEach(() => {
  executedRuns = [];
  mockFirstRows = {};
  mockAllRows = [];
  mockUuidCounter = 0;
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════
// Person CRUD
// ═══════════════════════════════════════════════

describe("Person CRUD", () => {
  it("creates a person with required fields", async () => {
    const id = await createPerson({
      owner_user_id: "user-1",
      name: "Tarun",
    });

    expect(id).toBe("test-hisaab-uuid-1");
    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO hisaab_persons"));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain("Tarun");
    expect(insert!.params).toContain("user-1");
  });

  it("creates a person with all optional fields", async () => {
    const id = await createPerson({
      owner_user_id: "user-1",
      name: "Ravi",
      phone: "9876543210",
      email: "ravi@example.com",
      initial_balance: 5000,
      notes: "College friend",
    });

    expect(id).toBeDefined();
    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO hisaab_persons"));
    expect(insert!.params).toContain("9876543210");
    expect(insert!.params).toContain("ravi@example.com");
    expect(insert!.params).toContain(5000);
    expect(insert!.params).toContain("College friend");
  });

  it("updates a person's name", async () => {
    await updatePerson("person-1", { name: "Tarun Kumar" });

    const update = executedRuns.find((r) => r.sql.includes("UPDATE hisaab_persons"));
    expect(update).toBeDefined();
    expect(update!.sql).toContain("name = ?");
    expect(update!.params).toContain("Tarun Kumar");
  });

  it("deactivates a person (soft delete)", async () => {
    await deactivateHisaabPerson("person-1");

    const update = executedRuns.find((r) => r.sql.includes("UPDATE hisaab_persons"));
    expect(update).toBeDefined();
    expect(update!.sql).toContain("is_active = 0");
  });

  it("gets a person by ID", async () => {
    mockDb.getFirstAsync.mockResolvedValueOnce({ id: "person-1", name: "Tarun" });

    const person = await getPerson("person-1");
    expect(person).toBeDefined();
    expect(person!.name).toBe("Tarun");
  });

  it("gets persons with balances", async () => {
    mockAllRows = [
      { id: "p1", name: "Tarun", balance: 5000, entryCount: 3, lastEntryDate: "2026-04-10" },
      { id: "p2", name: "Ravi", balance: -2000, entryCount: 1, lastEntryDate: "2026-04-05" },
    ];

    const persons = await getPersonsWithBalances("user-1");
    expect(persons).toHaveLength(2);
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("hisaab_persons"),
      "user-1",
    );
  });
});

// ═══════════════════════════════════════════════
// Entry CRUD
// ═══════════════════════════════════════════════

describe("Entry CRUD", () => {
  it("creates a debit entry", async () => {
    const id = await createEntry({
      hisaab_person_id: "person-1",
      amount: 3000,
      description: "Dinner bill",
      date: "2026-04-10",
      type: "debit",
    });

    expect(id).toBeDefined();
    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO hisaab_entries"));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain(3000);
    expect(insert!.params).toContain("debit");
    expect(insert!.params).toContain("Dinner bill");
  });

  it("creates a credit entry", async () => {
    await createEntry({
      hisaab_person_id: "person-1",
      amount: 1500,
      description: "GPay received",
      date: "2026-04-11",
      type: "credit",
    });

    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO hisaab_entries"));
    expect(insert!.params).toContain("credit");
    expect(insert!.params).toContain(1500);
  });

  it("creates entry linked to an expense", async () => {
    await createEntry({
      hisaab_person_id: "person-1",
      amount: 2000,
      description: "Grocery split",
      date: "2026-04-12",
      type: "debit",
      linked_expense_id: "expense-123",
    });

    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO hisaab_entries"));
    expect(insert!.params).toContain("expense-123");
  });

  it("updates an entry", async () => {
    await updateEntry("entry-1", { amount: 5000, description: "Updated" });

    const update = executedRuns.find((r) => r.sql.includes("UPDATE hisaab_entries"));
    expect(update).toBeDefined();
    expect(update!.sql).toContain("amount = ?");
    expect(update!.params).toContain(5000);
  });

  it("deletes an entry", async () => {
    await deleteEntry("entry-1");

    const del = executedRuns.find((r) => r.sql.includes("DELETE FROM hisaab_entries"));
    expect(del).toBeDefined();
    expect(del!.params).toEqual(["entry-1"]);
  });

  it("gets all entries for a person", async () => {
    await getEntries("person-1");

    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("hisaab_person_id = ?"),
      "person-1",
    );
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY date DESC"),
      "person-1",
    );
  });

  it("gets entries by date range", async () => {
    await getEntriesByDateRange("person-1", "2026-04-01", "2026-04-30");

    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("date >= ?"),
      "person-1",
      "2026-04-01",
      "2026-04-30",
    );
  });
});

// ═══════════════════════════════════════════════
// Balance Calculation
// ═══════════════════════════════════════════════

describe("Balance Calculation", () => {
  it("calculates running balance correctly", async () => {
    mockDb.getFirstAsync.mockResolvedValueOnce({
      initial_balance: 1000,
      debits: 5000,
      credits: 2000,
    });

    const balance = await getPersonBalance("person-1");
    // 1000 + 5000 - 2000 = 4000
    expect(balance).toBe(4000);
  });

  it("returns 0 when person not found", async () => {
    mockDb.getFirstAsync.mockResolvedValueOnce(null);

    const balance = await getPersonBalance("nonexistent");
    expect(balance).toBe(0);
  });

  it("handles null debits/credits", async () => {
    mockDb.getFirstAsync.mockResolvedValueOnce({
      initial_balance: 3000,
      debits: null,
      credits: null,
    });

    const balance = await getPersonBalance("person-1");
    expect(balance).toBe(3000); // Just initial balance
  });
});

// ═══════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════

describe("Hisaab Summary", () => {
  it("calculates total owed to you and you owe", async () => {
    mockAllRows = [
      { id: "p1", name: "Tarun", balance: 5000, entryCount: 3, lastEntryDate: "2026-04-10" },
      { id: "p2", name: "Ravi", balance: -2000, entryCount: 1, lastEntryDate: "2026-04-05" },
      { id: "p3", name: "Amit", balance: 3000, entryCount: 2, lastEntryDate: "2026-04-08" },
    ];

    const summary = await getHisaabSummary("user-1");
    expect(summary.totalOwedToYou).toBe(8000);
    expect(summary.totalYouOwe).toBe(2000);
    expect(summary.netBalance).toBe(6000);
  });

  it("handles no persons", async () => {
    mockAllRows = [];

    const summary = await getHisaabSummary("user-1");
    expect(summary.totalOwedToYou).toBe(0);
    expect(summary.totalYouOwe).toBe(0);
    expect(summary.netBalance).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// Settlement
// ═══════════════════════════════════════════════

describe("Settlement", () => {
  it("records a settlement entry", async () => {
    const id = await recordSettlement("person-1", 3000, "2026-04-12", "GPay transfer");

    expect(id).toBeDefined();
    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO hisaab_entries"));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain("settlement");
    expect(insert!.params).toContain(3000);
    expect(insert!.params).toContain("GPay transfer");
  });

  it("uses default description when not provided", async () => {
    await recordSettlement("person-1", 1000, "2026-04-12");

    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO hisaab_entries"));
    expect(insert!.params).toContain("Settlement");
  });
});
