import { DatabaseSync } from "node:sqlite";

const mockDb: { db: DatabaseSync | null } = { db: null };

jest.mock("@/database", () => ({
  getDatabase: () => ({
    getAllAsync: async (sql: string, ...params: unknown[]) => mockDb.db!.prepare(sql).all(...(params.flat() as never[])),
    getFirstAsync: async (sql: string, ...params: unknown[]) => mockDb.db!.prepare(sql).get(...(params.flat() as never[])),
  }),
}));

import { getExpenseTotal, getExpensesPaginated } from "../../services/expense-queries";

const USER = "u1";
const FROM = "2026-10-01";
const TO = "2026-10-31";

beforeEach(() => {
  mockDb.db = new DatabaseSync(":memory:");
  mockDb.db.exec(`
    CREATE TABLE expenses (
      id TEXT PRIMARY KEY, user_id TEXT DEFAULT 'u1', amount REAL DEFAULT 100, currency TEXT, description TEXT, merchant_name TEXT,
      category_id TEXT, payment_mode_id TEXT, account_id TEXT, date TEXT DEFAULT '2026-10-15', transaction_time TEXT, due_date TEXT,
      is_right_spend INTEGER, source TEXT, status TEXT DEFAULT 'approved', nature TEXT DEFAULT 'realized', credit_kind TEXT,
      split_original_amount REAL, split_person_id TEXT, split_pct REAL, split_hisaab_entry_id TEXT, split_mode TEXT,
      deleted_at TEXT, created_at TEXT DEFAULT '2026-10-15', money_event TEXT, reclassified_as_transfer INTEGER, refund_of_expense_id TEXT,
      applied_rule_id TEXT, applied_rule_ids TEXT, purchase_group_id TEXT, linked_transfer_id TEXT
    );
    CREATE TABLE expense_investment_links (expense_id TEXT);
    CREATE TABLE expense_loan_links (expense_id TEXT);
    CREATE TABLE expense_tags (expense_id TEXT, tag_id TEXT);
    CREATE TABLE financial_accounts (id TEXT PRIMARY KEY, account_type TEXT);
    CREATE TABLE account_transfers (id TEXT PRIMARY KEY, to_account_id TEXT, linked_expense_id TEXT, deleted_at TEXT);
    INSERT INTO financial_accounts VALUES ('broker', 'demat'), ('sb2', 'savings');
    INSERT INTO account_transfers VALUES ('t1', 'broker', NULL, NULL), ('t2', 'sb2', NULL, NULL);
    INSERT INTO expenses (id, money_event, reclassified_as_transfer, linked_transfer_id) VALUES
      ('shop', NULL, NULL, NULL),
      ('marked', 'investment', NULL, NULL),
      ('toDemat', NULL, 1, 't1'),
      ('toSavings', NULL, 1, 't2');
  `);
});

const list = (filters: Record<string, unknown>) =>
  getExpensesPaginated(USER, { startDate: FROM, endDate: TO, nature: "realized", ...filters }, 50, 0);

describe("investments are money out, not spending", () => {
  it("a debit marked as an investment stays out of spending", async () => {
    expect(await getExpenseTotal(USER, FROM, TO)).toBe(100);
    expect((await list({ segment: "spend" })).map((e) => e.id)).toEqual(["shop"]);
    expect((await list({ segment: "committed" })).map((e) => e.id)).toEqual(["marked"]);
  });
  it("money moved into a demat account shows in Debits, tagged Investment", async () => {
    const rows = await list({ withInvestmentTransfers: true });
    expect(rows.map((e) => e.id).sort()).toEqual(["marked", "shop", "toDemat"]);
    expect(rows.find((e) => e.id === "toDemat")?.is_investment).toBe(1);
  });
  it("is never spending, and other screens still see it as a transfer", async () => {
    expect((await list({ withInvestmentTransfers: true, segment: "spend" })).map((e) => e.id)).toEqual(["shop"]);
    expect((await list({})).map((e) => e.id).sort()).toEqual(["marked", "shop"]);
  });
});
