import { NO_GROUP } from "../../utils/group-rows";
import { filterOptions, filterRows, groupListRows, sortRows, type ListField, type ListSort } from "../../utils/list-tools";

type Row = { id: string; shop: string | null; tags: string[]; amount: number; day: string };
const rows: Row[] = [
  { id: "a", shop: "Store", tags: ["x"], amount: 100, day: "2026-10-03" },
  { id: "b", shop: "Cafe", tags: ["x", "y"], amount: 300, day: "2026-10-02" },
  { id: "c", shop: null, tags: [], amount: 200, day: "2026-10-01" },
  { id: "d", shop: "Store", tags: ["y"], amount: 50, day: "2026-10-01" },
];
const shop: ListField<Row> = { id: "shop", label: "Shop", keyOf: (r) => r.shop, noneLabel: "No shop", filter: true, group: true };
const tags: ListField<Row> = { id: "tags", label: "Tags", keyOf: () => null, keysOf: (r) => r.tags, filter: true };
const day: ListField<Row> = { id: "day", label: "Day", keyOf: (r) => r.day, group: true, groupOrder: "first" };
const fields = [shop, tags, day];
const search = (r: Row) => ({ texts: [r.shop], amounts: [r.amount] });
const ids = (list: Row[]) => list.map((r) => r.id);

describe("filterRows", () => {
  it("lets everything through with nothing on", () => {
    expect(ids(filterRows(rows, fields, {}, "", search))).toEqual(["a", "b", "c", "d"]);
    expect(ids(filterRows(rows, fields, { shop: [] }, "  ", search))).toEqual(["a", "b", "c", "d"]);
  });
  it("matches any choice within a filter and all the filters together", () => {
    expect(ids(filterRows(rows, fields, { shop: ["Store", "Cafe"] }, "", search))).toEqual(["a", "b", "d"]);
    expect(ids(filterRows(rows, fields, { shop: ["Store"], tags: ["y"] }, "", search))).toEqual(["d"]);
  });
  it("finds rows with nothing set through their none choice", () => {
    expect(ids(filterRows(rows, fields, { shop: [NO_GROUP] }, "", search))).toEqual(["c"]);
  });
  it("searches names and amounts, on top of filters", () => {
    expect(ids(filterRows(rows, fields, {}, "caf", search))).toEqual(["b"]);
    expect(ids(filterRows(rows, fields, {}, "200", search))).toEqual(["c"]);
    expect(ids(filterRows(rows, fields, { shop: ["Store"] }, "caf", search))).toEqual([]);
  });
  it("a list with no search ignores the text", () => {
    expect(ids(filterRows(rows, fields, {}, "caf"))).toEqual(["a", "b", "c", "d"]);
  });
});

describe("sortRows", () => {
  const high: ListSort<Row> = { id: "high", label: "High", compare: (a, b) => b.amount - a.amount };
  it("sorts a copy", () => {
    const before = [...rows];
    expect(ids(sortRows(rows, high))).toEqual(["b", "c", "a", "d"]);
    expect(rows).toEqual(before);
  });
  it("keeps the order rows come in when the sort has no compare", () => {
    expect(ids(sortRows(rows, { id: "listed", label: "As listed" }))).toEqual(["a", "b", "c", "d"]);
    expect(ids(sortRows(rows, undefined))).toEqual(["a", "b", "c", "d"]);
  });
});

describe("groupListRows", () => {
  const shape = (list: ReturnType<typeof groupListRows<Row>>) => list.map((r) => (r.type === "heading" ? `[${r.label}:${r.total}]` : r.item.id));
  it("no field means no headings", () => {
    expect(shape(groupListRows(rows, undefined, (r) => r.amount))).toEqual(["a", "b", "c", "d"]);
  });
  it("biggest first, nothing-set last, under the field's own words", () => {
    expect(shape(groupListRows(rows, shop, (r) => r.amount))).toEqual(["[Cafe:300]", "b", "[Store:150]", "a", "d", "[No shop:200]", "c"]);
  });
  it("dates stay in order and hold together when sorted by amount", () => {
    const sorted = sortRows(rows, { id: "low", label: "Low", compare: (a, b) => a.amount - b.amount });
    expect(shape(groupListRows(sorted, day, (r) => r.amount))).toEqual(["[2026-10-01:250]", "d", "c", "[2026-10-03:100]", "a", "[2026-10-02:300]", "b"]);
  });
});

describe("filterOptions", () => {
  it("counts each choice, puts nothing-set first and then the biggest", () => {
    expect(filterOptions(rows, shop, [])).toEqual([
      { id: NO_GROUP, label: "No shop (1)" },
      { id: "Store", label: "Store (2)" },
      { id: "Cafe", label: "Cafe (1)" },
    ]);
  });
  it("a row counts under each thing it matches", () => {
    expect(filterOptions(rows, tags, []).map((o) => o.label)).toEqual(["x (2)", "y (2)"]);
  });
  it("keeps a choice that's on even when no row has it, so it can be switched off", () => {
    expect(filterOptions(rows, shop, ["Gone"]).map((o) => o.id)).toContain("Gone");
  });
});
