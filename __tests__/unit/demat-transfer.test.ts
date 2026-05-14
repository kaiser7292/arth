/**
 * Demat-transfer side-effect tests.
 *
 * Covers:
 *   - handleDematTransferSideEffects upserts the correct snapshot table
 *     additively and stamps demat_target + investment_bucket_id on the
 *     account_transfers row
 *   - Optional bucket contribution is created when bucketId provided
 *   - reverseDematTransferSideEffectsInTxn subtracts the snapshot delta, deletes
 *     the contribution, and clears the stamps
 *   - reverse is a no-op for transfers that were never categorized
 */

let executedRuns: { sql: string; params: unknown[] }[] = [];
let firstAsyncQueue: (Record<string, unknown> | null)[] = [];

const mockDb = {
  getAllAsync: jest.fn(async () => []),
  getFirstAsync: jest.fn(async () => {
    return firstAsyncQueue.length > 0 ? firstAsyncQueue.shift()! : null;
  }),
  runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    executedRuns.push({ sql, params });
    return { changes: 1, lastInsertRowId: 1 };
  }),
  withTransactionAsync: jest.fn(async (cb: () => Promise<void>) => cb()),
};

jest.mock("../../database", () => ({
  getDatabase: () => mockDb,
}));

jest.mock("../../services/settings", () => ({
  bumpDataVersion: jest.fn(),
}));

// Avoid pulling in the real investment-contribution flow; record the calls instead.
const mockCreateContribution = jest.fn(async () => "contrib-1");
const mockDeleteContribution = jest.fn(async () => {});
jest.mock("../../services/yearly-plan", () => ({
  createInvestmentContribution: (...args: unknown[]) => mockCreateContribution(...args as []),
  deleteInvestmentContribution: (...args: unknown[]) => mockDeleteContribution(...args as []),
}));

import {
    handleDematTransferSideEffects,
    reverseDematTransferSideEffectsInTxn,
} from "../../services/demat-transfer";

beforeEach(() => {
  executedRuns = [];
  firstAsyncQueue = [];
  mockCreateContribution.mockClear();
  mockDeleteContribution.mockClear();
});

describe("handleDematTransferSideEffects — fund target", () => {
  it("inserts a new fund snapshot at baseline + amount when no snapshot exists for the date", async () => {
    // 1st call: SELECT existing snapshot for (account, date) — none
    // 2nd call: SELECT latest on-or-before — assume 10,000
    firstAsyncQueue = [null, { value: 10000 }];

    await handleDematTransferSideEffects(
      "txfr-1",
      "demat-acct-1",
      5000,
      "2026-04-28",
      { target: "fund" },
    );

    const insert = executedRuns.find((r) =>
      r.sql.includes("INSERT INTO demat_fund_snapshots"),
    );
    expect(insert).toBeDefined();
    // params: (account_id, date, baseline + amount)
    expect(insert!.params).toEqual(["demat-acct-1", "2026-04-28", 15000]);

    // Stamp written back to account_transfers
    const stamp = executedRuns.find((r) =>
      r.sql.includes("UPDATE account_transfers") &&
        r.sql.includes("SET demat_target"),
    );
    expect(stamp).toBeDefined();
    expect(stamp!.params[0]).toBe("fund");
  });

  it("adds to an existing same-date fund snapshot instead of replacing it", async () => {
    // 1st call: existing snapshot for date — 3,000
    firstAsyncQueue = [{ id: "snap-1", value: 3000 }];

    await handleDematTransferSideEffects(
      "txfr-2",
      "demat-acct-1",
      2000,
      "2026-04-28",
      { target: "fund" },
    );

    // Should UPDATE the existing row to 5,000 (additive), not INSERT a new one
    const update = executedRuns.find((r) =>
      r.sql.includes("UPDATE demat_fund_snapshots SET fund_value"),
    );
    expect(update).toBeDefined();
    expect(update!.params[0]).toBe(5000);
    expect(update!.params[1]).toBe("snap-1");

    const inserts = executedRuns.filter((r) =>
      r.sql.includes("INSERT INTO demat_fund_snapshots"),
    );
    expect(inserts).toHaveLength(0);
  });
});

describe("handleDematTransferSideEffects — portfolio target", () => {
  it("targets demat_portfolio_snapshots and portfolio_value", async () => {
    firstAsyncQueue = [null, { value: 0 }];

    await handleDematTransferSideEffects(
      "txfr-3",
      "demat-acct-1",
      50000,
      "2026-04-28",
      { target: "portfolio" },
    );

    const insert = executedRuns.find((r) =>
      r.sql.includes("INSERT INTO demat_portfolio_snapshots"),
    );
    expect(insert).toBeDefined();
    expect(insert!.params).toEqual(["demat-acct-1", "2026-04-28", 50000]);

    // Must NOT touch fund_snapshots
    const fundTouched = executedRuns.find((r) =>
      r.sql.includes("demat_fund_snapshots"),
    );
    expect(fundTouched).toBeUndefined();
  });
});

describe("handleDematTransferSideEffects — bucket linking", () => {
  it("creates an investment_contribution when bucketId is provided", async () => {
    firstAsyncQueue = [null, { value: 0 }];

    await handleDematTransferSideEffects(
      "txfr-4",
      "demat-acct-1",
      1000,
      "2026-04-28",
      { target: "fund", bucketId: "bucket-sip" },
    );

    expect(mockCreateContribution).toHaveBeenCalledTimes(1);
    expect(mockCreateContribution).toHaveBeenCalledWith({
      investment_bucket_id: "bucket-sip",
      month: "2026-04",
      amount: 1000,
      date: "2026-04-28",
      notes: "Auto from transfer (fund)",
    });

    const stamp = executedRuns.find((r) =>
      r.sql.includes("UPDATE account_transfers") &&
        r.sql.includes("SET demat_target"),
    );
    expect(stamp!.params[1]).toBe("bucket-sip");
    // params[2] is linked_contribution_id — the id returned by the mocked
    // createInvestmentContribution ("contrib-1")
    expect(stamp!.params[2]).toBe("contrib-1");
  });

  it("skips contribution creation when no bucket is picked", async () => {
    firstAsyncQueue = [null, { value: 0 }];

    await handleDematTransferSideEffects(
      "txfr-5",
      "demat-acct-1",
      1000,
      "2026-04-28",
      { target: "fund" },
    );

    expect(mockCreateContribution).not.toHaveBeenCalled();
    const stamp = executedRuns.find((r) =>
      r.sql.includes("UPDATE account_transfers") &&
        r.sql.includes("SET demat_target"),
    );
    expect(stamp!.params[1]).toBeNull();
    // params[2] is linked_contribution_id — null when no bucket linked
    expect(stamp!.params[2]).toBeNull();
  });
});

describe("handleDematTransferSideEffects — validation", () => {
  it("rejects a non-positive amount", async () => {
    await expect(
      handleDematTransferSideEffects("t", "a", 0, "2026-04-28", { target: "fund" }),
    ).rejects.toThrow(/positive/);
    await expect(
      handleDematTransferSideEffects("t", "a", -100, "2026-04-28", { target: "fund" }),
    ).rejects.toThrow(/positive/);
  });
});

describe("reverseDematTransferSideEffectsInTxn", () => {
  it("subtracts the amount from the snapshot + deletes the contribution by PK + clears the stamps", async () => {
    // getFirstAsync sequence:
    //   1. Load the transfer row with stamped linked_contribution_id
    //   2. Load the snapshot for (account, date): 10,000 total
    firstAsyncQueue = [
      {
        amount: 2000,
        date: "2026-04-28",
        to_account_id: "demat-acct-1",
        demat_target: "fund",
        investment_bucket_id: "bucket-X",
        linked_contribution_id: "contrib-to-delete",
      },
      { id: "snap-X", value: 10000 },
    ];

    await reverseDematTransferSideEffectsInTxn("txfr-reverse");

    // Snapshot UPDATE to 8000
    const update = executedRuns.find((r) =>
      r.sql.includes("UPDATE demat_fund_snapshots SET fund_value"),
    );
    expect(update).toBeDefined();
    expect(update!.params[0]).toBe(8000);

    // Contribution deleted by PK (no fuzzy lookup)
    expect(mockDeleteContribution).toHaveBeenCalledWith(
      "contrib-to-delete",
      "bucket-X",
    );

    // Stamps cleared on account_transfers
    const stampClear = executedRuns.find((r) =>
      r.sql.includes("UPDATE account_transfers") &&
        r.sql.includes("demat_target = NULL"),
    );
    expect(stampClear).toBeDefined();
  });

  it("deletes the snapshot row entirely when the subtraction empties it", async () => {
    firstAsyncQueue = [
      {
        amount: 5000,
        date: "2026-04-28",
        to_account_id: "demat-acct-1",
        demat_target: "portfolio",
        investment_bucket_id: null,
        linked_contribution_id: null,
      },
      { id: "snap-empties", value: 5000 },
    ];

    await reverseDematTransferSideEffectsInTxn("txfr-empty");

    const del = executedRuns.find((r) =>
      r.sql.includes("DELETE FROM demat_portfolio_snapshots"),
    );
    expect(del).toBeDefined();

    // No contribution to delete
    expect(mockDeleteContribution).not.toHaveBeenCalled();
  });

  it("is a no-op for transfers that were never categorized (demat_target = NULL)", async () => {
    firstAsyncQueue = [
      {
        amount: 1000,
        date: "2026-04-28",
        to_account_id: "savings-1",
        demat_target: null,
        investment_bucket_id: null,
        linked_contribution_id: null,
      },
    ];

    await reverseDematTransferSideEffectsInTxn("txfr-plain");

    // No writes at all
    expect(executedRuns.filter((r) => r.sql.includes("UPDATE") || r.sql.includes("DELETE"))).toHaveLength(0);
    expect(mockDeleteContribution).not.toHaveBeenCalled();
  });
});
