import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "fs";
import { join } from "path";

const mockDb: { db: DatabaseSync | null } = { db: null };

const adapter = () => ({
  getAllAsync: async (sql: string, ...params: unknown[]) => mockDb.db!.prepare(sql).all(...(params.flat() as never[])),
  getFirstAsync: async (sql: string, ...params: unknown[]) => mockDb.db!.prepare(sql).get(...(params.flat() as never[])),
  runAsync: async (sql: string, ...params: unknown[]) => {
    const r = mockDb.db!.prepare(sql).run(...(params.flat() as never[]));
    return { changes: Number(r.changes) };
  },
});

jest.mock("@/database", () => ({ getDatabase: () => adapter() }));
jest.mock("@/services/settings", () => ({ bumpDataVersion: jest.fn() }));
jest.mock("@/services/expense-edit-history", () => ({ recordEdits: jest.fn() }));

import { reconcileSettlementKinds } from "../../database/credit-kind-backfill";
import { bulkSetCreditKind } from "../../services/expense-bulk";
import { getPeopleForExpenses } from "../../services/expense-people";
import { CREDIT_KIND_LOOKS, CREDIT_KINDS, creditKindsMatching, PICKABLE_CREDIT_KINDS } from "../../services/expense-types";

const kind = (id: string) => (mockDb.db!.prepare("SELECT credit_kind FROM expenses WHERE id = ?").get(id) as { credit_kind: string | null }).credit_kind;

beforeEach(() => {
  mockDb.db = new DatabaseSync(":memory:");
  mockDb.db.exec(`
    CREATE TABLE expenses (id TEXT PRIMARY KEY, nature TEXT DEFAULT 'credit', credit_kind TEXT, refund_of_expense_id TEXT, split_person_id TEXT, updated_at TEXT);
    CREATE TABLE hisaab_persons (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE hisaab_entries (id TEXT PRIMARY KEY, hisaab_person_id TEXT, linked_expense_id TEXT, type TEXT);
    CREATE TABLE expense_splits (id TEXT PRIMARY KEY, expense_id TEXT, hisaab_person_id TEXT);
    INSERT INTO hisaab_persons VALUES ('p1', 'Ravi'), ('p2', 'Mira');
  `);
});

describe("the Transactions list loads a credit's type", () => {
  // The list has its own column list. Without credit_kind every credit showed as Other (4.36.0).
  it("asks for credit_kind", () => {
    const source = readFileSync(join(__dirname, "../../services/expense-queries.ts"), "utf8");
    const projection = source.slice(source.indexOf("Explicit projection"), source.indexOf("FROM expenses", source.indexOf("Explicit projection")));
    expect(projection).toContain("credit_kind");
  });
});

describe("the settlement type follows the link", () => {
  beforeEach(() => {
    mockDb.db!.exec(`
      INSERT INTO expenses (id, credit_kind) VALUES ('linked', 'other'), ('plain', 'gift'), ('unlinked', 'settlement');
      INSERT INTO expenses (id, refund_of_expense_id, credit_kind) VALUES ('refund', 'x', 'refund');
      INSERT INTO hisaab_entries VALUES ('h1', 'p1', 'linked', 'settlement'), ('h2', 'p1', 'refund', 'settlement'), ('h3', 'p1', 'plain', 'debit');
    `);
  });

  it("sets it while linked and clears it when not, leaving refunds and everything else alone", async () => {
    await reconcileSettlementKinds(adapter() as never);
    expect(kind("linked")).toBe("settlement");
    expect(kind("unlinked")).toBeNull();
    expect(kind("refund")).toBe("refund");
    expect(kind("plain")).toBe("gift");
  });

  it("can be repeated", async () => {
    await reconcileSettlementKinds(adapter() as never);
    await reconcileSettlementKinds(adapter() as never);
    expect(kind("linked")).toBe("settlement");
  });
});

describe("bulk assigning a type", () => {
  it("changes the rest and counts the credits whose type comes from a link", async () => {
    mockDb.db!.exec(`
      INSERT INTO expenses (id, credit_kind) VALUES ('a', NULL), ('b', 'gift'), ('settled', 'settlement');
      INSERT INTO expenses (id, refund_of_expense_id, credit_kind) VALUES ('refund', 'x', 'refund');
      INSERT INTO expenses (id, nature) VALUES ('spend', 'realized');
    `);
    const result = await bulkSetCreditKind(["a", "b", "settled", "refund", "spend"], "interest");
    expect(result).toEqual({ changed: 2, skipped: 3 });
    expect(kind("a")).toBe("interest");
    expect(kind("b")).toBe("interest");
    expect(kind("settled")).toBe("settlement");
    expect(kind("refund")).toBe("refund");
    expect(kind("spend")).toBeNull();
  });
});

describe("who a transaction is with", () => {
  it("reads splits and settlements, and says when there are several", async () => {
    mockDb.db!.exec(`
      INSERT INTO expenses (id, split_person_id) VALUES ('one', 'p1'), ('none', NULL), ('many', NULL), ('paid', NULL);
      INSERT INTO expense_splits VALUES ('s1', 'many', 'p1'), ('s2', 'many', 'p2');
      INSERT INTO hisaab_entries VALUES ('h1', 'p2', 'paid', 'settlement');
    `);
    const people = await getPeopleForExpenses(["one", "none", "many", "paid"]);
    expect(people.get("one")).toBe("Ravi");
    expect(people.has("none")).toBe(false);
    expect(people.get("many")).toBe("Several people");
    expect(people.get("paid")).toBe("Mira");
  });
});

describe("types", () => {
  it("settlement can be filtered on but not picked, and every type has a look", () => {
    expect(CREDIT_KINDS).toContain("settlement");
    expect(PICKABLE_CREDIT_KINDS).not.toContain("settlement");
    for (const k of CREDIT_KINDS) expect(CREDIT_KIND_LOOKS[k].icon).toBeTruthy();
  });
  it("search finds a type by its name, but not everything for Other or a couple of letters", () => {
    expect(creditKindsMatching("dividend")).toEqual(["dividend"]);
    expect(creditKindsMatching("Settle")).toEqual(["settlement"]);
    expect(creditKindsMatching("other")).toEqual([]);
    expect(creditKindsMatching("in")).toEqual([]);
  });
});
