import { DatabaseSync } from "node:sqlite";

const mockDb: { db: DatabaseSync | null } = { db: null };
import { backfillCreditKinds } from "../../database/credit-kind-backfill";
import { creditKindOf, creditLook } from "../../services/expense-types";

const adapter = () => ({
  getAllAsync: async (sql: string) => mockDb.db!.prepare(sql).all(),
  runAsync: async (sql: string, ...params: unknown[]) => mockDb.db!.prepare(sql).run(...(params as never[])),
});

describe("older credits get the type they show", () => {
  beforeEach(() => {
    mockDb.db = new DatabaseSync(":memory:");
    mockDb.db.exec(`
      CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE expenses (id TEXT PRIMARY KEY, nature TEXT, credit_kind TEXT, category_id TEXT, refund_of_expense_id TEXT, raw_source_text TEXT, description TEXT);
      INSERT INTO categories VALUES ('salary', 'Salary'), ('rent', 'Rent & Utilities');
    `);
  });

  const add = (id: string, fields: Record<string, string>) => {
    const cols = ["id", "nature", ...Object.keys(fields)];
    mockDb.db!.prepare(`INSERT INTO expenses (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(id, fields.nature ?? "credit", ...Object.values(fields));
  };
  const kind = (id: string) => (mockDb.db!.prepare("SELECT credit_kind FROM expenses WHERE id = ?").get(id) as { credit_kind: string | null }).credit_kind;

  it("from the refund link, a category of that name, then the words", async () => {
    add("linked", { refund_of_expense_id: "x" });
    add("named", { category_id: "salary" });
    add("sms", { raw_source_text: "Dividend credited to your account" });
    add("note", { description: "Rent for October" });
    add("spending", { category_id: "rent" });
    add("set", { credit_kind: "gift", raw_source_text: "salary" });
    await backfillCreditKinds(adapter() as never);
    expect(kind("linked")).toBe("refund");
    expect(kind("named")).toBe("salary");
    expect(kind("sms")).toBe("dividend");
    expect(kind("note")).toBe("rent");
    // A spending category says nothing about what the money is.
    expect(kind("spending")).toBeNull();
    // A type someone chose is left alone.
    expect(kind("set")).toBe("gift");
  });

  it("a credit with no type shows as Other", () => {
    expect(creditKindOf(null)).toBe("other");
    expect(creditLook(null).name).toBe("Other");
    expect(creditLook("dividend").name).toBe("Dividend");
    expect(creditLook("rent").name).toBe("Rent received");
  });
});
