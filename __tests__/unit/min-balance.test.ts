/**
 * v15.5.0 — Savings min-balance alert detection + ack tests.
 *
 * Pure behavior tests — no DB, just MMKV mock for the ack path.
 */

const mmkvBacking: Record<string, unknown> = {};

jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: jest.fn((k: string) => mmkvBacking[k] as boolean | undefined),
    set: jest.fn((k: string, v: unknown) => {
      mmkvBacking[k] = v;
    }),
    delete: jest.fn((k: string) => {
      delete mmkvBacking[k];
    }),
  })),
}));

import {
  detectBreaches,
  acknowledgeBreach,
  isAcknowledged,
  clearAcknowledgement,
  unacknowledgedBreaches,
  type BreachedAccount,
} from "../../services/min-balance";
import type { FinancialAccount } from "../../services/financial-account";

function savings(id: string, overrides: Partial<FinancialAccount> = {}): FinancialAccount {
  return {
    id,
    user_id: "u1",
    account_identifier: id.slice(-4).padStart(4, "0"),
    bank_name: "HDFC Bank",
    account_type: "savings",
    account_label: null,
    credit_limit: null,
    last_known_balance: 0,
    last_balance_date: null,
    total_due: null,
    min_due: null,
    due_date: null,
    is_active: 1,
    closed_at: null,
    closed_note: null,
    discovered_from_sms: 0,
    fund_balance: 0,
    account_number: null,
    last_balance_sms_id: null,
    min_balance: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  for (const k of Object.keys(mmkvBacking)) delete mmkvBacking[k];
});

describe("detectBreaches", () => {
  it("returns empty when no accounts have min_balance set", () => {
    const accounts = [savings("a"), savings("b")];
    const balances = { a: 500, b: 100 };
    expect(detectBreaches(accounts, balances)).toEqual([]);
  });

  it("flags a savings account below its min_balance", () => {
    const accounts = [savings("a", { min_balance: 10000 })];
    const balances = { a: 7500 };
    const result = detectBreaches(accounts, balances);
    expect(result).toHaveLength(1);
    expect(result[0].account.id).toBe("a");
    expect(result[0].currentBalance).toBe(7500);
    expect(result[0].threshold).toBe(10000);
    expect(result[0].shortfall).toBe(2500);
  });

  it("does NOT flag when the balance exactly equals min_balance (strict less-than)", () => {
    const accounts = [savings("a", { min_balance: 10000 })];
    const balances = { a: 10000 };
    expect(detectBreaches(accounts, balances)).toEqual([]);
  });

  it("does NOT flag when balance is just above min_balance", () => {
    const accounts = [savings("a", { min_balance: 10000 })];
    const balances = { a: 10000.01 };
    expect(detectBreaches(accounts, balances)).toEqual([]);
  });

  it("skips non-savings accounts even if they'd be 'breached' by balance math", () => {
    // CC / wallet / loan / demat with min_balance (shouldn't happen in
    // practice but the detector must honour the type filter).
    const accounts: FinancialAccount[] = [
      savings("cc1", { account_type: "credit_card", min_balance: 10000 }),
      savings("w1", { account_type: "wallet", min_balance: 500 }),
      savings("loan1", { account_type: "loan", min_balance: 1000 }),
    ];
    const balances = { cc1: 0, w1: 0, loan1: 0 };
    expect(detectBreaches(accounts, balances)).toEqual([]);
  });

  it("skips accounts with null computed balance (no signal yet)", () => {
    const accounts = [savings("a", { min_balance: 10000 })];
    const balances: Record<string, number | null> = { a: null };
    expect(detectBreaches(accounts, balances)).toEqual([]);
  });

  it("skips accounts with min_balance <= 0 (feature off)", () => {
    const accounts = [
      savings("a", { min_balance: 0 }),
      savings("b", { min_balance: -100 }),
    ];
    const balances = { a: -50, b: -200 };
    expect(detectBreaches(accounts, balances)).toEqual([]);
  });

  it("returns multiple breaches when multiple savings accounts drop below", () => {
    const accounts = [
      savings("a", { min_balance: 10000 }),
      savings("b", { min_balance: 5000 }),
      savings("c", { min_balance: 1000 }),
    ];
    const balances = { a: 2000, b: 6000, c: 500 };
    const result = detectBreaches(accounts, balances);
    expect(result.map((r) => r.account.id).sort()).toEqual(["a", "c"]);
  });

  it("computes shortfall as threshold minus current (positive number)", () => {
    const accounts = [savings("a", { min_balance: 10000 })];
    const balances = { a: -500 }; // overdrawn!
    const result = detectBreaches(accounts, balances);
    expect(result[0].shortfall).toBe(10500);
  });
});

describe("ack MMKV flow", () => {
  it("isAcknowledged defaults to false", () => {
    expect(isAcknowledged("a", "2026-04")).toBe(false);
  });

  it("acknowledgeBreach makes isAcknowledged return true for the same (id, month)", () => {
    acknowledgeBreach("a", "2026-04");
    expect(isAcknowledged("a", "2026-04")).toBe(true);
  });

  it("ack for April does NOT leak into May (per-month scoping)", () => {
    acknowledgeBreach("a", "2026-04");
    expect(isAcknowledged("a", "2026-05")).toBe(false);
  });

  it("ack for account A does NOT leak to account B", () => {
    acknowledgeBreach("a", "2026-04");
    expect(isAcknowledged("b", "2026-04")).toBe(false);
  });

  it("clearAcknowledgement removes the ack", () => {
    acknowledgeBreach("a", "2026-04");
    expect(isAcknowledged("a", "2026-04")).toBe(true);
    clearAcknowledgement("a", "2026-04");
    expect(isAcknowledged("a", "2026-04")).toBe(false);
  });
});

describe("unacknowledgedBreaches", () => {
  it("filters breaches to only those not ack'd this month", () => {
    const breaches: BreachedAccount[] = [
      {
        account: savings("a", { min_balance: 10000 }),
        currentBalance: 5000,
        threshold: 10000,
        shortfall: 5000,
      },
      {
        account: savings("b", { min_balance: 5000 }),
        currentBalance: 3000,
        threshold: 5000,
        shortfall: 2000,
      },
    ];
    acknowledgeBreach("a", "2026-04");
    const filtered = unacknowledgedBreaches(breaches, "2026-04");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].account.id).toBe("b");
  });

  it("returns all breaches when no acks are set", () => {
    const breaches: BreachedAccount[] = [
      {
        account: savings("a", { min_balance: 10000 }),
        currentBalance: 5000,
        threshold: 10000,
        shortfall: 5000,
      },
    ];
    expect(unacknowledgedBreaches(breaches, "2026-04")).toHaveLength(1);
  });
});
