import { mapAngelTrades, mapKiteMfOrders, mapKiteTrades, mapZebpayOrders, holdingsMap } from "@/services/broker-history/api-map";
import { calculateGains, holdingDifferences, missingWeekdays, quarterOf, salesToTaxInput, type TradeRow } from "@/services/broker-history/compute";

const t = (date: string, side: string, quantity: number, price: number, symbol = "ABC"): TradeRow => ({
  segment: "EQ",
  symbol,
  isin: null,
  side,
  quantity,
  price,
  trade_date: date,
  trade_time: null,
});

describe("gains from trades", () => {
  it("matches oldest first, across partial lots", () => {
    const { sales, unmatched } = calculateGains([t("2026-01-01", "buy", 10, 100), t("2026-02-01", "buy", 10, 200), t("2026-03-01", "sell", 15, 300)]);
    expect(unmatched).toEqual([]);
    expect(sales.map((s) => [s.buyDate, s.quantity, s.taxable])).toEqual([
      ["2026-01-01", 10, 2000],
      ["2026-02-01", 5, 500],
    ]);
  });

  it("nets a same-day buy and sell as intraday, leaving older shares alone", () => {
    const { sales } = calculateGains([t("2023-01-01", "buy", 100, 3000), t("2026-03-01", "buy", 50, 4000), t("2026-03-01", "sell", 50, 4010)]);
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ category: "intraday", quantity: 50, taxable: 500 });
  });

  it("only sends what's left of a same-day sale to older shares", () => {
    const { sales } = calculateGains([t("2024-01-01", "buy", 100, 10), t("2026-03-01", "buy", 40, 20), t("2026-03-01", "sell", 60, 30)]);
    expect(sales.map((s) => [s.category, s.quantity])).toEqual([["intraday", 40], ["long_term", 20]]);
  });

  it("calls a holding of over a year long term, and exactly a year short term", () => {
    const year = calculateGains([t("2025-03-01", "buy", 1, 10), t("2026-03-01", "sell", 1, 20)]);
    const over = calculateGains([t("2025-03-01", "buy", 1, 10), t("2026-03-02", "sell", 1, 20)]);
    expect(year.sales[0].category).toBe("short_term");
    expect(over.sales[0].category).toBe("long_term");
  });

  it("reports a sale with no buy on record, and doesn't invent a gain for it", () => {
    const { sales, unmatched } = calculateGains([t("2026-03-01", "sell", 5, 100)]);
    expect(sales).toEqual([]);
    expect(unmatched).toEqual([{ symbol: "ABC", quantity: 5, date: "2026-03-01" }]);
  });

  it("keeps instruments apart, and leaves mutual funds out", () => {
    const fund = { ...t("2026-01-01", "buy", 1, 10, "FUND"), segment: "MF" };
    const fundSale = { ...t("2026-02-01", "sell", 1, 20, "FUND"), segment: "MF" };
    const { sales } = calculateGains([t("2026-01-01", "buy", 1, 10, "A"), t("2026-02-01", "sell", 1, 11, "A"), t("2026-01-01", "buy", 1, 50, "B"), t("2026-02-01", "sell", 1, 60, "B"), fund, fundSale]);
    expect(sales.map((s) => [s.symbol, s.taxable])).toEqual([["A", 1], ["B", 10]]);
  });

  it("treats crypto as crypto, with no intraday", () => {
    const { sales } = calculateGains([t("2026-01-01", "buy", 1, 100, "BTC"), t("2026-01-01", "sell", 1, 110, "BTC")], true);
    expect(sales[0]).toMatchObject({ category: "crypto", assetClass: "crypto", taxable: 10 });
  });
});

describe("into the capital gains calculation", () => {
  const sale = (taxable: number, category: never | string, assetClass = "equity", sellValue = 0) => ({ taxable, category, assetClass, sellValue }) as never;

  it("sets a short-term loss against long-term gains", () => {
    expect(salesToTaxInput([sale(-100, "short_term"), sale(300, "long_term")])).toMatchObject({ equity_stcg: 0, equity_ltcg: 200 });
  });
  it("doesn't set a long-term loss against short-term gains", () => {
    expect(salesToTaxInput([sale(-100, "long_term"), sale(300, "short_term")])).toMatchObject({ equity_stcg: 300, equity_ltcg: 0 });
  });
  it("leaves intraday, F&O and buybacks out", () => {
    expect(salesToTaxInput([sale(100, "intraday"), sale(100, "fno"), sale(100, "buyback")])).toMatchObject({ equity_stcg: 0, equity_ltcg: 0, debt: 0 });
  });
  it("puts bonds at slab, and gold by its term", () => {
    expect(salesToTaxInput([sale(50, "short_term", "debt"), sale(70, "long_term", "gold"), sale(30, "short_term", "gold")])).toMatchObject({ debt: 80, gold: 70, equity_stcg: 0 });
  });
  it("won't let a crypto loss offset a crypto gain, and notes the TDS", () => {
    expect(salesToTaxInput([sale(-50, "crypto", "crypto", 100), sale(80, "crypto", "crypto", 900)])).toMatchObject({ crypto: 80, cryptoTds: 10 });
  });
});

describe("spotting what's missing", () => {
  it("counts weekdays with no save, not weekends", () => {
    // Monday 2 Nov 2026 and Monday 9 Nov 2026 saved: Tue-Fri in between are missing.
    expect(missingWeekdays(["2026-11-02", "2026-11-09"], "2026-11-09")).toEqual(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
  });
  it("doesn't count today, or before saving began", () => {
    expect(missingWeekdays(["2026-11-04"], "2026-11-04")).toEqual([]);
    expect(missingWeekdays([], "2026-11-04")).toEqual([]);
  });
  it("finds holdings that don't add up", () => {
    const before = { A: 10, B: 5 };
    const after = { A: 15, B: 10, C: 1 };
    // A's buy explains it. B doubled with no trade (a bonus?). C arrived from nowhere.
    expect(holdingDifferences(before, after, [{ key: "A", side: "buy", quantity: 5 }])).toEqual(["B", "C"]);
  });
  it("is content when they do", () => {
    expect(holdingDifferences({ A: 10 }, { A: 7 }, [{ key: "A", side: "sell", quantity: 3 }])).toEqual([]);
  });
  it("puts dates in the right quarter", () => {
    expect([quarterOf("2026-04-01"), quarterOf("2026-09-30"), quarterOf("2026-10-01"), quarterOf("2027-03-31")]).toEqual([1, 2, 3, 4]);
  });
});

describe("API answers", () => {
  const today = "2026-11-04";
  it("reads Kite's trades, skipping anything incomplete", () => {
    const rows = [
      { trade_id: "T1", order_id: "O1", exchange: "NSE", tradingsymbol: "ABC", product: "MIS", average_price: 10.5, quantity: 3, transaction_type: "BUY", fill_timestamp: "2026-11-04 09:16:39" },
      { trade_id: "T2", exchange: "NFO", tradingsymbol: "NIFTY", product: "NRML", average_price: 5, quantity: 75, transaction_type: "SELL", fill_timestamp: "2026-11-04 10:00:00" },
      { trade_id: "", tradingsymbol: "BAD", average_price: 1, quantity: 1, transaction_type: "BUY" },
    ];
    const out = mapKiteTrades(rows, today);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ side: "buy", product: "MIS", tradeDate: today, tradeTime: "09:16:39", tradeId: "T1", segment: "EQ" });
    expect(out[1].segment).toBe("FO");
  });
  it("reads only Kite's completed fund orders, with the same number the tradebook uses", () => {
    const out = mapKiteMfOrders([
      { order_id: "26", tradingsymbol: "INF179K01WM1", fund: "A FUND", status: "COMPLETE", transaction_type: "BUY", quantity: 4.2, average_price: 235, exchange_timestamp: "2026-11-02 00:00:00" },
      { order_id: "27", tradingsymbol: "INF179K01WM1", fund: "A FUND", status: "OPEN", transaction_type: "BUY", quantity: 0, average_price: 0 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ segment: "MF", isin: "INF179K01WM1", tradeId: "26", tradeDate: "2026-11-02" });
  });
  it("reads Angel's trade book", () => {
    const out = mapAngelTrades([{ fillid: "F1", orderid: "O1", tradingsymbol: "ABC-EQ", exchange: "NSE", producttype: "DELIVERY", transactiontype: "SELL", fillprice: 131, fillsize: "1", filltime: "11:20:06" }], today);
    expect(out[0]).toMatchObject({ side: "sell", quantity: 1, price: 131, product: "CNC", tradeDate: today, tradeTime: "11:20:06" });
  });
  it("reads ZebPay's fills, falling back to the order, and only INR pairs", () => {
    const order = { orderId: 9, symbol: "BTC-INR", side: "buy", filled: "0.5", price: "100", timestamp: 1793000000000 };
    const withFills = mapZebpayOrders([{ order, fills: [{ id: "f1", price: "90", amount: "0.2", timestamp: 1793000000000 }, { id: "f2", price: "110", amount: "0.3", timestamp: 1793000000000 }] }]);
    expect(withFills.map((x) => x.tradeId)).toEqual(["f1", "f2"]);
    expect(withFills[0]).toMatchObject({ segment: "CRYPTO", symbol: "BTC", side: "buy" });
    const noFills = mapZebpayOrders([{ order, fills: null }]);
    expect(noFills).toHaveLength(1);
    expect(noFills[0]).toMatchObject({ tradeId: "9", quantity: 0.5, price: 100 });
    expect(mapZebpayOrders([{ order: { ...order, symbol: "BTC-USDT" }, fills: null }])).toEqual([]);
  });
  it("counts holdings with what's still settling", () => {
    expect(holdingsMap([{ tradingsymbol: "A", quantity: 5, t1_quantity: 2 }], "tradingsymbol", "t1_quantity")).toEqual({ A: 7 });
  });
});
