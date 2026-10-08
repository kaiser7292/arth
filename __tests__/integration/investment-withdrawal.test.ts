import { DatabaseSync } from "node:sqlite";

/**
 * Investment withdrawal end to end — real schema, real SMS path:
 *   - a redemption SMS credit is flagged for review, not left as income
 *   - full withdrawal: the credit becomes a transfer out of the investment and the
 *     demat's cash balance drops; undo puts both back
 *   - partial withdrawal: only the amount taken out moves, the rest stays as gain;
 *     the bucket goes down; deleting the transfer restores the credit and the bucket
 *   - quick-add: an investment that wasn't in Arth is created, ends at what's left, closes at 0
 */
let mockDb: DatabaseSync;
const flat = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params);
const mockAdapter = {
  execAsync: async (sql: string) => {
    mockDb.exec(sql);
  },
  runAsync: async (sql: string, ...params: unknown[]) => {
    const r = mockDb.prepare(sql).run(...(flat(params) as never[]));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).all(...(flat(params) as never[])),
  getFirstAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).get(...(flat(params) as never[])) ?? null,
  withTransactionAsync: async (fn: () => Promise<void>) => {
    mockDb.exec("BEGIN");
    try {
      await fn();
      mockDb.exec("COMMIT");
    } catch (e) {
      mockDb.exec("ROLLBACK");
      throw e;
    }
  },
};

const mockStore = new Map<string, string | number | boolean>();
jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: (k: string) => mockStore.get(k) as boolean | undefined,
    getNumber: (k: string) => mockStore.get(k) as number | undefined,
    getString: (k: string) => mockStore.get(k) as string | undefined,
    set: (k: string, v: string | number | boolean) => mockStore.set(k, v),
    delete: (k: string) => mockStore.delete(k),
    getAllKeys: () => [...mockStore.keys()],
    contains: (k: string) => mockStore.has(k),
  })),
}));

import { runMigrations } from "../../database/migrations";
import { seedDefaultUser } from "../../database/seed";
import { deleteTransfer, undoTransfer } from "../../services/account-transfer";
import { computeUnseededBalance, getMonthBalanceSummary } from "../../services/account-balance";
import { addOrUpdateFundSnapshot, createManualAccount, saveBrokerSnapshot } from "../../services/financial-account";
import { createTransfer } from "../../services/account-transfer";
import { handleDematTransferSideEffects } from "../../services/demat-transfer";
import { getInvestmentProduct } from "../../services/investment-accounts";
import { recordInvestmentWithdrawal } from "../../services/investment-withdrawal";
import { createInvestmentBucket, createYearlyPlan } from "../../services/yearly-plan";
import { parseSmsBatch } from "../../services/sms/sms-parser";
import { createExpenseFromSms } from "../../services/sms/sms-to-expense";

let U = "";
let SBI = "";
let DEMAT = "";
let smsSeq = 0;

async function receive(address: string, body: string): Promise<string> {
  smsSeq++;
  const res = await parseSmsBatch(U, [{ _id: `sms-${smsSeq}`, address, body, date: Date.UTC(2026, 8, 1) + smsSeq } as never]);
  const item = res.items[0];
  if (!item) throw new Error(`Not parsed: ${body}`);
  const out = await createExpenseFromSms(U, item.pendingSmsId, item.parsed, item.rawBody, item.smsDate);
  return out.expenseId!;
}

const row = (id: string) => mockDb.prepare(`SELECT * FROM expenses WHERE id = ?`).get(id) as Record<string, unknown>;
const transfers = () =>
  mockDb.prepare(`SELECT * FROM account_transfers WHERE deleted_at IS NULL`).all() as Record<string, unknown>[];
const fundOn = (accountId: string, date: string) =>
  (mockDb.prepare(`SELECT fund_value FROM demat_fund_snapshots WHERE account_id = ? AND snapshot_date = ?`).get(accountId, date) as
    | { fund_value: number }
    | undefined)?.fund_value;
const bucketContributed = (id: string) =>
  (mockDb.prepare(`SELECT current_contributed FROM investment_buckets WHERE id = ?`).get(id) as { current_contributed: number })
    .current_contributed;

const SBI_REDEMPTION_150K =
  "Your A/C XXXXX798812 Credited INR 1,50,000.00 on 15/09/26 -Deposit by transfer from ICCL MF REDEMPTION. Avl Bal INR 2,62,305.01-SBI";
const SBI_SALARY =
  "Your A/C XXXXX798812 Credited INR 90,000.00 on 01/09/26 -Deposit by transfer from ACME PVT LTD SALARY. Avl Bal INR 1,12,305.01-SBI";

async function credit(amount: number, date = "2026-09-15"): Promise<string> {
  const id = `c-${amount}-${date}`;
  mockDb
    .prepare(
      `INSERT INTO expenses (id, user_id, amount, merchant_name, date, nature, status, source, account_id, created_at, updated_at)
       VALUES (?, ?, ?, 'Zerodha', ?, 'credit', 'pending_review', 'manual', ?, datetime('now'), datetime('now'))`,
    )
    .run(id, U, amount, date, SBI);
  return id;
}

beforeEach(async () => {
  mockDb = new DatabaseSync(":memory:");
  mockStore.clear();
  smsSeq = 0;
  await runMigrations(mockAdapter as never);
  U = await seedDefaultUser(mockAdapter as never);
  SBI = await createManualAccount({ userId: U, bankName: "SBI", accountType: "savings", accountIdentifier: "8812" });
  DEMAT = await createManualAccount({ userId: U, bankName: "Zerodha", accountType: "demat", accountIdentifier: "ZR01" });
  await addOrUpdateFundSnapshot(DEMAT, "2026-09-01", 200000);
});

describe("SMS detection", () => {
  it("a redemption credit is flagged as an investment withdrawal", async () => {
    const id = await receive("VM-SBIINB", SBI_REDEMPTION_150K);
    expect(row(id).money_event).toBe("investment_withdrawal");
    expect(row(id).status).toBe("pending_review");
  });

  it("a salary credit is left alone", async () => {
    const id = await receive("VM-SBIINB", SBI_SALARY);
    expect(row(id).money_event).toBeNull();
  });
});

describe("full withdrawal", () => {
  it("moves the whole credit out of the demat and lowers its cash; undo restores both", async () => {
    const id = await credit(50000);
    const r = await recordInvestmentWithdrawal({ creditId: id, investmentAccountId: DEMAT, withdrawnAmount: 50000 });
    expect(r.gain).toBe(0);

    const t = transfers();
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ from_account_id: DEMAT, to_account_id: SBI, amount: 50000, demat_target: "withdrawal" });
    expect(row(id).reclassified_as_transfer).toBe(1);
    expect(row(id).status).toBe("approved");
    expect(fundOn(DEMAT, "2026-09-15")).toBe(150000);

    await undoTransfer(r.transferId);
    expect(row(id).reclassified_as_transfer).toBe(0);
    expect(fundOn(DEMAT, "2026-09-15")).toBe(200000);
  });

  it("refuses FDs, splits and amounts above the credit", async () => {
    const id = await credit(1000);
    await expect(recordInvestmentWithdrawal({ creditId: id, investmentAccountId: DEMAT, withdrawnAmount: 1500 })).rejects.toThrow(
      /more than/,
    );
    await expect(recordInvestmentWithdrawal({ creditId: id, investmentAccountId: SBI, withdrawnAmount: 1000 })).rejects.toThrow(
      /investment account/,
    );
  });
});

describe("partial withdrawal", () => {
  it("moves only the amount taken out; the rest stays as gain; the bucket goes down", async () => {
    const plan = await createYearlyPlan({
      user_id: U,
      financial_year: "2026",
      annual_salary_in_hand: 1200000,
      total_planned_expenses: 600000,
      total_planned_investments: 500000,
      savings_rate_target_pct: 40,
    });
    const bucket = await createInvestmentBucket({ yearly_plan_id: plan, financial_year: "2026", user_id: U, name: "Equity", annual_target: 500000 });
    mockDb.prepare(`INSERT INTO investment_contributions (id, investment_bucket_id, month, amount, date) VALUES ('seed', ?, '2026-05', 300000, '2026-05-01')`).run(bucket);
    const { recomputeBucketContributed } = await import("../../services/yearly-plan");
    await recomputeBucketContributed(bucket);
    expect(bucketContributed(bucket)).toBe(300000);

    const id = await credit(150000);
    const r = await recordInvestmentWithdrawal({ creditId: id, investmentAccountId: DEMAT, withdrawnAmount: 100000, bucketId: bucket });
    expect(r.gain).toBe(50000);

    const t = transfers();
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ amount: 100000, from_account_id: DEMAT, to_account_id: SBI });
    expect(row(id)).toMatchObject({ amount: 50000, credit_kind: "gain", reclassified_as_transfer: 0, status: "approved" });
    expect(row(id).linked_transfer_id).toBe(r.transferId);
    expect(fundOn(DEMAT, "2026-09-15")).toBe(100000);
    expect(bucketContributed(bucket)).toBe(200000);

    // The bank gets 100k in as a transfer + 50k as a credit = the 150k that arrived.
    const sbi = await computeUnseededBalance(SBI, "2026-09");
    expect(sbi.closing).toBe(150000);

    await deleteTransfer(r.transferId);
    expect(row(id)).toMatchObject({ amount: 150000, credit_kind: null, linked_transfer_id: null });
    expect(fundOn(DEMAT, "2026-09-15")).toBe(200000);
    expect(bucketContributed(bucket)).toBe(300000);
  });
});

describe("quick-add", () => {
  it("adds a PPF that wasn't in Arth, ends at what's left, closes when nothing is left", async () => {
    const id = await credit(80000);
    const r = await recordInvestmentWithdrawal({
      creditId: id,
      investmentAccountId: null,
      quickAdd: { name: "SBI PPF", instrument: "ppf", leftAfter: 20000 },
      withdrawnAmount: 80000,
    });
    const product = await getInvestmentProduct(r.investmentAccountId);
    expect(product).toMatchObject({ instrument: "ppf", valuation: "contribution" });
    const summary = await getMonthBalanceSummary(r.investmentAccountId, "2026-09");
    expect(summary?.closing_balance).toBe(20000);
    const acct = mockDb.prepare(`SELECT closed_at FROM financial_accounts WHERE id = ?`).get(r.investmentAccountId) as { closed_at: string | null };
    expect(acct.closed_at).toBeNull();

    const id2 = await credit(5000, "2026-09-20");
    const r2 = await recordInvestmentWithdrawal({
      creditId: id2,
      investmentAccountId: null,
      quickAdd: { name: "Old gold bond", instrument: "bond", leftAfter: 0 },
      withdrawnAmount: 5000,
    });
    const closed = mockDb.prepare(`SELECT closed_at FROM financial_accounts WHERE id = ?`).get(r2.investmentAccountId) as { closed_at: string | null };
    expect(closed.closed_at).not.toBeNull();
  });
});

describe("broker-synced days (migration 082)", () => {
  const applied = (id: string) =>
    (mockDb.prepare(`SELECT snapshot_applied FROM account_transfers WHERE id = ?`).get(id) as { snapshot_applied: number | null })
      .snapshot_applied;
  const source = (date: string) =>
    (mockDb.prepare(`SELECT source FROM demat_fund_snapshots WHERE account_id = ? AND snapshot_date = ?`).get(DEMAT, date) as
      | { source: string | null }
      | undefined)?.source;

  it("a sync earlier that day already has the withdrawal - the broker figure isn't lowered again", async () => {
    await saveBrokerSnapshot(DEMAT, 400000, 150000, "2026-09-15");
    const id = await credit(50000);
    const r = await recordInvestmentWithdrawal({ creditId: id, investmentAccountId: DEMAT, withdrawnAmount: 50000 });
    expect(fundOn(DEMAT, "2026-09-15")).toBe(150000);
    expect(applied(r.transferId)).toBe(0);

    await undoTransfer(r.transferId);
    expect(fundOn(DEMAT, "2026-09-15")).toBe(150000);
  });

  it("a sync after the withdrawal replaces the adjusted cash - undo leaves the broker figure alone", async () => {
    const id = await credit(50000);
    const r = await recordInvestmentWithdrawal({ creditId: id, investmentAccountId: DEMAT, withdrawnAmount: 50000 });
    expect(fundOn(DEMAT, "2026-09-15")).toBe(150000);
    expect(source("2026-09-15")).toBe("auto");
    expect(applied(r.transferId)).toBe(1);

    await saveBrokerSnapshot(DEMAT, 400000, 148000, "2026-09-15");
    expect(source("2026-09-15")).toBe("broker");

    await undoTransfer(r.transferId);
    expect(fundOn(DEMAT, "2026-09-15")).toBe(148000);
    expect(row(id).reclassified_as_transfer).toBe(0);
  });

  it("a typed-in snapshot is still adjusted and restored as before", async () => {
    await addOrUpdateFundSnapshot(DEMAT, "2026-09-15", 120000);
    const id = await credit(20000);
    const r = await recordInvestmentWithdrawal({ creditId: id, investmentAccountId: DEMAT, withdrawnAmount: 20000 });
    expect(fundOn(DEMAT, "2026-09-15")).toBe(100000);
    expect(source("2026-09-15")).toBe("manual");
    await undoTransfer(r.transferId);
    expect(fundOn(DEMAT, "2026-09-15")).toBe(120000);
  });

  it("money added on a broker-synced day doesn't change the broker figure, and delete doesn't either", async () => {
    await saveBrokerSnapshot(DEMAT, 400000, 260000, "2026-09-10");
    const t = await createTransfer({ userId: U, fromAccountId: SBI, toAccountId: DEMAT, amount: 60000, date: "2026-09-10" });
    await handleDematTransferSideEffects(t, DEMAT, 60000, "2026-09-10", { target: "fund" });
    expect(fundOn(DEMAT, "2026-09-10")).toBe(260000);
    expect(applied(t)).toBe(0);
    await deleteTransfer(t);
    expect(fundOn(DEMAT, "2026-09-10")).toBe(260000);
  });

  it("transfers from before migration 082 still reverse on non-broker days", async () => {
    const id = await credit(10000);
    const r = await recordInvestmentWithdrawal({ creditId: id, investmentAccountId: DEMAT, withdrawnAmount: 10000 });
    mockDb.prepare(`UPDATE account_transfers SET snapshot_applied = NULL WHERE id = ?`).run(r.transferId);
    mockDb.prepare(`UPDATE demat_fund_snapshots SET source = NULL WHERE account_id = ?`).run(DEMAT);
    await undoTransfer(r.transferId);
    expect(fundOn(DEMAT, "2026-09-15")).toBe(200000);
  });
});

