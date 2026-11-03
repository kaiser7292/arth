import type { Expense } from "../../services/expense-types";
import type { FinancialAccount } from "../../services/financial-account";
import { groupExpenses } from "../../utils/expense-grouping";
import { groupRows, NO_GROUP, ungrouped } from "../../utils/group-rows";
import { groupStatementRows } from "../../utils/statement-view";
import type { StatementRow } from "../../services/household/statement";

type Row = { id: string; group: string | null; amount: number };
const rows: Row[] = [
  { id: "a", group: "small", amount: 10 },
  { id: "b", group: null, amount: 500 },
  { id: "c", group: "big", amount: -100 },
  { id: "d", group: "small", amount: 5 },
];
const by = { keyOf: (r: Row) => r.group, labelOf: (k: string) => (k === NO_GROUP ? "None" : k), amountOf: (r: Row) => r.amount };
const shape = (list: ReturnType<typeof groupRows<Row>>) =>
  list.map((r) => (r.type === "heading" ? `[${r.label} ${r.count} ${r.total}]` : r.item.id));

describe("groupRows", () => {
  it("puts the biggest group first, whichever way the money went, and rows with no value last", () => {
    expect(shape(groupRows(rows, by))).toEqual(["[big 1 -100]", "c", "[small 2 15]", "a", "d", "[None 1 500]", "b"]);
  });
  it("keeps the order rows came in for dates", () => {
    expect(shape(groupRows(rows, { ...by, order: "first" }))).toEqual(["[small 2 15]", "a", "d", "[None 1 500]", "b", "[big 1 -100]", "c"]);
  });
  it("none means no headings", () => {
    expect(ungrouped(rows).every((r) => r.type === "item")).toBe(true);
  });
  it("doesn't drift on paise", () => {
    const list = groupRows([{ id: "x", group: "g", amount: 0.1 }, { id: "y", group: "g", amount: 0.2 }], by);
    expect(list[0]).toMatchObject({ total: 0.3 });
  });
});

const expense = (id: string, over: Partial<Expense>): Expense =>
  ({ id, nature: "realized", amount: 100, date: "2026-10-15", category_id: null, payment_mode_id: null, account_id: null, merchant_name: null, ...over }) as Expense;

describe("groupExpenses", () => {
  const names = {
    categoryMap: new Map([["food", { name: "Food" }]]),
    accountMap: new Map([["acc", { account_label: "Main", bank_name: "Bank", account_identifier: "1234" } as FinancialAccount]]),
    paymentModeMap: new Map([["upi", { name: "UPI" }]]),
    people: new Map([["split", "Ravi"]]),
  };
  const headings = (by: Parameters<typeof groupExpenses>[1], list: Expense[]) =>
    groupExpenses(list, by, names).flatMap((r) => (r.type === "heading" ? [`${r.label}:${r.total}`] : []));

  it("a credit's category is its type, kept apart from spending categories", () => {
    const list = [
      expense("spend", { category_id: "food" }),
      expense("pay", { nature: "credit", credit_kind: "salary", amount: 5000 }),
      expense("untyped", { nature: "credit", credit_kind: null, amount: 50 }),
    ];
    expect(headings("category", list)).toEqual(["Income:5000", "Food:-100", "Other:50"]);
  });
  it("adds money in and takes away money out", () => {
    const list = [expense("a", { merchant_name: "Store" }), expense("b", { merchant_name: "Store", nature: "credit", amount: 30 })];
    expect(headings("merchant", list)).toEqual(["Store:-70"]);
  });
  it("names what's missing", () => {
    expect(headings("merchant", [expense("a", {})])).toEqual(["No merchant:-100"]);
    expect(headings("person", [expense("a", {})])).toEqual(["Not shared:-100"]);
  });
  it("finds names for account, payment mode, person and month", () => {
    const e = expense("split", { account_id: "acc", payment_mode_id: "upi" });
    expect(headings("account", [e])).toEqual(["Main:-100"]);
    expect(headings("payment_mode", [e])).toEqual(["UPI:-100"]);
    expect(headings("person", [e])).toEqual(["Ravi:-100"]);
    expect(headings("month", [e])[0]).toMatch(/2026.*:-100$/);
  });
});

describe("Together's groups", () => {
  const row = (id: string, kind: string, over: Partial<StatementRow> = {}) =>
    ({ id, member: { id: "a", name: "Me" }, date: "2026-10-30", merchant: "Store", category: "Food", paid: 100, relation: { kind, amount: 0 }, ...over }) as StatementRow;

  it("settle-ups get their own group and add nothing to spending", () => {
    const list = groupStatementRows([row("x", "shared"), row("s", "settle", { category: null, paid: 900 })], "category", (k) => k);
    expect(list.flatMap((r) => (r.type === "group" ? [`${r.label}:${r.total}`] : []))).toEqual(["Food:100", "Settle-ups:0"]);
  });
});
