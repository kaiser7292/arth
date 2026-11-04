import { classifyInstrument, findTable, guessColumns, parseBrokerFile, parseDate, parseGenericTrades } from "@/services/broker-history/parse";
import type { ParsedReport, Workbook } from "@/services/broker-history/types";

/** Every row here is invented, in the layout each broker's real report uses. */

const okReport = (wb: Workbook, name = "file.xlsx"): ParsedReport => {
  const r = parseBrokerFile(wb, name);
  if (r.status !== "ok") throw new Error(`expected a report, got ${r.status}`);
  return r.report;
};
const sum = (r: ParsedReport, cat: string) => r.gains.filter((g) => g.category === cat).reduce((s, g) => s + g.taxable, 0);

const EXIT_HEAD = ["Symbol", "ISIN", "Entry Date", "Exit Date", "Quantity", "Buy Value", "Sell Value", "Profit", "Period of Holding", "Fair Market Value", "Taxable Profit", "Turnover", "Brokerage", "Exchange Transaction Charges", "IPFT", "SEBI Charges", "CGST", "SGST", "IGST", "Stamp Duty", "STT"];

const zerodhaTaxPnl: Workbook = {
  "Tradewise Exits from 2026-04-01": [
    ["Client ID", "AB1234"],
    ["Tradewise Exits from 2026-04-01 to 2026-11-04"],
    ["Equity - Intraday"],
    EXIT_HEAD,
    ["ABC", "INE000A01011", "2026-10-29", "2026-10-29", 10, 1000, 990, -10, 0, 0, -10, 10, 5, 1, 0, 0, 0.5, 0.5, 0, 0.2, 2],
    ["Equity - Short Term"],
    EXIT_HEAD,
    ["DEF", "INE000B01011", "2026-07-02", "2026-07-23", 100, 3000, 3200, 200, 21, 0, 200, 0, 0, 0.2, 0, 0, 0, 0, 0, 0.5, 0],
    ["Equity - Long Term"],
    EXIT_HEAD,
    ["GHI", "INE000C01011", "2024-01-02", "2026-08-01", 5, 500, 900, 400, 900, 0, 400, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    ["Equity - Buyback"],
    EXIT_HEAD,
    ["Mutual Funds"],
    EXIT_HEAD,
    ["F&O"],
    ["Symbol", "Entry Date", "Exit Date", "Quantity", "Buy Value", "Sell Value", "Profit", "Turnover"],
  ],
};

const angelTaxPnl: Workbook = {
  Summary: [
    ["Client Id", "S1"],
    ["Date Of Download", "04/11/2026"],
    ["From Date", "01/04/2026"],
    ["To Date", "04/11/2027"],
  ],
  "Equity+Bonds+SGB Trade Details": [
    ["Equity P&L Summary"],
    ["Net P&L", -100],
    ["Trade Wise Details"],
    ["Intraday (Speculation)"],
    ["ISIN", "Scrip Name", "Qty", "Transaction Date", "Avg Buy Price", "Buy Value", "Avg Sell Price", "Sell Value", "Charges and Statutory Levies", "STT", "Taxable P&L"],
    ["INE000A01011", "ABC", 10, "05/05/2026", 10, 100, 9, 90, 1, 1, -12],
    ["Sub total", "", "", "", "", 100, "", 90, 1, 1, -12],
    ["Delivery P&L"],
    ["ISIN", "Scrip Name", "Qty", "Buy Date", "Sell Date", "Avg Buy Price", "Buy Value", "Avg Sell Price", "Sell Value", "Cost Of Acquisition", "Charges and Statutory Levies", "STT", "Net Profit/Loss", "Long term taxable income", "Short term taxable income", "Purchase Type", "Type of instrument"],
    ["INE000B01011", "DEF", 1, "16/09/2025", "05/05/2026", 100, 100, 150, 150, 100, 2, 1, 47, "", 48, "Normal", "Equity/Corporate Bonds"],
    ["INE000C01011", "GHI", 2, "07/04/2025", "05/05/2026", 100, 200, 50, 100, 100, 2, 1, -103, -102, "", "Normal", "Equity/Corporate Bonds"],
    ["Open Holdings as of 04/11/2027"],
    ["ISIN", "Scrip Name", "Quantity", "Avg Buy Price", "Buy Value", "Charges and Statutory Levies", "STT", "Closing rate", "Turnover", "Short term Unrealised P&L", "Long term Unrealised P&L"],
    ["INE000D01011", "OPEN", 5, 10, 50, 0, 0, 12, 0, 10, 0],
  ],
  "Derivatives Trade Details": [],
};

const growwStocksPnl: Workbook = {
  "Trade Level": [
    ["Name", "Someone"],
    ["P&L Statement for stocks from 01-04-2026 to 03-11-2026"],
    ["Charges"],
    ["STT", 5],
    ["Total", 25],
    ["Realised trades"],
    ["Stock name", "ISIN", "Quantity", "Buy date", "Buy price", "Buy value", "Sell date", "Sell price", "Sell value", "Realised P&L", "Remark"],
    ["SHARE CO", "INE000A01011", 10, "01-02-2026", 100, 1000, "02-06-2026", 110, 1100, 100],
    ["OLD CO", "INE000B01011", 1, "01-01-2024", 100, 100, "02-06-2026", 300, 300, 200],
    ["FAST CO", "INE000C01011", 5, "11-05-2026", 10, 50, "11-05-2026", 8, 40, -10, "Intraday trade"],
    ["XYZ-12.5%-16-3-29-NCD", "INE0IID07793", 10, "16-03-2026", 1000, 10000, "30-07-2026", 1000, 10000, 0, "New shares credit from IPO"],
    ["HDFCAMC - HDFCSILVER", "INF179KC1DI2", 10, "01-02-2026", 250, 2500, "11-05-2026", 240, 2400, -100],
    ["Unrealised trades"],
    ["Stock name", "ISIN", "Quantity", "Buy date", "Buy price", "Buy value", "Closing date", "Closing price", "Closing value", "Unrealised P&L", "Remark"],
    ["HELD CO", "INE000D01011", 10, "01-02-2026", 100, 1000, "03-11-2026", 50, 500, -500],
  ],
};

describe("dates", () => {
  it.each([
    ["2026-07-02", "2026-07-02"],
    ["2026-07-02T10:59:53", "2026-07-02"],
    ["05/05/2026", "2026-05-05"],
    ["16-04-2026 11:03 AM", "2026-04-16"],
    ["07 Oct 2025", "2025-10-07"],
    [46240, "2026-08-06"],
  ])("reads %s", (input, want) => {
    expect(parseDate(input)).toBe(want);
  });
  it("doesn't take a quantity or words for a date", () => {
    expect(parseDate(25)).toBeNull();
    expect(parseDate("Sub total")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("Zerodha Tax P&L", () => {
  const r = okReport(zerodhaTaxPnl);
  it("reads every section, with its period", () => {
    expect(r).toMatchObject({ broker: "kite", kind: "gains", periodFrom: "2026-04-01", periodTo: "2026-11-04" });
    expect(sum(r, "intraday")).toBe(-10);
    expect(sum(r, "short_term")).toBe(200);
    expect(sum(r, "long_term")).toBe(400);
  });
  it("keeps charges and STT apart, as charges are outside its figures", () => {
    const row = r.gains.find((g) => g.symbol === "ABC")!;
    expect(row.stt).toBe(2);
    expect(row.charges).toBeCloseTo(7.2);
    expect(r.gainsBasis).toMatch(/before charges/);
  });
});

describe("Zerodha tradebook and ledger", () => {
  it("reads the same tradebook from its CSV and Excel forms", () => {
    const row = ["ABC", "INE000A01011", "2026-07-02", "NSE", "EQ", "EQ", "buy", "false", 10, 29.67, "203655242", "1100", "2026-07-02T10:59:53"];
    const csv = okReport({ Sheet1: [["symbol", "isin", "trade_date", "exchange", "segment", "series", "trade_type", "auction", "quantity", "price", "trade_id", "order_id", "order_execution_time"], row] });
    const xlsx = okReport({ Equity: [["Client ID", "A"], ["Symbol", "ISIN", "Trade Date", "Exchange", "Segment", "Series", "Trade Type", "Auction", "Quantity", "Price", "Trade ID", "Order ID", "Order Execution Time"], row] });
    expect(csv.trades).toEqual(xlsx.trades);
    expect(csv.trades[0]).toMatchObject({ side: "buy", quantity: 10, tradeId: "203655242", tradeTime: "10:59:53" });
  });

  it("labels a mutual fund tradebook as such", () => {
    const r = okReport({ MF: [["Symbol", "ISIN", "Trade Date", "Exchange", "Segment", "Trade Type", "Quantity", "Price", "Trade ID"], ["A FUND", "INF000", "2026-04-29", "BSE", "MF", "buy", 4.2, 235, "26"]] });
    expect(r.label).toMatch(/mutual fund/);
    expect(r.trades[0].segment).toBe("MF");
  });

  it("finds money in and out by voucher type, whatever the wording", () => {
    const r = okReport({
      Equity: [
        ["Particulars", "Posting Date", "Cost Center", "Voucher Type", "Debit", "Credit", "Net Balance"],
        ["Opening Balance", "", "", "", "", "", 6],
        ["Funds added using UPI with reference number 955", "2026-07-02", "Z", "Bank Receipts", 0, 20000, 1],
        ["Net settlement for Equity", "2026-07-02", "Z", "Book Voucher", 19000, 0, 1],
        ["Funds auto-settled to the primary bank account with reference number 2b1", "2026-07-03", "Z", "Bank Payments", 181.2, 0, 1],
        ["Funds transferred back as part of quarterly settlement", "2026-10-16", "Z", "Bank Payments", 429.55, 0, 0],
        ["AMC for Demat Account", "2026-10-17", "Z", "Journal Entry", 88.5, 0, 0],
      ],
    });
    expect(r.moves.filter((m) => m.direction === "in").map((m) => m.amount)).toEqual([20000]);
    expect(r.moves.filter((m) => m.direction === "out").map((m) => m.amount)).toEqual([181.2, 429.55]);
    expect(r.moves[0].reference).toBe("955");
  });
});

describe("Angel One Tax P&L", () => {
  const r = okReport(angelTaxPnl);
  it("reads intraday and delivery, and leaves open holdings out", () => {
    expect(r.broker).toBe("angel");
    expect(sum(r, "intraday")).toBe(-12);
    expect(sum(r, "short_term")).toBe(48);
    expect(sum(r, "long_term")).toBe(-102);
    expect(r.gains.some((g) => g.symbol === "OPEN")).toBe(false);
  });
  it("doesn't believe a To Date past the day it was downloaded", () => {
    expect(r.periodTo).toBe("2026-11-04");
  });
  it("says its figures are after charges", () => {
    expect(r.gainsBasis).toMatch(/after charges/);
  });
});

describe("Angel One ledger and trades", () => {
  it("finds funds added and quarterly settlements", () => {
    const r = okReport({
      "Broking Ledger": [
        ["StartDate", "2026-04-01"],
        ["EndDate", "2026-11-03"],
        ["Transaction", "Date", "Segment", "Voucher", "Debit", "Credit", "Running Balance"],
        ["Trades Executed", "2026-05-05 00:00:00", "nsecm", "1", "", 73997, 1],
        ["Funds Added", "2026-05-06 00:00:00", "nsecm", "2", "", 35113, 1],
        ["Quarterly Settlement", "2026-07-06 00:00:00", "nsecm", "3", 41215.78, "", 0],
        ["DP Charges", "2026-07-07 00:00:00", "nsecm", "4", 23.6, "", 0],
      ],
    });
    expect(r).toMatchObject({ periodFrom: "2026-04-01", periodTo: "2026-11-03" });
    expect(r.moves).toEqual([
      expect.objectContaining({ direction: "in", amount: 35113 }),
      expect.objectContaining({ direction: "out", amount: 41215.78 }),
    ]);
  });

  it("reads trades with Excel day numbers, taking the price from the matching side", () => {
    const r = okReport({
      TradesAndCharges: [
        ["StartDate", "EndDate"],
        ["Scrip/Contract", "Buy/Sell", "Buy Price", "Sell Price", "Quantity", "Order Type", "Segment", "Exchange", "Order ID", "Trade ID", "Date"],
        ["ABC LTD", "Buy", 207.44, "", 50, "Delivery", "CAPITAL", "NSE", "12", "40", 46240],
        ["DEF LTD", "Sell", "", 75.33, 100, "Intraday", "CAPITAL", "BSE", "13", "41", 46239],
      ],
    });
    expect(r.trades[0]).toMatchObject({ price: 207.44, tradeDate: "2026-08-06", product: "CNC" });
    expect(r.trades[1]).toMatchObject({ price: 75.33, product: "MIS", side: "sell" });
  });
});

describe("Groww", () => {
  const r = okReport(growwStocksPnl);
  it("stops at the unrealised rows, under their nearly identical header", () => {
    expect(r.gains.some((g) => g.symbol === "HELD CO")).toBe(false);
    expect(r.gains).toHaveLength(5);
  });
  it("marks intraday from its remark, and works out short and long term from the dates", () => {
    expect(r.gains.find((g) => g.symbol === "FAST CO")!.category).toBe("intraday");
    expect(r.gains.find((g) => g.symbol === "SHARE CO")!.category).toBe("short_term");
    expect(r.gains.find((g) => g.symbol === "OLD CO")!.category).toBe("long_term");
  });
  it("flags what isn't taxed like shares", () => {
    const bond = r.gains.find((g) => g.symbol.includes("NCD"))!;
    expect(bond.assetClass).toBe("debt");
    expect(bond.checkReason).toMatch(/bond/);
    const silver = r.gains.find((g) => g.symbol.includes("SILVER"))!;
    expect(silver.assetClass).toBe("gold");
    expect(r.gains.find((g) => g.symbol === "SHARE CO")!.checkReason).toBeNull();
  });
  it("reads its period and charges", () => {
    expect(r).toMatchObject({ periodFrom: "2026-04-01", periodTo: "2026-11-03", chargesTotal: 25 });
  });
  it("reads deposits and withdrawals by voucher, however they were paid", () => {
    const b = okReport({
      "Client Fund Ledger": [
        ["Statement of Accounts of Funds for the period from 01/04/2026 to 03/11/2026"],
        ["Transaction Date", "Segment Type", "Transaction Type", "Voucher No.", "Debit (Rs.)", "Credit (Rs.)", "Balance (Rs.)"],
        ["06-09-2026", "UPI", "JV", "DEP2026", 0, 100000, 1],
        ["07-09-2026", "NET_BANKING", "JV", "DEP2027", 0, 5000, 1],
        ["17-10-2026", "STOCK_PAYOUT", "Payment", "WTD2026", 2727.74, 0, 0],
        ["18-10-2026", "STOCKS_SETTLEMENT", "bill", "SET2026", 100, 0, 0],
      ],
    });
    expect(b).toMatchObject({ periodFrom: "2026-04-01", periodTo: "2026-11-03" });
    expect(b.moves.map((m) => [m.direction, m.amount])).toEqual([["in", 100000], ["in", 5000], ["out", 2727.74]]);
  });
  it("reads order history, working the price out from the order's value", () => {
    const o = okReport({
      Sheet1: [
        ["Order history for stocks"],
        ["Stock name", "Symbol", "ISIN", "Type", "Quantity", "Value", "Exchange", "Exchange Order Id", "Execution date and time", "Order status"],
        ["ABC", "ABC$", "INE0", "SELL", 10, 8110, "NSE", "11", "16-04-2026 11:03 AM", "Executed"],
        ["DEF", "DEF", "INE1", "BUY", 5, 100, "NSE", "12", "16-04-2026 03:03 PM", "Cancelled"],
      ],
    });
    expect(o.trades).toHaveLength(1);
    expect(o.trades[0]).toMatchObject({ symbol: "ABC", side: "sell", price: 811, tradeTime: "11:03:00" });
    expect(o.warnings[0]).toMatch(/whole orders/);
  });
  it("reads F&O rows, with their spelled-out dates", () => {
    const f = okReport({
      "Trade Level": [
        ["Options"],
        ["Scrip Name", "Quantity", "Buy Date", "Buy Price", "Buy Value", "Sell Date", "Sell Price", "Sell Value", "Realized P&L"],
        ["NIFTY 14 OCT 25 25250 Call", 75, "10 Oct 2025", 131.85, 9888.75, "10 Oct 2025", 141, 10575, 686.25],
      ],
    }, "F&O_PnL_Report_1_2025-04-01_2026-03-31.xlsx");
    expect(f.gains[0]).toMatchObject({ category: "fno", sellDate: "2025-10-10", taxable: 686.25 });
    expect(f).toMatchObject({ periodFrom: "2025-04-01", periodTo: "2026-03-31" });
  });
});

describe("other files", () => {
  it("says when a report has no sale dates, rather than importing nothing", () => {
    const r = parseBrokerFile({ Equity: [["Client ID", "A"], ["P&L Statement for Equity from 2026-04-01"], ["Summary"]] }, "pnl.xlsx");
    expect(r.status).toBe("not_needed");
  });
  it("calls anything else unknown", () => {
    expect(parseBrokerFile({ Sheet1: [["a", "b"], [1, 2]] }, "x.xlsx").status).toBe("unknown");
  });
  it("reads an unknown broker's tradebook once its columns are matched", () => {
    const wb: Workbook = { Trades: [["Report"], ["Date", "Scrip", "B/S", "Qty", "Rate"], ["02/07/2026", "ABC", "B", 10, 100], ["03/07/2026", "ABC", "S", 5, 120], ["bad row"]] };
    const table = findTable(wb)!;
    expect(table.headerRow).toBe(1);
    const guess = guessColumns(table.columns);
    expect(guess).toEqual({ symbol: 1, side: 2, quantity: 3, price: 4, date: 0 });
    const { report, skipped } = parseGenericTrades(wb.Trades, table.headerRow, guess as never);
    expect(report!.trades.map((t) => t.side)).toEqual(["buy", "sell"]);
    expect(skipped).toBe(1);
  });
});

describe("what isn't taxed like shares", () => {
  it.each([
    ["XYZ-12.5%-16-3-29-NCD", "INE0IID07793", "debt"],
    ["SGB DEC 2028", "IN0020", "debt"],
    ["HDFCAMC - HDFCSILVER", "INF179KC1DI2", "gold"],
    ["MIRAEAMC - MAFANG", "INF769K01HF4", "debt"],
    ["GOLDIAM INTERNATIONAL", "INE025B01025", "equity"],
    ["NIP IND ETF NIFTY BEES", "INF204KB14I2", "equity"],
  ])("%s", (name, isin, want) => {
    expect(classifyInstrument(name, isin).assetClass).toBe(want);
  });
});
