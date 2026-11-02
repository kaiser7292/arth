import { NOT_SET } from "../../services/expense-types";
import type { StatementRow } from "../../services/household/statement";
import { transactionDayLabel } from "../../utils/day-label";
import { filterStatementRows, statementShares, statementTotal, summarizeStatement, withDayHeadings, type StatementFilters } from "../../utils/statement-view";

const row = (id: string, over: Partial<StatementRow> & { who?: string; kind?: StatementRow["relation"]["kind"] } = {}): StatementRow =>
  ({
    id,
    member: { id: over.who ?? "a", name: over.who === "b" ? "Partner" : "Me" },
    date: "2026-10-30",
    merchant: "Store",
    category: "Food",
    paid: 100,
    relation: { kind: over.kind ?? "shared", amount: 0 },
    split: null,
    expenseId: null,
    ...over,
  }) as StatementRow;

const none: StatementFilters = { members: [], categories: [], merchants: [], kinds: [], query: "" };
const ids = (rows: StatementRow[]) => rows.map((r) => r.id);

describe("filterStatementRows", () => {
  const rows = [
    row("food-a"),
    row("rent-b", { who: "b", category: "Rent", merchant: "Landlord", paid: 500, kind: "you_owe" }),
    row("plain", { category: null, merchant: null, paid: 40 }),
    row("settle", { category: null, merchant: "Settle-up to you", paid: 900, kind: "settle" }),
  ];

  it("lets everything through with nothing chosen", () => {
    expect(filterStatementRows(rows, none)).toHaveLength(4);
  });
  it("several choices in one filter are any-of, across filters all-of", () => {
    expect(ids(filterStatementRows(rows, { ...none, categories: ["Food", "Rent"] }))).toEqual(["food-a", "rent-b"]);
    expect(ids(filterStatementRows(rows, { ...none, categories: ["Food", "Rent"], members: ["b"] }))).toEqual(["rent-b"]);
    expect(ids(filterStatementRows(rows, { ...none, kinds: ["you_owe", "settle"] }))).toEqual(["rent-b", "settle"]);
  });
  it("No category finds rows without one, but not settle-ups", () => {
    expect(ids(filterStatementRows(rows, { ...none, categories: [NOT_SET] }))).toEqual(["plain"]);
  });
  it("search reads names and amounts", () => {
    expect(ids(filterStatementRows(rows, { ...none, query: "partner" }))).toEqual(["rent-b"]);
    expect(ids(filterStatementRows(rows, { ...none, query: ">400" }))).toEqual(["rent-b", "settle"]);
  });
});

describe("totals", () => {
  const rows = [
    row("x", { paid: 100 }),
    row("y", { paid: 50, who: "b", category: "Rent" }),
    row("s", { paid: 900, kind: "settle", date: "2026-10-29", category: null }),
    row("z", { paid: 25, date: "2026-10-29" }),
  ];

  it("settle-ups aren't spending", () => {
    expect(statementTotal(rows)).toBe(175);
  });
  it("the summary groups biggest first and counts every row", () => {
    const s = summarizeStatement(rows, "category");
    expect(s).toMatchObject({ total: 175, count: 4, groupBy: "category" });
    expect(s.groups).toEqual([
      { key: "Food", total: 125, count: 2 },
      { key: "Rent", total: 50, count: 1 },
    ]);
    expect(summarizeStatement(rows, "member").groups.map((g) => g.key)).toEqual(["a", "b"]);
  });
  it("each day gets a heading with its own total", () => {
    const list = withDayHeadings(rows);
    expect(list.map((l) => (l.type === "day" ? `${l.date}:${l.total}` : l.row.id))).toEqual(["2026-10-30:150", "x", "y", "2026-10-29:25", "s", "z"]);
  });
});

describe("statementShares", () => {
  it("names who owes what, you first when yours is biggest, and drops zero shares", () => {
    const names: Record<string, string> = { a: "Partner", b: "Sibling" };
    expect(statementShares({ a: 10, me: 30, b: 0 }, (id) => names[id], "me")).toEqual([
      { name: "You", amount: 30 },
      { name: "Partner", amount: 10 },
    ]);
  });
  it("has nothing to say with no shares, and copes with someone unknown", () => {
    expect(statementShares(undefined, () => undefined, "me")).toEqual([]);
    expect(statementShares({ gone: 5 }, () => undefined, "me")).toEqual([{ name: "Someone", amount: 5 }]);
  });
});

describe("transactionDayLabel", () => {
  const now = new Date("2026-11-02T15:00:00");
  it("names recent days and keeps the date beside them", () => {
    expect(transactionDayLabel("2026-11-02", now)).toBe("Today · 2 Nov");
    expect(transactionDayLabel("2026-11-01", now)).toBe("Yesterday · 1 Nov");
    expect(transactionDayLabel("2026-10-27", now)).toBe("Tuesday · 27 Oct");
  });
  it("older days are just the date, with the year when it differs", () => {
    expect(transactionDayLabel("2026-09-12", now)).toBe("12 Sep");
    expect(transactionDayLabel("2025-09-12", now)).toBe("12 Sep 2025");
  });
});
