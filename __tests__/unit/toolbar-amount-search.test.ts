import { parseBankSMS } from "../../services/sms/bank-patterns";
import { filterRows, type ListSearch } from "../../utils/list-tools";
import { filterRows as filterHoldings, type PortfolioRow } from "../../services/portfolio-rows";
import { parseNLQuery } from "../../utils/nl-search";

jest.mock("../../services/storage", () => ({ settingsStorage: { getString: jest.fn(), set: jest.fn() } }));

type Row = { name: string; amount: number };
const rows: Row[] = [
  { name: "Store", amount: 1200 },
  { name: "Rent", amount: 25000 },
  { name: "Tea", amount: 50 },
];
const search: ListSearch<Row> = (r) => ({ texts: [r.name], amounts: [r.amount] });
const names = (query: string) => filterRows(rows, [], {}, query, search).map((r) => r.name);

describe("the toolbar's search understands amounts", () => {
  it("over and under", () => {
    expect(names(">5000")).toEqual(["Rent"]);
    expect(names("<100")).toEqual(["Tea"]);
    expect(names("above 1000")).toEqual(["Store", "Rent"]);
    expect(names("under 100")).toEqual(["Tea"]);
  });
  it("ranges and exact amounts", () => {
    expect(names("1000-2000")).toEqual(["Store"]);
    expect(names("1,200")).toEqual(["Store"]);
    expect(names("₹50")).toEqual(["Tea"]);
  });
  it("names still work", () => {
    expect(names("sto")).toEqual(["Store"]);
  });
});

describe("Apply on Transactions leaves amounts alone", () => {
  it.each([">5000", "<100", "above 1000", "1000-2000"])("%s", (query) => {
    expect(parseNLQuery(query).textSearch).toBe(query);
  });
});

describe("Holdings search", () => {
  const holding = (title: string, value: number): PortfolioRow => ({ key: title, title, details: [], value });
  const list = [holding("Infosys", 80000), holding("ITC", 2000)];
  it("finds by name or amount", () => {
    expect(filterHoldings(list, "infy").length).toBe(0);
    expect(filterHoldings(list, "itc").map((r) => r.title)).toEqual(["ITC"]);
    expect(filterHoldings(list, ">5000").map((r) => r.title)).toEqual(["Infosys"]);
  });
});

describe("Pluxee meal wallet messages", () => {
  const body = "Rs. 250.00 spent from Pluxee  Meal wallet, card no.xx1234 on 3-11-2026 19:29:22 at SAMPLE SHOP . Avl bal Rs.900.00. Not you call 18000000000";
  it("reads every part of it", () => {
    expect(parseBankSMS(body)).toMatchObject({
      amount: 250,
      merchant: "SAMPLE SHOP",
      cardLast4: "1234",
      date: "2026-11-03",
      transactionTime: "19:29:22",
      bank: "Pluxee",
      type: "debit",
      accountType: "wallet",
      availableBalance: 900,
      skip: false,
    });
  });
  it("still reads it with no balance on the end", () => {
    expect(parseBankSMS("Rs.99 spent from Pluxee Meal wallet, card no.xx1234 on 3-11-2026 at CAFE")).toMatchObject({ amount: 99, merchant: "CAFE", date: "2026-11-03" });
  });
});
