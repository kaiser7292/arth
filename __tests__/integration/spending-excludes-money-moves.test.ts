import { DatabaseSync } from "node:sqlite";

const mockDb: { db: DatabaseSync | null } = { db: null };

jest.mock("@/database", () => ({
  getDatabase: () => ({
    getAllAsync: async (sql: string, ...params: unknown[]) => mockDb.db!.prepare(sql).all(...(params.flat() as never[])),
    getFirstAsync: async (sql: string, ...params: unknown[]) => mockDb.db!.prepare(sql).get(...(params.flat() as never[])),
  }),
}));

import { getExpenseTotal, getExpensesPaginated } from "../../services/expense-queries";
import { getMerchantAnalytics } from "../../services/spending-insights";

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
      applied_rule_id TEXT, applied_rule_ids TEXT
    );
    CREATE TABLE expense_investment_links (expense_id TEXT);
    CREATE TABLE expense_loan_links (expense_id TEXT);
    CREATE TABLE expense_tags (expense_id TEXT, tag_id TEXT);
    INSERT INTO expenses (id, merchant_name, money_event, reclassified_as_transfer) VALUES
      ('shop', 'Sample Shop', NULL, NULL),
      ('fd', 'Sample Bank FD', 'fd_open', NULL),
      ('sip', 'Sample Fund', 'sip', NULL),
      ('own', 'My Other Account', 'self_transfer', NULL),
      ('moved', 'Converted To Transfer', NULL, 1);
  `);
});

const ids = async (segment: "spend" | "committed") =>
  (await getExpensesPaginated(USER, { startDate: FROM, endDate: TO, nature: "realized", segment }, 50, 0)).map((e) => e.id).sort();

describe("money moved rather than spent", () => {
  it("stays out of Merchants in Insights", async () => {
    const merchants = await getMerchantAnalytics(USER, FROM, TO, 20);
    expect(merchants.map((m) => m.merchant)).toEqual(["sample shop"]);
  });
  it("stays out of the total budgets are measured against", async () => {
    expect(await getExpenseTotal(USER, FROM, TO)).toBe(100);
  });
  it("moves from Expenses to Committed in Transactions, so nothing drops out of the list", async () => {
    expect(await ids("spend")).toEqual(["shop"]);
    expect(await ids("committed")).toEqual(["fd", "own", "sip"]);
  });
});
