import { DatabaseSync } from "node:sqlite";

/**
 * Broker records end to end, on the REAL schema: reports replace figures for their period, corrections
 * survive re-importing, and calculated figures only fill what no report covers.
 */
let mockDb: DatabaseSync;
const mockStore = new Map<string, unknown>();
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
    getBoolean: (k: string) => mockStore.get(k), getNumber: (k: string) => mockStore.get(k), getString: (k: string) => mockStore.get(k),
    set: (k: string, v: unknown) => { mockStore.set(k, v); }, delete: (k: string) => { mockStore.delete(k); }, getAllKeys: () => [...mockStore.keys()], contains: (k: string) => mockStore.has(k),
  })),
}));

import { runMigrations } from "../../database/migrations";
import { getAccountHistory, getYearGains } from "../../services/broker-history/history";
import { correctGain, saveCaptureDay, saveDayMove, saveReport, saveTrades } from "../../services/broker-history/store";
import type { ParsedGain, ParsedReport, ParsedTrade } from "../../services/broker-history/types";

const U = "default-user";
const FY = 2026;
const TODAY = "2026-11-06";

const gain = (over: Partial<ParsedGain>): ParsedGain => ({
  symbol: "ABC", isin: "INE000A01011", quantity: 10, buyDate: "2026-05-01", sellDate: "2026-06-15", buyValue: 1000, sellValue: 1200,
  taxable: 200, charges: 5, stt: 1, category: "short_term", assetClass: "equity", checkReason: null, ...over,
});
const gainsReport = (gains: ParsedGain[], periodTo = "2026-09-30", broker: ParsedReport["broker"] = "kite"): ParsedReport => ({
  broker, kind: "gains", label: "Zerodha Tax P&L", periodFrom: "2026-04-01", periodTo, gains, trades: [], moves: [], chargesTotal: 12, gainsBasis: "Zerodha's figures are before charges.", warnings: [],
});
const trade = (over: Partial<ParsedTrade>): ParsedTrade => ({
  segment: "EQ", symbol: "ABC", isin: "INE000A01011", exchange: "NSE", product: null, side: "buy", quantity: 10, price: 100, tradeDate: "2026-07-01", tradeTime: null, orderId: null, tradeId: null, ...over,
});

beforeEach(async () => {
  mockStore.clear();
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  mockDb.exec(`
    INSERT OR IGNORE INTO users (id, name) VALUES ('${U}', 'Me');
    INSERT INTO financial_accounts (id, user_id, account_identifier, bank_name, account_label, account_type)
      VALUES ('acc', '${U}', 'AB1', 'Zerodha', 'Zerodha', 'demat'), ('bank', '${U}', '0006', 'HDFC', 'HDFC', 'savings');
  `);
});

describe("a broker's report", () => {
  it("gives gains by type and quarter, labelled as from the report", async () => {
    await saveReport("acc", gainsReport([
      gain({}),
      gain({ symbol: "DEF", isin: "INE1", sellDate: "2026-08-10", taxable: -50, category: "long_term" }),
      gain({ symbol: "FAST", isin: "INE2", sellDate: "2026-08-11", taxable: -10, category: "intraday" }),
    ]), "f.xlsx");
    const h = await getAccountHistory("acc", FY, TODAY);
    expect(h.source).toBe("report");
    expect(h.totals).toEqual({ shortTerm: 200, longTerm: -50, crypto: 0, otherIncome: -10 });
    expect(h.byQuarter).toEqual({ 1: 200, 2: -60, 3: 0, 4: 0 });
    expect(h.chargesTotal).toBe(12);
  });

  it("re-importing doesn't double anything", async () => {
    await saveReport("acc", gainsReport([gain({})]), "f.xlsx");
    await saveReport("acc", gainsReport([gain({})]), "f.xlsx");
    const h = await getAccountHistory("acc", FY, TODAY);
    expect(h.sales).toHaveLength(1);
    expect(h.totals.shortTerm).toBe(200);
  });

  it("a newer report replaces the old one's figures, even with fewer sales", async () => {
    await saveReport("acc", gainsReport([gain({}), gain({ symbol: "OLD", isin: "INE9", taxable: 999 })]), "a.xlsx");
    await saveReport("acc", gainsReport([gain({ taxable: 150 })]), "b.xlsx");
    const h = await getAccountHistory("acc", FY, TODAY);
    expect(h.sales.map((s) => s.symbol)).toEqual(["ABC"]);
    expect(h.totals.shortTerm).toBe(150);
  });

  it("leaves other years alone", async () => {
    await saveReport("acc", { ...gainsReport([gain({ sellDate: "2025-06-01" })], "2026-03-31"), periodFrom: "2025-04-01" }, "old.xlsx");
    await saveReport("acc", gainsReport([gain({})]), "new.xlsx");
    expect((await getAccountHistory("acc", 2025, TODAY)).sales).toHaveLength(1);
    expect((await getAccountHistory("acc", FY, TODAY)).sales).toHaveLength(1);
  });

  it("flags a ₹0 cost until the cost is added, then recalculates", async () => {
    await saveReport("acc", gainsReport([gain({ buyValue: 0, taxable: 1200, checkReason: "Shows ₹0 cost, often because the shares moved in from another broker" })]), "f.xlsx");
    let h = await getAccountHistory("acc", FY, TODAY);
    expect(h.needsCheck).toBe(1);
    await correctGain(h.sales[0].id!, { cost: 900 });
    h = await getAccountHistory("acc", FY, TODAY);
    expect(h.needsCheck).toBe(0);
    expect(h.sales[0]).toMatchObject({ buyValue: 900, taxable: 300 });
  });

  it("a correction survives re-importing the same report", async () => {
    const report = gainsReport([gain({ symbol: "XYZ NCD", isin: "INE3", assetClass: "debt", checkReason: "Looks like a bond, which isn't taxed like shares" })]);
    await saveReport("acc", report, "f.xlsx");
    const id = (await getAccountHistory("acc", FY, TODAY)).sales[0].id!;
    await correctGain(id, { assetClass: "equity" });
    await saveReport("acc", report, "f.xlsx");
    const h = await getAccountHistory("acc", FY, TODAY);
    expect(h.sales[0].assetClass).toBe("equity");
    expect(h.needsCheck).toBe(0);
  });
});

describe("calculated figures", () => {
  it("work out gains from saved trades, labelled as calculated", async () => {
    await saveTrades("acc", "kite", [trade({ tradeId: "1" }), trade({ tradeId: "2", side: "sell", price: 120, tradeDate: "2026-08-01" })], "api");
    const h = await getAccountHistory("acc", FY, TODAY);
    expect(h.source).toBe("calculated");
    expect(h.totals.shortTerm).toBe(200);
    expect(h.sales[0].id).toBeNull();
  });

  it("the same trade from the API and a tradebook is kept once, as the file has it", async () => {
    await saveTrades("acc", "kite", [trade({ tradeId: "1", price: 100 })], "api");
    await saveTrades("acc", "kite", [trade({ tradeId: "1", price: 101 })], "file");
    expect(mockDb.prepare("SELECT COUNT(*) n, MAX(price) p, MAX(source) s FROM broker_trades").get()).toEqual({ n: 1, p: 101, s: "file" });
    await saveTrades("acc", "kite", [trade({ tradeId: "1", price: 100 })], "api");
    expect(mockDb.prepare("SELECT MAX(price) p FROM broker_trades").get()).toEqual({ p: 101 });
  });

  it("an uploaded tradebook overwrites saved trades only for its period and its kind", async () => {
    await saveTrades("acc", "kite", [
      trade({ tradeId: "old", tradeDate: "2026-07-05", quantity: 1 }),
      trade({ tradeId: "before", tradeDate: "2026-06-01", quantity: 2 }),
      trade({ tradeId: "after", tradeDate: "2026-09-01", quantity: 3 }),
      trade({ tradeId: "fund", tradeDate: "2026-07-05", segment: "MF", symbol: "A FUND", isin: "INF1", quantity: 4 }),
    ], "api");
    const file: ParsedReport = { broker: "kite", kind: "tradebook", label: "Zerodha tradebook", periodFrom: "2026-07-01", periodTo: "2026-07-31", gains: [], trades: [trade({ tradeId: "new", tradeDate: "2026-07-06", quantity: 9 })], moves: [], chargesTotal: null, gainsBasis: null, warnings: [] };
    await saveReport("acc", file, "t.csv");
    const rows = mockDb.prepare("SELECT trade_id t FROM broker_trades ORDER BY trade_id").all().map((r) => (r as { t: string }).t);
    expect(rows).toEqual(["after", "before", "fund", "new"]);
  });

  it("fill only what the report doesn't cover, using its earlier buys", async () => {
    await saveTrades("acc", "kite", [
      trade({ tradeId: "1", tradeDate: "2026-05-01" }),
      trade({ tradeId: "2", side: "sell", quantity: 5, price: 120, tradeDate: "2026-06-15" }),
      trade({ tradeId: "3", side: "sell", quantity: 5, price: 150, tradeDate: "2026-10-15" }),
    ], "api");
    await saveReport("acc", gainsReport([gain({ quantity: 5, taxable: 100 })]), "f.xlsx");
    const h = await getAccountHistory("acc", FY, TODAY);
    expect(h.sales.map((s) => [s.source, s.taxable])).toEqual([["calculated", 250], ["report", 100]]);
    expect(h.source).toBe("calculated");
    expect(h.coveredUntil).toBe("2026-09-30");
  });

  it("once a report covers the period, it alone counts", async () => {
    await saveTrades("acc", "kite", [trade({ tradeId: "1" }), trade({ tradeId: "2", side: "sell", price: 120, tradeDate: "2026-08-01" })], "api");
    await saveReport("acc", gainsReport([gain({ sellDate: "2026-08-01", taxable: 195 })]), "f.xlsx");
    const h = await getAccountHistory("acc", FY, TODAY);
    expect(h.source).toBe("report");
    expect(h.totals.shortTerm).toBe(195);
  });

  it("say so when a sale has no buy on record, rather than guess", async () => {
    await saveTrades("acc", "kite", [trade({ tradeId: "2", side: "sell", tradeDate: "2026-08-01" })], "api");
    const h = await getAccountHistory("acc", FY, TODAY);
    expect(h.sales).toEqual([]);
    expect(h.unmatched).toHaveLength(1);
    expect(h.source).toBe("calculated");
  });

  it("recognise the same share from the API and a file, despite the API's name for it", async () => {
    await saveTrades("acc", "kite", [trade({ tradeId: "1", symbol: "ABC", isin: "INE5" })], "file");
    await saveTrades("acc", "kite", [trade({ tradeId: "2", symbol: "ABC-EQ", isin: null, side: "sell", price: 120, tradeDate: "2026-08-01" })], "api");
    const h = await getAccountHistory("acc", FY, TODAY);
    expect(h.unmatched).toEqual([]);
    expect(h.totals.shortTerm).toBe(200);
  });
});

describe("money in and out", () => {
  const ledger = (moves: ParsedReport["moves"]): ParsedReport => ({
    broker: "kite", kind: "ledger", label: "Zerodha ledger", periodFrom: "2026-04-01", periodTo: "2026-11-04", gains: [], trades: [], moves, chargesTotal: null, gainsBasis: null, warnings: [],
  });

  it("adds up by quarter, and points out what isn't a transfer in Arth", async () => {
    mockDb.exec(`INSERT INTO account_transfers (id, user_id, from_account_id, to_account_id, amount, date) VALUES ('t1', '${U}', 'bank', 'acc', 20000, '2026-07-03');`);
    await saveReport("acc", ledger([
      { date: "2026-07-02", direction: "in", amount: 20000, reference: "a", narration: null },
      { date: "2026-10-16", direction: "out", amount: 500, reference: "b", narration: null },
    ]), "l.csv");
    const { money } = await getAccountHistory("acc", FY, TODAY);
    expect(money).toMatchObject({ added: 20000, withdrawn: 500, unmatched: 1, hasRecords: true });
    expect(money.byQuarter[2].added).toBe(20000);
    expect(money.byQuarter[3].withdrawn).toBe(500);
  });

  const transferIn = (id: string, amount: number, date: string) =>
    mockDb.exec(`INSERT INTO account_transfers (id, user_id, from_account_id, to_account_id, amount, date) VALUES ('${id}', '${U}', 'bank', 'acc', ${amount}, '${date}');`);

  it("shows detected transfers with no statement at all", async () => {
    transferIn("t1", 5000, "2026-07-03");
    const { money } = await getAccountHistory("acc", FY, TODAY);
    expect(money).toMatchObject({ added: 5000, withdrawn: 0, hasRecords: true, fromStatement: false, unmatched: 0 });
    expect(money.byQuarter[2].added).toBe(5000);
  });

  it("a statement overwrites detected money for its period only, and the rest stays", async () => {
    transferIn("inside", 1111, "2026-07-03");
    transferIn("outside", 2222, "2026-10-20");
    await saveReport("acc", { ...ledger([{ date: "2026-07-02", direction: "in", amount: 20000, reference: "a", narration: null }]), periodTo: "2026-09-30" }, "l.csv");
    const { money } = await getAccountHistory("acc", FY, TODAY);
    expect(money.added).toBe(22222);
    expect(money.byQuarter[2].added).toBe(20000);
    expect(money.byQuarter[3].added).toBe(2222);
    expect(money.fromStatement).toBe(true);
    expect(mockDb.prepare("SELECT COUNT(*) n FROM account_transfers").get()).toEqual({ n: 2 });
  });

  it("doesn't count a day's saved money twice when a transfer explains it", async () => {
    transferIn("t1", 300, "2026-11-05");
    await saveDayMove("acc", "kite", "2026-11-05", "in", 300);
    await saveDayMove("acc", "kite", "2026-11-03", "in", 50);
    expect((await getAccountHistory("acc", FY, TODAY)).money.added).toBe(350);
  });

  it("a statement replaces what daily saves noted, and later saves don't add back to its period", async () => {
    await saveDayMove("acc", "kite", "2026-07-02", "in", 20000);
    await saveReport("acc", ledger([{ date: "2026-07-02", direction: "in", amount: 20000, reference: "a", narration: null }]), "l.csv");
    await saveDayMove("acc", "kite", "2026-07-03", "in", 5);
    const { money } = await getAccountHistory("acc", FY, TODAY);
    expect(money.added).toBe(20000);
  });

  it("a day's saved amount is updated, not added to, and removed if it drops to nothing", async () => {
    await saveDayMove("acc", "kite", "2026-11-05", "in", 100);
    await saveDayMove("acc", "kite", "2026-11-05", "in", 300);
    expect((await getAccountHistory("acc", FY, TODAY)).money.added).toBe(300);
    await saveDayMove("acc", "kite", "2026-11-05", "in", 0);
    expect((await getAccountHistory("acc", FY, TODAY)).money.hasRecords).toBe(false);
  });

  it("mutual funds are their own line, since they don't pass through the ledger", async () => {
    await saveTrades("acc", "kite", [trade({ segment: "MF", symbol: "A FUND", isin: "INF1", tradeId: "26", quantity: 10, price: 100 })], "file");
    const h = await getAccountHistory("acc", FY, TODAY);
    expect(h.mutualFunds).toEqual({ bought: 1000, sold: 0 });
    expect(h.sales).toEqual([]);
  });
});

describe("daily saves", () => {
  it("say what's saved and what may be missing", async () => {
    await saveCaptureDay("acc", "kite", "2026-11-02", 0, { ABC: 10 });
    await saveCaptureDay("acc", "kite", "2026-11-05", 0, { ABC: 10 });
    await saveCaptureDay("acc", "kite", TODAY, 1, { ABC: 25 });
    const [c] = (await getAccountHistory("acc", FY, TODAY)).captures;
    expect(c).toMatchObject({ broker: "kite", brokerName: "Zerodha", firstDate: "2026-11-02", savedToday: true });
    expect(c.missingDays).toEqual(["2026-11-03", "2026-11-04"]);
    expect(c.differences).toEqual(["ABC"]);
  });

  it("a day saved again keeps one row", async () => {
    await saveCaptureDay("acc", "kite", TODAY, 1, null);
    await saveCaptureDay("acc", "kite", TODAY, 2, null);
    expect(mockDb.prepare("SELECT COUNT(*) n FROM broker_capture_days").get()).toEqual({ n: 1 });
  });
});

describe("the Income Calculator", () => {
  it("gets each account's line and the combined tax inputs, without intraday", async () => {
    mockDb.exec(`INSERT INTO financial_accounts (id, user_id, account_identifier, bank_name, account_label, account_type) VALUES ('acc2', '${U}', 'S1', 'Angel One', 'Angel', 'demat');`);
    await saveReport("acc", gainsReport([gain({ taxable: 300 }), gain({ symbol: "F", isin: "INE4", taxable: -40, category: "intraday" })]), "f.xlsx");
    await saveReport("acc2", gainsReport([gain({ taxable: -100 }), gain({ symbol: "L", isin: "INE6", taxable: 500, category: "long_term" })], "2026-09-30", "angel"), "g.xlsx");
    const y = await getYearGains(FY);
    expect(y.lines.map((l) => [l.name, l.shortTerm, l.longTerm, l.otherIncome, l.source])).toEqual([
      ["Zerodha", 300, 0, -40, "report"],
      ["Angel", -100, 500, 0, "report"],
    ]);
    expect(y.input).toMatchObject({ equity_stcg: 200, equity_ltcg: 500 });
    expect(y.hasCalculated).toBe(false);
  });

  it("shows nothing for a year with no records", async () => {
    await saveReport("acc", gainsReport([gain({})]), "f.xlsx");
    expect((await getYearGains(2020)).lines).toEqual([]);
  });

  it("takes crypto gains from saved ZebPay trades", async () => {
    await saveTrades("acc", "zebpay", [
      trade({ segment: "CRYPTO", symbol: "BTC", isin: null, tradeId: "b", quantity: 1, price: 100 }),
      trade({ segment: "CRYPTO", symbol: "BTC", isin: null, tradeId: "s", side: "sell", quantity: 1, price: 150, tradeDate: "2026-08-01" }),
    ], "api");
    const y = await getYearGains(FY);
    expect(y.input).toMatchObject({ crypto: 50, cryptoTds: 1.5 });
    expect(y.hasCalculated).toBe(true);
  });
});
