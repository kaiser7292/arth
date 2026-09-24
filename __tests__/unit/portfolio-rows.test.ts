const mockStorage = new Map<string, string>();

jest.mock("../../services/storage", () => ({
  settingsStorage: {
    getString: jest.fn((k: string) => mockStorage.get(k)),
    set: jest.fn((k: string, v: string) => { mockStorage.set(k, v); }),
  },
}));
jest.mock("../../utils/format", () => ({ formatAmount: (n: number) => `₹${n}` }));
jest.mock("../../utils/date", () => ({ formatDate: (iso: string) => `D:${iso}` }));

import {
  DEFAULT_SORT,
  angelHoldingRow,
  angelPositionRow,
  filterRows,
  formatQty,
  getSortPref,
  kiteHoldingRow,
  kiteMFRow,
  kiteOrderRow,
  kitePositionRow,
  nextSort,
  setSortPref,
  sortRows,
  zebpayBalanceRow,
  type PortfolioRow,
} from "@/services/portfolio-rows";

beforeEach(() => mockStorage.clear());

describe("formatQty", () => {
  it("shows only the decimals a quantity needs", () => {
    expect(formatQty(690)).toBe("690");
    expect(formatQty(132.688)).toBe("132.688");
    expect(formatQty(0.001234)).toBe("0.001234");
    expect(formatQty(1430.047)).toBe("1,430.047");
  });
});

describe("row builders share one format", () => {
  it("Kite stock: value, LTP line, P&L % against invested (not day change)", () => {
    const r = kiteHoldingRow({
      tradingsymbol: "IBULLSLTD", exchange: "NSE", isin: "INE1", quantity: 690, t1_quantity: 0,
      average_price: 30.4, last_price: 28.41, close_price: 29, pnl: -1373.1, day_change_percentage: -2.44,
    });
    expect(r.title).toBe("IBULLSLTD");
    expect(r.details).toEqual(["690 shares · avg ₹30.4", "LTP ₹28.41"]);
    expect(r.value).toBeCloseTo(690 * 28.41);
    expect(r.pnl!.amount).toBe(-1373.1);
    expect(r.pnl!.pct).toBeCloseTo((-1373.1 / (690 * 30.4)) * 100);
  });

  it("Kite stock counts T+1 shares and says so", () => {
    const r = kiteHoldingRow({
      tradingsymbol: "X", exchange: "NSE", isin: "I", quantity: 10, t1_quantity: 5,
      average_price: 100, last_price: 110, close_price: 0, pnl: 150, day_change_percentage: 0,
    });
    expect(r.details[0]).toBe("15 shares · avg ₹100 · 5 pending");
    expect(r.value).toBe(1650);
  });

  it("Kite mutual fund: derives P&L from average NAV and dates the NAV", () => {
    const r = kiteMFRow({
      folio: "F1", fund: "HDFC NIFTY 50 INDEX FUND", tradingsymbol: "INF1", average_price: 238.13,
      last_price: 229.19, last_price_date: "2026-09-19", quantity: 132.688, pledged_quantity: 0, pnl: 0,
    } as any);
    expect(r.details).toEqual(["132.688 units · avg ₹238.13", "NAV ₹229.19 · D:2026-09-19"]);
    expect(r.pnl!.amount).toBeCloseTo(132.688 * (229.19 - 238.13));
    expect(r.pnl!.pct).toBeCloseTo(((229.19 - 238.13) / 238.13) * 100);
  });

  it("positions carry a LONG/SHORT badge and use absolute quantity", () => {
    const short = kitePositionRow({
      tradingsymbol: "NIFTY", exchange: "NFO", product: "MIS", quantity: -50, buy_quantity: 0, sell_quantity: 50,
      average_price: 100, last_price: 90, pnl: 500, day_change_percentage: 0,
    });
    expect(short.badge).toEqual({ label: "SHORT", tone: "danger" });
    expect(short.details[0]).toBe("50 shares · avg ₹100 · MIS");
    expect(short.value).toBe(4500);

    const long = angelPositionRow({
      tradingsymbol: "SBIN", exchange: "NSE", symbolname: "SBIN", producttype: "DELIVERY", netqty: 10,
      ltp: 800, pnl: 200, unrealised: 200, realised: 0, buyavgprice: 780, sellavgprice: 0, avg_price: 780,
    });
    expect(long.badge).toEqual({ label: "LONG", tone: "success" });
    expect(long.value).toBe(8000);
  });

  it("Angel stock shows current value (not LTP) on the right and keeps Angel's own P&L %", () => {
    const r = angelHoldingRow({
      tradingsymbol: "TCS", exchange: "NSE", isin: "INE2", quantity: 2, t1quantity: 0, realisedquantity: 2,
      averageprice: 3000, ltp: 3300, close: 0, profitandloss: 600, pnlpercentage: 10, product: "DELIVERY",
    });
    expect(r.value).toBe(6600);
    expect(r.details).toEqual(["2 shares · avg ₹3000", "LTP ₹3300"]);
    expect(r.pnl).toEqual({ amount: 600, pct: 10 });
  });

  it("Zebpay has no buy price, so no average or P&L", () => {
    const r = zebpayBalanceRow({ currency: "BTC", balance: 0.001234, inrValue: 7400, currentPrice: 6000000 });
    expect(r.details).toEqual(["0.001234 BTC", "Price ₹6000000"]);
    expect(r.value).toBe(7400);
    expect(r.pnl).toBeUndefined();
  });

  it("orders show filled/total, side badge and a status note", () => {
    const r = kiteOrderRow({
      order_id: "1", tradingsymbol: "INFY", exchange: "NSE", transaction_type: "SELL", order_type: "LIMIT",
      product: "CNC", quantity: 10, price: 1500, average_price: 1501, filled_quantity: 10, status: "COMPLETE",
      order_timestamp: "2026-09-24T10:00:00",
    });
    expect(r.badge).toEqual({ label: "SELL", tone: "danger" });
    expect(r.details[0]).toBe("10/10 shares · @ ₹1501 · LIMIT");
    expect(r.value).toBe(15010);
    expect(r.note!.tone).toBe("success");
    expect(r.note!.text.startsWith("Complete")).toBe(true);
  });
});

function row(title: string, value: number | null, pnl?: number, pct?: number | null): PortfolioRow {
  return { key: title, title, details: [], value, pnl: pnl != null ? { amount: pnl, pct: pct ?? null } : undefined };
}

describe("search and sort", () => {
  const rows = [row("Mirae ELSS", 25000, 10000, 69), row("HDFC Nifty 50", 30000, -1100, -3.6), row("BTC", 7400)];

  it("filters by name, case-insensitive", () => {
    expect(filterRows(rows, "nifty").map((r) => r.title)).toEqual(["HDFC Nifty 50"]);
    expect(filterRows(rows, "  ")).toHaveLength(3);
  });

  it("sorts by value, P&L and P&L %, rows without the number last", () => {
    expect(sortRows(rows, { key: "value", dir: "desc" }).map((r) => r.title)).toEqual(["HDFC Nifty 50", "Mirae ELSS", "BTC"]);
    expect(sortRows(rows, { key: "pnl", dir: "asc" }).map((r) => r.title)).toEqual(["HDFC Nifty 50", "Mirae ELSS", "BTC"]);
    expect(sortRows(rows, { key: "pnlPct", dir: "desc" }).map((r) => r.title)).toEqual(["Mirae ELSS", "HDFC Nifty 50", "BTC"]);
    expect(sortRows(rows, { key: "name", dir: "asc" }).map((r) => r.title)).toEqual(["BTC", "HDFC Nifty 50", "Mirae ELSS"]);
  });

  it("tapping the active chip flips direction; a new chip starts at its natural order", () => {
    expect(nextSort({ key: "value", dir: "desc" }, "value")).toEqual({ key: "value", dir: "asc" });
    expect(nextSort({ key: "value", dir: "desc" }, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextSort({ key: "name", dir: "asc" }, "pnl")).toEqual({ key: "pnl", dir: "desc" });
  });

  it("remembers the sort per broker and ignores junk", () => {
    expect(getSortPref("kite")).toEqual(DEFAULT_SORT);
    setSortPref("kite", { key: "pnlPct", dir: "asc" });
    expect(getSortPref("kite")).toEqual({ key: "pnlPct", dir: "asc" });
    expect(getSortPref("angel")).toEqual(DEFAULT_SORT);
    mockStorage.set("portfolio_sort:angel", '{"key":"bogus","dir":"up"}');
    expect(getSortPref("angel")).toEqual(DEFAULT_SORT);
  });
});
