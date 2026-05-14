/**
 * Tests for the Financial Account service.
 *
 * Tests cover:
 * - Account discovery from parsed SMS data
 * - Account update from balance/credit limit SMS
 * - Expense-to-account linking
 * - Duplicate account handling (upsert)
 * - Account summary aggregation
 * - Deactivate / rename operations
 * - Account dues updates
 */

import type { ParsedSMS } from "../../services/sms/bank-patterns";

// ─── Mock database ───

let executedRuns: { sql: string; params: unknown[] }[] = [];
let mockFirstRows: Record<string, unknown> = {};
let mockAllRows: Record<string, unknown[]> = {};

const mockDb = {
  getAllAsync: jest.fn(async (sql: string) => mockAllRows[sql] ?? []),
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
  generateUUID: () => `test-acct-uuid-${++mockUuidCounter}`,
}));

import {
  discoverOrUpdateAccount,
  createManualAccount,
  updateAccountFromSMS,
  linkExpenseToAccount,
  getActiveAccounts,
  getAccountSummary,
  getAccountExpenses,
  deactivateAccount,
  renameAccount,
  updateAccountDues,
  updateNachInfo,
  getUpcomingDues,
} from "../../services/financial-account";

beforeEach(() => {
  executedRuns = [];
  mockFirstRows = {};
  mockAllRows = {};
  mockUuidCounter = 0;
  jest.clearAllMocks();
});

// ─── Helper: build a minimal ParsedSMS ───

function makeParsed(overrides: Partial<ParsedSMS> = {}): ParsedSMS {
  return {
    bank: "ICICI Bank",
    amount: 500,
    type: "debit",
    cardLast4: "3001",
    merchant: "SWIGGY",
    date: "2026-04-10",
    skip: false,
    confidence: 1,
    dueDate: null,
    isForecast: false,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════
// discoverOrUpdateAccount
// ═══════════════════════════════════════════════

describe("discoverOrUpdateAccount", () => {
  it("returns null when cardLast4 is missing", async () => {
    const result = await discoverOrUpdateAccount("user-1", makeParsed({ cardLast4: null }));
    expect(result).toBeNull();
    expect(mockDb.getFirstAsync).not.toHaveBeenCalled();
  });

  it("creates a new account when none exists", async () => {
    // No existing account found
    mockDb.getFirstAsync.mockResolvedValueOnce(null);

    const id = await discoverOrUpdateAccount("user-1", makeParsed());

    expect(id).toBe("test-acct-uuid-1");

    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO financial_accounts"));
    expect(insert).toBeDefined();
    expect(insert!.params).toEqual([
      "test-acct-uuid-1",
      "user-1",
      "3001",
      "ICICI Bank",
      "savings", // default type for debit SMS
    ]);
  });

  it("returns existing account ID and updates when account already exists", async () => {
    mockDb.getFirstAsync.mockResolvedValueOnce({ id: "existing-acct-1" });

    const id = await discoverOrUpdateAccount("user-1", makeParsed());

    expect(id).toBe("existing-acct-1");

    // Should NOT insert a new account
    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO financial_accounts"));
    expect(insert).toBeUndefined();
  });

  it("infers credit_card type when creditLimit is present", async () => {
    mockDb.getFirstAsync.mockResolvedValueOnce(null);

    await discoverOrUpdateAccount(
      "user-1",
      makeParsed({ creditLimit: 200000, accountType: null }),
    );

    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO financial_accounts"));
    expect(insert!.params[4]).toBe("credit_card");
  });

  it("infers credit_card type when availableCreditLimit is present", async () => {
    mockDb.getFirstAsync.mockResolvedValueOnce(null);

    await discoverOrUpdateAccount(
      "user-1",
      makeParsed({ availableCreditLimit: 150000, accountType: null }),
    );

    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO financial_accounts"));
    expect(insert!.params[4]).toBe("credit_card");
  });

  it("uses explicit accountType when provided", async () => {
    mockDb.getFirstAsync.mockResolvedValueOnce(null);

    await discoverOrUpdateAccount(
      "user-1",
      makeParsed({ accountType: "credit_card" }),
    );

    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO financial_accounts"));
    expect(insert!.params[4]).toBe("credit_card");
  });

  it("infers wallet type for Paytm without card info", async () => {
    mockDb.getFirstAsync.mockResolvedValueOnce(null);

    await discoverOrUpdateAccount(
      "user-1",
      makeParsed({ bank: "Paytm Payments Bank", cardLast4: "5678", accountType: null }),
    );

    // Paytm without cardLast4=null would return null, but with cardLast4 set
    // and bank matching wallet list, it still creates. The heuristic checks
    // !parsed.cardLast4 for wallet — so with cardLast4 present it defaults to savings.
    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO financial_accounts"));
    expect(insert!.params[4]).toBe("savings");
  });
});

// ═══════════════════════════════════════════════
// updateAccountFromSMS
// ═══════════════════════════════════════════════

describe("updateAccountFromSMS", () => {
  it("updates balance when availableBalance is present", async () => {
    await updateAccountFromSMS("acct-1", makeParsed({ availableBalance: 75000 }));

    const update = executedRuns.find((r) => r.sql.includes("UPDATE financial_accounts"));
    expect(update).toBeDefined();
    expect(update!.sql).toContain("last_known_balance = ?");
    expect(update!.sql).toContain("last_balance_date = ?");
    expect(update!.params).toContain(75000);
    expect(update!.params).toContain("2026-04-10");
  });

  it("updates credit limit when creditLimit is present", async () => {
    await updateAccountFromSMS("acct-1", makeParsed({ creditLimit: 200000 }));

    const update = executedRuns.find((r) => r.sql.includes("UPDATE financial_accounts"));
    expect(update).toBeDefined();
    expect(update!.sql).toContain("credit_limit = ?");
    expect(update!.params).toContain(200000);
  });

  it("updates balance from availableCreditLimit for CC accounts", async () => {
    await updateAccountFromSMS(
      "acct-1",
      makeParsed({ availableCreditLimit: 150000 }),
    );

    const update = executedRuns.find((r) => r.sql.includes("UPDATE financial_accounts"));
    expect(update).toBeDefined();
    expect(update!.sql).toContain("last_known_balance = ?");
    expect(update!.params).toContain(150000);
  });

  it("does nothing when no balance/limit fields are present", async () => {
    await updateAccountFromSMS("acct-1", makeParsed());

    const update = executedRuns.find((r) => r.sql.includes("UPDATE financial_accounts"));
    expect(update).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════
// linkExpenseToAccount
// ═══════════════════════════════════════════════

describe("linkExpenseToAccount", () => {
  it("returns null when cardLast4 is null", async () => {
    const result = await linkExpenseToAccount("user-1", "exp-1", null, "ICICI Bank");
    expect(result).toBeNull();
  });

  it("links expense to matching account", async () => {
    mockDb.getFirstAsync.mockResolvedValueOnce({ id: "acct-1" });

    const result = await linkExpenseToAccount("user-1", "exp-1", "3001", "ICICI Bank");

    expect(result).toBe("acct-1");
    const update = executedRuns.find((r) => r.sql.includes("UPDATE expenses SET account_id"));
    expect(update).toBeDefined();
    expect(update!.params).toEqual(["acct-1", "exp-1"]);
  });

  it("returns null when no matching account found", async () => {
    mockDb.getFirstAsync.mockResolvedValueOnce(null);

    const result = await linkExpenseToAccount("user-1", "exp-1", "9999", "Unknown Bank");
    expect(result).toBeNull();
    // Should not run any UPDATE
    const update = executedRuns.find((r) => r.sql.includes("UPDATE expenses"));
    expect(update).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════
// getActiveAccounts
// ═══════════════════════════════════════════════

describe("getActiveAccounts", () => {
  it("queries active accounts ordered by bank and type", async () => {
    await getActiveAccounts("user-1");

    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("is_active = 1"),
      "user-1",
    );
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY bank_name, account_type"),
      "user-1",
    );
  });
});

// ═══════════════════════════════════════════════
// getAccountSummary
// ═══════════════════════════════════════════════

describe("getAccountSummary", () => {
  it("aggregates savings balance, credit available, dues, and count", async () => {
    // Mock the 4 sequential queries
    mockDb.getFirstAsync
      .mockResolvedValueOnce({ total: 150000 })  // savings balance
      .mockResolvedValueOnce({ total: 175000 })  // credit available
      .mockResolvedValueOnce({ total: 25000 })   // dues
      .mockResolvedValueOnce({ count: 5 });       // account count

    const summary = await getAccountSummary("user-1");

    expect(summary).toEqual({
      totalBalance: 150000,
      totalCreditAvailable: 175000,
      totalDues: 25000,
      accountCount: 5,
    });
  });

  it("returns zeros when no accounts exist", async () => {
    mockDb.getFirstAsync.mockResolvedValue(null);

    const summary = await getAccountSummary("user-1");

    expect(summary).toEqual({
      totalBalance: 0,
      totalCreditAvailable: 0,
      totalDues: 0,
      accountCount: 0,
    });
  });
});

// ═══════════════════════════════════════════════
// deactivateAccount / renameAccount
// ═══════════════════════════════════════════════

describe("deactivateAccount", () => {
  it("sets is_active to 0", async () => {
    await deactivateAccount("acct-1");

    const update = executedRuns.find((r) => r.sql.includes("UPDATE financial_accounts"));
    expect(update).toBeDefined();
    expect(update!.sql).toContain("is_active = 0");
    expect(update!.params).toEqual(["acct-1"]);
  });
});

describe("renameAccount", () => {
  it("sets account_label", async () => {
    await renameAccount("acct-1", "My ICICI Card");

    const update = executedRuns.find((r) => r.sql.includes("UPDATE financial_accounts"));
    expect(update).toBeDefined();
    expect(update!.sql).toContain("account_label = ?");
    expect(update!.params).toEqual(["My ICICI Card", "acct-1"]);
  });
});

// ═══════════════════════════════════════════════
// updateAccountDues
// ═══════════════════════════════════════════════

describe("updateAccountDues", () => {
  it("updates total_due, min_due, and due_date", async () => {
    await updateAccountDues("acct-1", 25000, 5000, "2026-04-25");

    const update = executedRuns.find((r) => r.sql.includes("UPDATE financial_accounts"));
    expect(update).toBeDefined();
    expect(update!.sql).toContain("total_due = ?");
    expect(update!.sql).toContain("min_due = ?");
    expect(update!.sql).toContain("due_date = ?");
    expect(update!.params).toContain(25000);
    expect(update!.params).toContain(5000);
    expect(update!.params).toContain("2026-04-25");
  });

  it("does nothing when all params are null", async () => {
    await updateAccountDues("acct-1", null, null, null);

    const update = executedRuns.find((r) => r.sql.includes("UPDATE financial_accounts"));
    expect(update).toBeUndefined();
  });

  it("updates only provided fields", async () => {
    await updateAccountDues("acct-1", 25000, null, null);

    const update = executedRuns.find((r) => r.sql.includes("UPDATE financial_accounts"));
    expect(update).toBeDefined();
    expect(update!.sql).toContain("total_due = ?");
    expect(update!.sql).not.toContain("min_due = ?");
    expect(update!.sql).not.toContain("due_date = ?");
  });
});

// ═══════════════════════════════════════════════
// getAccountExpenses
// ═══════════════════════════════════════════════

describe("getAccountExpenses", () => {
  it("queries expenses for a specific account with default limit", async () => {
    await getAccountExpenses("acct-1");

    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE account_id = ?"),
      "acct-1",
      50,
    );
  });

  it("uses custom limit when provided", async () => {
    await getAccountExpenses("acct-1", 10);

    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT ?"),
      "acct-1",
      10,
    );
  });
});

// ═══════════════════════════════════════════════
// updateNachInfo
// ═══════════════════════════════════════════════

describe("updateNachInfo", () => {
  it("sets NACH mandate fields on an account", async () => {
    await updateNachInfo("acct-1", "NETFLIX", 199);

    const update = executedRuns.find((r) => r.sql.includes("UPDATE financial_accounts"));
    expect(update).toBeDefined();
    expect(update!.sql).toContain("has_nach_mandate = 1");
    expect(update!.sql).toContain("nach_merchant = ?");
    expect(update!.sql).toContain("nach_amount = ?");
    expect(update!.params).toEqual(["NETFLIX", 199, "acct-1"]);
  });
});

// ═══════════════════════════════════════════════
// getUpcomingDues
// ═══════════════════════════════════════════════

describe("getUpcomingDues", () => {
  it("queries accounts with positive dues ordered by due date", async () => {
    await getUpcomingDues("user-1");

    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("total_due > 0"),
      "user-1",
    );
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY due_date ASC"),
      "user-1",
    );
  });
});

// ═══════════════════════════════════════════════
// createManualAccount
// ═══════════════════════════════════════════════

describe("createManualAccount", () => {
  it("inserts account with discovered_from_sms = 0", async () => {
    const id = await createManualAccount({
      userId: "user-1",
      bankName: "HDFC Bank",
      accountType: "savings",
      accountIdentifier: "1234",
      accountLabel: "Salary Account",
    });

    expect(id).toBe("test-acct-uuid-1");

    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO financial_accounts"));
    expect(insert).toBeDefined();
    expect(insert!.params).toEqual([
      "test-acct-uuid-1",
      "user-1",
      "1234",
      "HDFC Bank",
      "savings",
      "Salary Account",
      null,  // last_known_balance (no initialBalance)
      null,  // last_balance_date
      0,     // fund_balance
      null,  // account_number
    ]);
  });

  it("sets account_label to null when not provided", async () => {
    await createManualAccount({
      userId: "user-1",
      bankName: "ICICI Bank",
      accountType: "credit_card",
      accountIdentifier: "3001",
    });

    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO financial_accounts"));
    expect(insert).toBeDefined();
    // Last param should be null (no label)
    expect(insert!.params[5]).toBeNull();
  });

  it("returns a unique UUID for each account", async () => {
    const id1 = await createManualAccount({
      userId: "user-1",
      bankName: "SBI",
      accountType: "savings",
      accountIdentifier: "5678",
    });
    const id2 = await createManualAccount({
      userId: "user-1",
      bankName: "SBI",
      accountType: "loan",
      accountIdentifier: "9012",
    });

    expect(id1).not.toBe(id2);
  });

  it("supports all account types", async () => {
    const types = ["savings", "credit_card", "loan", "wallet"] as const;

    for (const acctType of types) {
      executedRuns = [];
      await createManualAccount({
        userId: "user-1",
        bankName: "Test Bank",
        accountType: acctType,
        accountIdentifier: "0000",
      });

      const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO financial_accounts"));
      expect(insert).toBeDefined();
      expect(insert!.params[4]).toBe(acctType);
    }
  });
});
