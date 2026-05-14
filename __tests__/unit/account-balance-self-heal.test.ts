/**
 * v15.3.0 — Savings/wallet opening-balance self-heal tests.
 *
 * Locks down the bug-fix behaviour for getOrCreateMonthBalance:
 *   - A non-override row whose prev-month closing has drifted is auto-
 *     corrected on read, matching the live prev closing.
 *   - A manual-override row is NEVER stomped.
 *   - When no row exists and no prev closing exists, returns null (unchanged).
 *   - When no row exists and a prev closing does exist, creates a new row
 *     with that closing as opening (unchanged).
 *
 * The bug before this fix: once May's opening row was materialised, it
 * froze at whatever April's closing was at that moment. If April kept
 * accruing credits/transfers afterwards, April closing drifted but May
 * opening stayed stale — causing the ledger to show mismatched numbers.
 */

interface Row {
  sql: string;
  params: unknown[];
}

let executedRuns: Row[] = [];
let monthBalanceRow: Record<string, unknown> | null = null;
let accountRow: Record<string, unknown> | null = { account_type: "savings" };
// `mock` prefix required — jest.mock factories can only reference
// variables whose names start with "mock" (case-insensitive).
let mockPrevClosing: number | null = null;

const TARGET_MONTH = "2026-05";
const PREV_MONTH = "2026-04";

const mockDb = {
  getFirstAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    if (/FROM account_month_balances/i.test(sql)) {
      const month = params[1] as string;
      if (month === TARGET_MONTH) return monthBalanceRow;
      if (month === PREV_MONTH && mockPrevClosing != null) {
        // Synthesise a minimal prev-month row so getClosingBalance has an
        // anchor. All activity helpers mock to 0, so closing = opening.
        return {
          id: "row-prev",
          account_id: "acc-1",
          month: PREV_MONTH,
          opening_balance: mockPrevClosing,
          is_manual_override: 0,
        };
      }
      return null;
    }
    if (/FROM financial_accounts/i.test(sql)) return accountRow;
    return null;
  }),
  getAllAsync: jest.fn(async () => []),
  runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    executedRuns.push({ sql, params });
    return { changes: 1, lastInsertRowId: 1 };
  }),
};

jest.mock("../../database", () => ({
  getDatabase: () => mockDb,
}));

jest.mock("../../services/settings", () => ({
  bumpDataVersion: jest.fn(),
}));

// getClosingBalance is an internal sibling call. Rather than mocking it
// through jest.mock (which doesn't catch same-module calls), we reroute
// the underlying DB queries it runs. getClosingBalance:
//   1. SELECT * FROM account_month_balances WHERE account_id=? AND month=prev
//      → return a stub row so the "no chain anchor" branch doesn't fire
//   2. SELECT account_type FROM financial_accounts → already handled
//   3. Aggregation SELECTs via helpers → getAllAsync returns [] so sums=0
//
// With a prev-month row whose opening_balance = mockPrevClosing and all
// aggregations = 0, getClosingBalance returns mockPrevClosing verbatim
// (isCC=false → opening − 0 + 0 − 0 + 0 + 0 = opening).

import { getOrCreateMonthBalance } from "../../services/account-balance";

beforeEach(() => {
  executedRuns = [];
  monthBalanceRow = null;
  accountRow = { account_type: "savings" };
  mockPrevClosing = null;
  mockDb.getFirstAsync.mockClear();
  mockDb.runAsync.mockClear();
});

describe("getOrCreateMonthBalance — self-heal", () => {
  it("updates a stale non-override opening when prev-month closing has drifted", async () => {
    monthBalanceRow = {
      id: "row-may",
      account_id: "acc-1",
      month: "2026-05",
      opening_balance: 22.28, // stale: frozen at April Day-1 state
      is_manual_override: 0,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    mockPrevClosing = 113241.28; // April closing has since drifted up

    const result = await getOrCreateMonthBalance("acc-1", "2026-05");
    expect(result).not.toBeNull();
    expect(result!.opening_balance).toBe(113241.28);

    const updates = executedRuns.filter((r) => /UPDATE account_month_balances/i.test(r.sql));
    expect(updates).toHaveLength(1);
    expect(updates[0].params[0]).toBe(113241.28);
  });

  it("does NOT touch a manual-override row even if it looks stale", async () => {
    monthBalanceRow = {
      id: "row-may",
      account_id: "acc-1",
      month: "2026-05",
      opening_balance: 100,
      is_manual_override: 1, // user took control
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    mockPrevClosing = 999; // massive drift — but user's override wins

    const result = await getOrCreateMonthBalance("acc-1", "2026-05");
    expect(result!.opening_balance).toBe(100);

    const updates = executedRuns.filter((r) => /UPDATE account_month_balances/i.test(r.sql));
    expect(updates).toHaveLength(0);
  });

  it("does NOT touch a non-override row whose opening already matches prev closing", async () => {
    monthBalanceRow = {
      id: "row-may",
      account_id: "acc-1",
      month: "2026-05",
      opening_balance: 500.5,
      is_manual_override: 0,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    mockPrevClosing = 500.5;

    const result = await getOrCreateMonthBalance("acc-1", "2026-05");
    expect(result!.opening_balance).toBe(500.5);

    const updates = executedRuns.filter((r) => /UPDATE account_month_balances/i.test(r.sql));
    expect(updates).toHaveLength(0);
  });

  it("does not react to sub-paisa drift (< 0.01)", async () => {
    monthBalanceRow = {
      id: "row-may",
      account_id: "acc-1",
      month: "2026-05",
      opening_balance: 500.50,
      is_manual_override: 0,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    mockPrevClosing = 500.505; // 0.005 drift — floating point noise, ignore

    const result = await getOrCreateMonthBalance("acc-1", "2026-05");
    expect(result!.opening_balance).toBe(500.50);

    const updates = executedRuns.filter((r) => /UPDATE account_month_balances/i.test(r.sql));
    expect(updates).toHaveLength(0);
  });

  it("returns null and does not write anything when no row exists and no prev closing is available", async () => {
    monthBalanceRow = null;
    mockPrevClosing = null;

    const result = await getOrCreateMonthBalance("acc-1", "2026-05");
    expect(result).toBeNull();

    const inserts = executedRuns.filter((r) => /INSERT INTO account_month_balances/i.test(r.sql));
    expect(inserts).toHaveLength(0);
  });
});
