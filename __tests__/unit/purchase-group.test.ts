/**
 * Split-tender (purchase-group) service tests.
 */

let executedRuns: { sql: string; params: unknown[] }[] = [];
let getFirstResult: Record<string, unknown> | null = null;
let getAllResult: Record<string, unknown>[] = [];

const mockDb = {
  getAllAsync: jest.fn(async () => getAllResult),
  getFirstAsync: jest.fn(async () => getFirstResult),
  runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    executedRuns.push({ sql, params });
    return { changes: 1, lastInsertRowId: 1 };
  }),
  withTransactionAsync: jest.fn(async (cb: () => Promise<void>) => cb()),
};

jest.mock("../../database", () => ({
  getDatabase: () => mockDb,
}));

let mockUuidCounter = 0;
jest.mock("../../utils/uuid", () => ({
  generateUUID: () => `test-id-${++mockUuidCounter}`,
}));

jest.mock("../../services/settings", () => ({
  bumpDataVersion: jest.fn(),
}));

jest.mock("../../services/merchant-alias", () => ({
  learnMerchantAlias: jest.fn(),
}));

jest.mock("../../services/smart-categorizer", () => ({
  categorizeByMerchant: jest.fn(() => null),
}));

jest.mock("../../services/account-master", () => ({
  findPaymentModeByType: jest.fn(() => null),
}));

jest.mock("../../services/sms/bank-patterns", () => ({
  parseBankSMS: jest.fn(() => null),
  inferPaymentMode: jest.fn(() => null),
}));

import {
  createSplitTender,
  unlinkFromGroup,
  convertToSplitTender,
  addLegToExistingGroup,
  MAX_PURCHASE_GROUP_LEGS,
} from "../../services/purchase-group";

beforeEach(() => {
  executedRuns = [];
  getFirstResult = null;
  getAllResult = [];
  mockUuidCounter = 0;
  // Reset any test-local overrides of getFirstAsync back to the default
  // "return getFirstResult" behavior.
  mockDb.getFirstAsync.mockImplementation(async () => getFirstResult);
});

describe("createSplitTender", () => {
  it("creates one expense row per leg, all sharing one purchase_group_id", async () => {
    const { groupId, expenseIds } = await createSplitTender({
      shared: {
        user_id: "user-1",
        merchant_name: "Acme Cafe",
        date: "2026-04-28",
        category_id: "cat-food",
        is_right_spend: 0,
      },
      legs: [
        { amount: 1500, account_id: "acct-card", payment_mode_id: "pm-card" },
        { amount: 500, account_id: "acct-wallet", payment_mode_id: "pm-wallet" },
      ],
    });

    expect(expenseIds).toHaveLength(2);
    // Each leg should issue one INSERT into expenses with the same
    // purchase_group_id as its last parameter.
    const inserts = executedRuns.filter((r) => r.sql.startsWith("INSERT INTO expenses"));
    expect(inserts).toHaveLength(2);
    for (const ins of inserts) {
      expect(ins.params).toContain(groupId);
    }
  });

  it("rejects fewer than 2 legs", async () => {
    await expect(
      createSplitTender({
        shared: { user_id: "u", date: "2026-04-28" },
        legs: [{ amount: 100, account_id: "acct-1" }],
      }),
    ).rejects.toThrow(/at least 2 legs/);
  });

  it(`rejects more than ${MAX_PURCHASE_GROUP_LEGS} legs`, async () => {
    await expect(
      createSplitTender({
        shared: { user_id: "u", date: "2026-04-28" },
        legs: Array.from({ length: MAX_PURCHASE_GROUP_LEGS + 1 }, (_, i) => ({
          amount: 100,
          account_id: `acct-${i}`,
        })),
      }),
    ).rejects.toThrow(new RegExp(`up to ${MAX_PURCHASE_GROUP_LEGS} legs`));
  });

  it("rejects a leg with a non-positive amount", async () => {
    await expect(
      createSplitTender({
        shared: { user_id: "u", date: "2026-04-28" },
        legs: [
          { amount: 500, account_id: "acct-1" },
          { amount: 0, account_id: "acct-2" },
        ],
      }),
    ).rejects.toThrow(/positive/);
  });
});

describe("convertToSplitTender", () => {
  it("links the target expense to a new group and creates extra leg rows", async () => {
    // Anchor expense used as the first leg (standalone, no group yet)
    getFirstResult = {
      user_id: "user-1",
      purchase_group_id: null,
      merchant_name: "Acme Cafe",
      description: null,
      category_id: "cat-food",
      date: "2026-04-28",
      is_right_spend: 0,
    };

    const { groupId, newExpenseIds } = await convertToSplitTender("exp-main", [
      { amount: 500, account_id: "acct-wallet", payment_mode_id: "pm-wallet" },
    ]);

    expect(groupId).toBeTruthy();
    expect(newExpenseIds).toHaveLength(1);

    // Target should be UPDATEd to carry the new group id
    const targetUpdate = executedRuns.find((r) =>
      r.sql.includes("UPDATE expenses SET purchase_group_id = ?"),
    );
    expect(targetUpdate).toBeDefined();
    expect(targetUpdate!.params[0]).toBe(groupId);
    expect(targetUpdate!.params[1]).toBe("exp-main");

    // One INSERT for the new leg, carrying the same group id
    const inserts = executedRuns.filter((r) => r.sql.startsWith("INSERT INTO expenses"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params).toContain(groupId);
  });

  it("rejects when target is already in a group", async () => {
    getFirstResult = {
      user_id: "user-1",
      purchase_group_id: "existing-grp",
      merchant_name: "Acme",
      description: null,
      category_id: null,
      date: "2026-04-28",
      is_right_spend: null,
    };
    await expect(
      convertToSplitTender("exp-main", [{ amount: 100, account_id: "a" }]),
    ).rejects.toThrow(/already part/);
  });

  it(`rejects when 1 target + extras would exceed ${MAX_PURCHASE_GROUP_LEGS} legs`, async () => {
    getFirstResult = {
      user_id: "user-1",
      purchase_group_id: null,
      merchant_name: "Acme",
      description: null,
      category_id: null,
      date: "2026-04-28",
      is_right_spend: null,
    };
    const tooMany = Array.from({ length: MAX_PURCHASE_GROUP_LEGS }, (_, i) => ({
      amount: 100,
      account_id: `a-${i}`,
    }));
    await expect(convertToSplitTender("exp-main", tooMany)).rejects.toThrow(
      new RegExp(`up to ${MAX_PURCHASE_GROUP_LEGS} legs`),
    );
  });
});

describe("addLegToExistingGroup", () => {
  it("creates a new expense row carrying the existing group_id + inheriting shared fields", async () => {
    // Anchor leg is in group 'grp-1'; current count is 2 of 3 — room for one more.
    let callCount = 0;
    mockDb.getFirstAsync.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          user_id: "user-1",
          purchase_group_id: "grp-1",
          merchant_name: "Acme",
          description: "Lunch",
          category_id: "cat-food",
          date: "2026-04-28",
          is_right_spend: 1,
        };
      }
      return { n: 2 };
    });

    const newId = await addLegToExistingGroup("exp-existing-leg", {
      amount: 250,
      account_id: "acct-cash",
      payment_mode_id: "pm-cash",
    });

    expect(newId).toBeTruthy();
    const inserts = executedRuns.filter((r) => r.sql.startsWith("INSERT INTO expenses"));
    expect(inserts).toHaveLength(1);
    // The new row should carry grp-1 as its purchase_group_id
    expect(inserts[0].params).toContain("grp-1");
  });

  it("rejects when the group is already at cap", async () => {
    let callCount = 0;
    mockDb.getFirstAsync.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          user_id: "user-1",
          purchase_group_id: "grp-full",
          merchant_name: "Acme",
          description: null,
          category_id: null,
          date: "2026-04-28",
          is_right_spend: null,
        };
      }
      return { n: MAX_PURCHASE_GROUP_LEGS };
    });
    await expect(
      addLegToExistingGroup("exp-leg", { amount: 100, account_id: "a" }),
    ).rejects.toThrow(/maximum/);
  });

  it("rejects when the anchor expense isn't in a group", async () => {
    getFirstResult = {
      user_id: "user-1",
      purchase_group_id: null,
      merchant_name: "Acme",
      description: null,
      category_id: null,
      date: "2026-04-28",
      is_right_spend: null,
    };
    await expect(
      addLegToExistingGroup("exp-standalone", { amount: 100, account_id: "a" }),
    ).rejects.toThrow(/not part of/);
  });
});

describe("unlinkFromGroup", () => {
  it("unlinks the last remaining sibling when only one live leg is left", async () => {
    // The expense being unlinked belongs to 'grp-A'
    getFirstResult = { purchase_group_id: "grp-A" };
    // After clearing the first expense, only one live leg remains in the group
    getAllResult = [{ id: "leg-still-linked" }];

    await unlinkFromGroup("leg-1");

    // The implementation issues two UPDATE-to-NULL statements: one targeting the
    // expense passed in, and one sweeping the whole group (because only one
    // live leg remains — a 1-leg group is meaningless).
    const nullUpdates = executedRuns.filter((r) =>
      r.sql.includes("SET purchase_group_id = NULL"),
    );
    expect(nullUpdates.length).toBeGreaterThanOrEqual(2);
    // The group-wide sweep should target the group by id
    const sweep = nullUpdates.find((r) =>
      r.sql.includes("WHERE purchase_group_id = ?"),
    );
    expect(sweep?.params).toContain("grp-A");
  });

  it("is a no-op for a standalone expense (null purchase_group_id)", async () => {
    getFirstResult = { purchase_group_id: null };
    await unlinkFromGroup("exp-1");
    const nullUpdates = executedRuns.filter((r) =>
      r.sql.includes("SET purchase_group_id = NULL"),
    );
    expect(nullUpdates).toHaveLength(0);
  });
});
