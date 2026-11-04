import { DatabaseSync } from "node:sqlite";

/**
 * Transfers between the user's own accounts, decided from either side, on the REAL schema.
 * What it must do (IMPS to one of your accounts, card bill payments, a credit arriving later),
 * and what it must leave alone (ambiguous digits, your own account's digits, plain spending).
 */
let mockDb: DatabaseSync;
const flat = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params);
const mockAdapter = {
  execAsync: async (sql: string) => { mockDb.exec(sql); },
  runAsync: async (sql: string, ...params: unknown[]) => {
    const r = mockDb.prepare(sql).run(...(flat(params) as never[]));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).all(...(flat(params) as never[])),
  getFirstAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).get(...(flat(params) as never[])) ?? null,
  withTransactionAsync: async (fn: () => Promise<void>) => {
    mockDb.exec("BEGIN");
    try { await fn(); mockDb.exec("COMMIT"); } catch (e) { mockDb.exec("ROLLBACK"); throw e; }
  },
};
jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: () => undefined, getNumber: () => undefined, getString: () => undefined,
    set: () => {}, delete: () => {}, getAllKeys: () => [], contains: () => false,
  })),
}));

import { runMigrations } from "../../database/migrations";
import { resolveSelfTransfer } from "../../services/money-events";
import { matchTemplateRow } from "../../services/public-data/sms-template-matcher";
import { undoTransfer } from "../../services/account-transfer";
import {
  attachCreditToWaitingTransfer,
  digitsIn,
  findTransferCandidates,
  settleTransfersAfterScan,
} from "../../services/transfer-detect";

const U = "default_user";
const one = (sql: string) => mockDb.prepare(sql).get() as Record<string, unknown>;

beforeEach(async () => {
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  mockDb.exec(`
    INSERT OR IGNORE INTO users (id, name) VALUES ('${U}', 'Me');
    INSERT INTO financial_accounts (id, user_id, account_identifier, bank_name, account_type)
      VALUES ('hdfc', '${U}', '0221', 'HDFC', 'savings'),
             ('kotak', '${U}', '0006', 'Kotak', 'savings'),
             ('card', '${U}', '322', 'HDFC', 'credit_card');
  `);
});

const debit = (id: string, merchant: string, amount: number, date = "2026-10-01", account = "hdfc") =>
  mockDb.exec(`INSERT INTO expenses (id, user_id, amount, date, nature, status, source, merchant_name, account_id)
    VALUES ('${id}', '${U}', ${amount}, '${date}', 'realized', 'approved', 'sms_auto', '${merchant}', '${account}');`);
const credit = (id: string, amount: number, account: string, date = "2026-10-02") =>
  mockDb.exec(`INSERT INTO expenses (id, user_id, amount, date, nature, status, source, merchant_name, account_id)
    VALUES ('${id}', '${U}', ${amount}, '${date}', 'credit', 'approved', 'sms_auto', 'Money in', '${account}');`);
const isTransfer = (id: string) => one(`SELECT reclassified_as_transfer f FROM expenses WHERE id = '${id}'`).f === 1;

describe("digitsIn", () => {
  it("finds masked digits in the usual shapes", () => {
    expect(digitsIn("IMPS to A/c XX0006")).toEqual(["0006"]);
    expect(digitsIn("Credit Card Bil ****322")).toEqual(["322"]);
    expect(digitsIn("card ending 4421")).toEqual(["4421"]);
    expect(digitsIn("SWIGGY FOOD")).toEqual([]);
  });
});

describe("settleTransfersAfterScan", () => {
  it("makes an IMPS to one of your accounts a transfer, and folds in its credit", async () => {
    debit("d1", "IMPS to A/c XX0006", 25000);
    credit("c1", 25000, "kotak");
    expect(await settleTransfersAfterScan(U)).toBe(1);
    expect(isTransfer("d1")).toBe(true);
    expect(isTransfer("c1")).toBe(true);
    const t = one("SELECT from_account_id f, to_account_id t FROM account_transfers WHERE deleted_at IS NULL");
    expect(t).toEqual({ f: "hdfc", t: "kotak" });
  });

  it("makes a card bill payment a transfer to that card", async () => {
    debit("d1", "Credit Card Bil ****322", 5082.06);
    await settleTransfersAfterScan(U);
    expect(isTransfer("d1")).toBe(true);
    expect(one("SELECT to_account_id t FROM account_transfers").t).toBe("card");
  });

  it("joins a credit that arrives after the debit became a transfer", async () => {
    debit("d1", "IMPS to A/c XX0006", 1000);
    await settleTransfersAfterScan(U);
    credit("c1", 1000, "kotak");
    expect(await attachCreditToWaitingTransfer(U, "c1")).toBe(true);
    expect(isTransfer("c1")).toBe(true);
  });

  it("leaves plain spending, your own account's digits and ambiguous digits alone", async () => {
    debit("d1", "SWIGGY FOOD", 291);
    debit("d2", "IMPS to A/c XX0221", 500); // the paying account itself
    mockDb.exec(`INSERT INTO financial_accounts (id, user_id, account_identifier, bank_name, account_type)
      VALUES ('other', '${U}', '90006', 'SBI', 'savings');`); // now two accounts end in 0006
    debit("d3", "IMPS to A/c XX0006", 700);
    expect(await settleTransfersAfterScan(U)).toBe(0);
    expect([isTransfer("d1"), isTransfer("d2"), isTransfer("d3")]).toEqual([false, false, false]);
  });

  it("undo puts both halves back", async () => {
    debit("d1", "IMPS to A/c XX0006", 25000);
    credit("c1", 25000, "kotak");
    await settleTransfersAfterScan(U);
    const t = one("SELECT id FROM account_transfers WHERE deleted_at IS NULL").id as string;
    await undoTransfer(t);
    expect([isTransfer("d1"), isTransfer("c1")]).toEqual([false, false]);
  });
});

describe("findTransferCandidates", () => {
  it("lists ones it can convert and ones that need the other account added, changing nothing", async () => {
    debit("d1", "IMPS to A/c XX0006", 100000);
    debit("d2", "IMPS to A/c XX7322", 71755); // card 322: the last 3 digits match
    debit("d3", "IMPS to A/c XX5150", 2000); // no account ends 5150
    const list = await findTransferCandidates(U);
    expect(list.map((c) => [c.expenseId, c.toAccountId, c.missingDigits])).toEqual(
      expect.arrayContaining([["d1", "kotak", null], ["d2", "card", null], ["d3", null, "5150"]]),
    );
    expect(isTransfer("d1")).toBe(false);
  });
});

describe("an SMS template marked as a transfer", () => {
  const row = (txType: string) => ({
    id: "t1",
    bank_name: "HDFC",
    template_id: "t1",
    pattern_regex: String.raw`Rs (?<amount>\d+) (?:debited|credited) a/c (?<account>\d{4})(?: to a/c (?<other_account>\d{4}))?`,
    tx_type: txType,
    priority: 100,
    source: "user",
  });
  const match = (txType: string, body: string) => matchTemplateRow(row(txType) as never, body, "HDFC")!;
  const event = (id: string) => one(`SELECT money_event m FROM expenses WHERE id = '${id}'`).m;

  it("reads the side from the words and says it's a transfer; other types don't", () => {
    expect(match("transfer", "Rs 500 debited a/c 0221")).toMatchObject({ type: "debit", declaredTransfer: true });
    expect(match("transfer", "Rs 500 credited a/c 0006")).toMatchObject({ type: "credit", declaredTransfer: true });
    expect(match("auto", "Rs 500 debited a/c 0221").declaredTransfer).toBeUndefined();
  });

  it("becomes a transfer to the account the template tagged, though the message's format is unknown to Arth", async () => {
    debit("d1", "Some payee", 500);
    const parsed = match("transfer", "Rs 500 debited a/c 0221 to a/c 0006");
    expect(await resolveSelfTransfer(U, "d1", "debit", parsed)).toBe("paired");
    expect(isTransfer("d1")).toBe(true);
    expect(one("SELECT to_account_id t FROM account_transfers WHERE deleted_at IS NULL").t).toBe("kotak");
  });

  it("pairs with the other side when the message names no account", async () => {
    debit("d1", "Some payee", 500);
    credit("c1", 500, "kotak");
    const parsed = match("transfer", "Rs 500 debited a/c 0221");
    expect(await resolveSelfTransfer(U, "d1", "debit", parsed)).toBe("paired");
    expect([isTransfer("d1"), isTransfer("c1")]).toEqual([true, true]);
  });

  it("with no other side yet, is flagged as a self-transfer rather than left as spending", async () => {
    debit("d1", "Some payee", 500);
    const parsed = match("transfer", "Rs 500 debited a/c 0221");
    expect(await resolveSelfTransfer(U, "d1", "debit", parsed)).toBe("flagged");
    expect(event("d1")).toBe("self_transfer");
  });

  it("the same message on an ordinary template stays spending", async () => {
    debit("d1", "Some payee", 500);
    const parsed = match("debit", "Rs 500 debited a/c 0221");
    expect(await resolveSelfTransfer(U, "d1", "debit", parsed)).toBe("none");
    expect(event("d1")).toBeNull();
  });
});
