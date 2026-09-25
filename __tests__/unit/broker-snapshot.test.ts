/**
 * "Update snapshot" (Kite / Angel One / Zebpay): portfolio and fund are always saved together,
 * a fund of 0 is saved as 0, and both are dated with the local day.
 */

const writes: { sql: string; args: unknown[] }[] = [];
let inTx = 0;
const mockDb = {
  getFirstAsync: jest.fn(async () => null),
  runAsync: jest.fn(async (sql: string, ...args: unknown[]) => {
    writes.push({ sql, args });
    return { changes: 1 };
  }),
  withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => {
    inTx++;
    try {
      await fn();
    } finally {
      inTx--;
    }
  }),
};

jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: () => undefined,
    getNumber: () => undefined,
    getString: () => undefined,
    set: () => {},
    delete: () => {},
  })),
}));
jest.mock("../../database", () => ({ getDatabase: () => mockDb }));
jest.mock("../../services/account-credit", () => ({ addCredit: jest.fn() }));
jest.mock("../../services/settings", () => ({ bumpDataVersion: jest.fn() }));
jest.mock("../../utils/date", () => ({ todayIso: () => "2026-09-25" }));

import { saveBrokerSnapshot, toAmount, updateFundBalance } from "../../services/financial-account";

beforeEach(() => {
  writes.length = 0;
  jest.clearAllMocks();
});

const portfolioInsert = () => writes.find((w) => w.sql.includes("demat_portfolio_snapshots"));
const fundInsert = () => writes.find((w) => w.sql.includes("demat_fund_snapshots"));

describe("saveBrokerSnapshot", () => {
  it("writes portfolio and fund for today, inside one transaction", async () => {
    mockDb.runAsync.mockImplementation(async (sql: string, ...args: unknown[]) => {
      writes.push({ sql: sql + (inTx ? " [tx]" : ""), args });
      return { changes: 1 };
    });
    const out = await saveBrokerSnapshot("acct", 125000.5, 3200);
    expect(out).toEqual({ portfolio: 125000.5, fund: 3200 });
    expect(portfolioInsert()!.args).toEqual(expect.arrayContaining(["acct", "2026-09-25", 125000.5]));
    expect(fundInsert()!.args).toEqual(expect.arrayContaining(["acct", "2026-09-25", 3200]));
    expect(writes.every((w) => w.sql.endsWith("[tx]"))).toBe(true);
  });

  it("saves a fund of 0 as 0 instead of skipping it", async () => {
    const out = await saveBrokerSnapshot("acct", 5000, 0);
    expect(out.fund).toBe(0);
    expect(fundInsert()!.args).toEqual(expect.arrayContaining(["acct", "2026-09-25", 0]));
  });

  it("treats missing or garbled amounts as 0", async () => {
    const out = await saveBrokerSnapshot("acct", "12,000abc", undefined);
    expect(out).toEqual({ portfolio: 12, fund: 0 });
    expect(fundInsert()).toBeDefined();
  });
});

describe("updateFundBalance", () => {
  it("dates the fund with the local day, not UTC", async () => {
    await updateFundBalance("acct", 900);
    expect(fundInsert()!.args).toEqual(expect.arrayContaining(["2026-09-25", 900]));
  });
});

describe("toAmount", () => {
  it.each([
    [42, 42],
    ["42.5", 42.5],
    ["", 0],
    [null, 0],
    [undefined, 0],
    [NaN, 0],
    [Infinity, 0],
  ])("%p -> %p", (input, expected) => {
    expect(toAmount(input)).toBe(expected);
  });
});
