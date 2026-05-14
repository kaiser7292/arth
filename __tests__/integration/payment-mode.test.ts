/**
 * PaymentMode service tests.
 */

import { DEFAULT_PAYMENT_MODES } from "../../database/defaults/payment-modes";

let executedRuns: { sql: string; params: unknown[] }[] = [];
let mockRows: Record<string, unknown[]> = {};

const mockDb = {
  getAllAsync: jest.fn(async (sql: string) => mockRows[sql] ?? []),
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
  generateUUID: () => `test-pm-uuid-${++mockUuidCounter}`,
}));

import {
  getPaymentModes,
  getPaymentModeById,
  createPaymentMode,
  updatePaymentMode,
  deletePaymentMode,
  seedDefaultPaymentModes,
} from "../../services/payment-mode";

beforeEach(() => {
  executedRuns = [];
  mockRows = {};
  mockUuidCounter = 0;
  jest.clearAllMocks();
});

describe("getPaymentModes", () => {
  it("queries active payment modes ordered by name", async () => {
    await getPaymentModes("user-1");
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("is_active = 1"),
      "user-1",
    );
  });
});

describe("getPaymentModeById", () => {
  it("queries by ID", async () => {
    await getPaymentModeById("pm-1");
    expect(mockDb.getFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = ?"),
      "pm-1",
    );
  });
});

describe("createPaymentMode", () => {
  it("inserts with generated UUID", async () => {
    const id = await createPaymentMode({
      user_id: "user-1",
      name: "Paytm",
      type: "wallet",
    });

    expect(id).toBe("test-pm-uuid-1");
    const insert = executedRuns.find((r) => r.sql.includes("INSERT INTO payment_modes"));
    expect(insert).toBeDefined();
    expect(insert!.params).toEqual(["test-pm-uuid-1", "user-1", "Paytm", "wallet"]);
  });
});

describe("updatePaymentMode", () => {
  it("updates only provided fields", async () => {
    await updatePaymentMode("pm-1", { name: "Renamed" });

    const update = executedRuns.find((r) => r.sql.includes("UPDATE payment_modes"));
    expect(update!.sql).toContain("name = ?");
    expect(update!.sql).not.toContain("type = ?");
    expect(update!.params).toEqual(["Renamed", "pm-1"]);
  });

  it("does nothing when no fields provided", async () => {
    await updatePaymentMode("pm-1", {});
    expect(executedRuns.length).toBe(0);
  });
});

describe("deletePaymentMode", () => {
  it("soft-deletes and returns linked expense count", async () => {
    mockRows["SELECT COUNT(*) as count FROM expenses WHERE payment_mode_id = ? AND deleted_at IS NULL;"] = [
      { count: 7 },
    ];

    const linked = await deletePaymentMode("pm-1");
    expect(linked).toBe(7);

    const update = executedRuns.find((r) =>
      r.sql.includes("UPDATE payment_modes SET is_active = 0"),
    );
    expect(update).toBeDefined();
  });
});

describe("seedDefaultPaymentModes", () => {
  it("seeds 6 payment modes when user has none", async () => {
    mockRows["SELECT COUNT(*) as count FROM payment_modes WHERE user_id = ?;"] = [
      { count: 0 },
    ];

    const count = await seedDefaultPaymentModes("user-1");
    expect(count).toBe(6);

    const inserts = executedRuns.filter((r) =>
      r.sql.includes("INSERT INTO payment_modes"),
    );
    expect(inserts.length).toBe(6);
    expect(inserts[0].params).toContain("user-1");
    expect(inserts[0].params).toContain(DEFAULT_PAYMENT_MODES[0].name);
    expect(inserts[0].params).toContain(DEFAULT_PAYMENT_MODES[0].type);
  });

  it("skips seeding when user already has payment modes", async () => {
    mockRows["SELECT COUNT(*) as count FROM payment_modes WHERE user_id = ?;"] = [
      { count: 3 },
    ];

    const count = await seedDefaultPaymentModes("user-1");
    expect(count).toBe(0);
    expect(executedRuns.length).toBe(0);
  });
});

describe("DEFAULT_PAYMENT_MODES", () => {
  it("has exactly 6 payment modes", () => {
    expect(DEFAULT_PAYMENT_MODES.length).toBe(6);
  });

  it("all have valid types", () => {
    const validTypes = ["credit_card", "debit_card", "upi", "cash", "wallet", "bank_transfer"];
    DEFAULT_PAYMENT_MODES.forEach((pm) => {
      expect(validTypes).toContain(pm.type);
      expect(pm.name).toBeTruthy();
    });
  });

  it("has 1 credit card, 1 bank transfer, 1 debit card, 1 UPI", () => {
    const counts = DEFAULT_PAYMENT_MODES.reduce(
      (acc, pm) => {
        acc[pm.type] = (acc[pm.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    expect(counts.credit_card).toBe(1);
    expect(counts.bank_transfer).toBe(1);
    expect(counts.debit_card).toBe(1);
    expect(counts.upi).toBe(1);
  });
});
