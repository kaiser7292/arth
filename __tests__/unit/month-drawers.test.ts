import { buildDrawerRows, monthBounds, orderMonths, summarizeByMonth, type MonthSummary } from "../../utils/month-drawers";

const totals = new Map<string, MonthSummary>([
  ["2026-09", { month: "2026-09", spent: 100, received: 0, count: 2 }],
  ["2026-11", { month: "2026-11", spent: 50, received: 900, count: 3 }],
  ["2026-10", { month: "2026-10", spent: 0, received: 0, count: 0 }],
]);

test("months newest first, empty ones left out", () => {
  expect(orderMonths(totals).map((m) => m.month)).toEqual(["2026-11", "2026-09"]);
  expect(orderMonths(totals, true).map((m) => m.month)).toEqual(["2026-09", "2026-11"]);
});

test("a month's days, kept inside the list's range", () => {
  expect(monthBounds("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  expect(monthBounds("2026-11", "2025-12-01", "2026-11-16")).toEqual({ start: "2026-11-01", end: "2026-11-16" });
  expect(monthBounds("2025-12", "2025-12-10", "2026-11-16")).toEqual({ start: "2025-12-10", end: "2025-12-31" });
});

test("totals from rows in memory", () => {
  const rows = [
    { d: "2026-11-02", a: -40 },
    { d: "2026-11-09", a: 300 },
    { d: "2026-10-01", a: -10 },
  ];
  const m = summarizeByMonth(rows, (r) => r.d, (r) => r.a);
  expect(m.get("2026-11")).toEqual({ month: "2026-11", spent: 40, received: 300, count: 2 });
  expect(m.get("2026-10")).toEqual({ month: "2026-10", spent: 10, received: 0, count: 1 });
});

type Row = { id: string; date: string; amount: number };
const nov: Row[] = [
  { id: "a", date: "2026-11-09", amount: -20 },
  { id: "b", date: "2026-11-09", amount: 500 },
  { id: "c", date: "2026-11-02", amount: -30 },
];

test("an open month shows its days and rows, a closed one only its header", () => {
  const rows = buildDrawerRows<Row>({
    months: orderMonths(totals),
    open: new Set(["2026-11"]),
    rowsOf: (m) => (m === "2026-11" ? nov : undefined),
    dateOf: (r) => r.date,
    amountOf: (r) => r.amount,
    dayHeadings: true,
  });
  expect(rows.map((r) => r.kind)).toEqual(["month", "day", "item", "item", "day", "item", "end", "month"]);
  const days = rows.filter((r) => r.kind === "day") as { total: number }[];
  expect(days.map((d) => d.total)).toEqual([480, -30]);
  const items = rows.filter((r) => r.kind === "item") as { last: boolean }[];
  expect(items.map((i) => i.last)).toEqual([false, false, true]);
});

test("an open month that hasn't loaded shows a loading row; one with nothing shows empty", () => {
  const rows = buildDrawerRows<Row>({
    months: orderMonths(totals),
    open: new Set(["2026-11", "2026-09"]),
    rowsOf: (m) => (m === "2026-09" ? [] : undefined),
    dateOf: (r) => r.date,
    amountOf: (r) => r.amount,
    dayHeadings: false,
  });
  expect(rows.map((r) => r.kind)).toEqual(["month", "loading", "end", "month", "empty", "end"]);
});
