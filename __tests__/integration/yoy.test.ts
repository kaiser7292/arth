import { DatabaseSync } from "node:sqlite";

/**
 * computeYoY against a real SQLite engine: a year in progress is compared with the same months
 * of the other year, plan figures are scaled to the stretch compared, loans repaid and the
 * biggest movers come out right, and the summary says what changed.
 */
let mockSqlite: DatabaseSync;

const mockAdapter = {
  runAsync: async (sql: string, ...params: unknown[]) => {
    mockSqlite.prepare(sql).run(...(params as never[]));
    return { changes: 0, lastInsertRowId: 0 };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) =>
    mockSqlite.prepare(sql).all(...(params as never[])) as never[],
  getFirstAsync: async (sql: string, ...params: unknown[]) =>
    (mockSqlite.prepare(sql).get(...(params as never[])) ?? null) as never,
  withTransactionAsync: async (cb: () => Promise<void>) => cb(),
};

jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));
jest.mock("../../services/settings", () => ({
  getFYStartMonth: () => 4,
  getDataVersion: () => 0,
  bumpDataVersion: jest.fn(),
}));
jest.mock("../../services/storage", () => ({ settingsStorage: { getNumber: jest.fn(), set: jest.fn() } }));
jest.mock("../../services/financial-cockpit", () => ({ getFinancialCockpit: async () => null }));
jest.mock("../../services/net-worth-history", () => ({
  prevMonth: (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
  },
  getNetWorthHistory: async () => ({
    points: [
      { month: "2025-03", netWorth: 400000 },
      { month: "2025-08", netWorth: 450000 },
      { month: "2026-03", netWorth: 500000 },
      { month: "2026-08", netWorth: 580000 },
    ],
  }),
}));

import { computeYoY, summarise } from "../../services/reports/yoy";

function seed() {
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    CREATE TABLE financial_accounts (id TEXT PRIMARY KEY, user_id TEXT, account_type TEXT);
    CREATE TABLE categories (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, color TEXT);
    CREATE TABLE expenses (
      id TEXT PRIMARY KEY, user_id TEXT, account_id TEXT, amount REAL, category_id TEXT,
      merchant_name TEXT, raw_merchant_name TEXT, source TEXT DEFAULT 'manual',
      nature TEXT, status TEXT DEFAULT 'approved', deleted_at TEXT, reclassified_as_transfer INTEGER,
      refund_of_expense_id TEXT, credit_kind TEXT, money_event TEXT, date TEXT, created_at TEXT,
      split_original_amount REAL
    );
    CREATE TABLE expense_investment_links (id TEXT, expense_id TEXT, contribution_amount REAL);
    CREATE TABLE expense_loan_links (id TEXT, expense_id TEXT);
    CREATE TABLE account_transfers (id TEXT, from_account_id TEXT, to_account_id TEXT, amount REAL, date TEXT, deleted_at TEXT);
    CREATE TABLE investment_products (id TEXT, financial_account_id TEXT, valuation TEXT, start_date TEXT);
    CREATE TABLE yearly_plans (id TEXT, user_id TEXT, financial_year TEXT, total_planned_expenses REAL, total_planned_investments REAL);
    CREATE TABLE loan_accounts (id TEXT, financial_account_id TEXT, currency TEXT);
    CREATE TABLE loan_schedule_entries (id TEXT, loan_account_id TEXT, due_date TEXT, emi_amount REAL, paid_amount REAL, status TEXT);
    CREATE TABLE loan_prepayments (id TEXT, loan_account_id TEXT, prepayment_date TEXT, amount REAL);

    INSERT INTO financial_accounts VALUES ('s1', 'u1', 'savings'), ('l1', 'u1', 'loan');
    INSERT INTO categories VALUES ('food', 'u1', 'Food', '#F97316'), ('shop', 'u1', 'Shopping', '#6366F1');

    -- Last year (FY 2025): Apr-Aug, then a big December the same-months view must leave out
    INSERT INTO expenses (id, user_id, account_id, amount, category_id, nature, date) VALUES
      ('a1', 'u1', 's1', 10000, 'food', 'realized', '2025-05-10'),
      ('a2', 'u1', 's1', 30000, 'shop', 'realized', '2025-07-10'),
      ('a3', 'u1', 's1', 90000, 'shop', 'realized', '2025-12-10');
    INSERT INTO expenses (id, user_id, account_id, amount, nature, date) VALUES ('ai', 'u1', 's1', 100000, 'credit', '2025-04-30');

    -- This year (FY 2026) so far, up to 15 Aug
    INSERT INTO expenses (id, user_id, account_id, amount, category_id, nature, date) VALUES
      ('b1', 'u1', 's1', 14000, 'food', 'realized', '2026-05-10'),
      ('b2', 'u1', 's1', 12000, 'shop', 'realized', '2026-07-10');
    INSERT INTO expenses (id, user_id, account_id, amount, nature, date) VALUES ('bi', 'u1', 's1', 120000, 'credit', '2026-04-30');

    INSERT INTO yearly_plans VALUES ('p1', 'u1', '2026-27', 120000, 60000);
    INSERT INTO loan_accounts VALUES ('la', 'l1', 'INR');
    INSERT INTO loan_schedule_entries VALUES
      ('e1', 'la', '2026-05-05', 20000, NULL, 'paid'),
      ('e2', 'la', '2026-09-05', 20000, NULL, 'scheduled');
    INSERT INTO loan_prepayments VALUES ('pp', 'la', '2026-06-01', 50000);
  `);
}

describe("computeYoY", () => {
  it("compares a year in progress with the same months of the other year", async () => {
    seed();
    const y = await computeYoY("u1", 2026, 2025, "same-period", "2026-08-15");
    expect(y.partial).toBe(true);
    expect(y.base.endDate).toBe("2025-08-15");
    expect(y.base.spent).toBe(40000); // December's 90,000 is left out
    expect(y.current.spent).toBe(26000);
    expect(y.current.moneyIn).toBe(120000);
    expect(y.current.savedPct).toBeCloseTo(78.33, 1);
    expect(y.base.savedPct).toBe(60);
  });

  it("uses the full other year when asked", async () => {
    seed();
    const y = await computeYoY("u1", 2026, 2025, "full", "2026-08-15");
    expect(y.partial).toBe(false);
    expect(y.base.spent).toBe(130000);
  });

  it("scales a yearly plan to the months compared and leaves it out where there's none", async () => {
    seed();
    const y = await computeYoY("u1", 2026, 2025, "same-period", "2026-08-15");
    expect(y.current.planSpent).toBe(50000); // 5 of 12 months of 120,000
    expect(y.current.planInvested).toBe(25000);
    expect(y.base.planSpent).toBeNull();
  });

  it("counts paid EMIs and prepayments as loans repaid", async () => {
    seed();
    const y = await computeYoY("u1", 2026, 2025, "same-period", "2026-08-15");
    expect(y.current.loansRepaid).toBe(70000);
    expect(y.base.loansRepaid).toBe(0);
  });

  it("reads the net worth change for each stretch", async () => {
    seed();
    const y = await computeYoY("u1", 2026, 2025, "same-period", "2026-08-15");
    expect(y.current.netWorthChange).toBe(80000);
    expect(y.base.netWorthChange).toBe(50000);
  });

  it("lists the biggest movers with the transactions behind them", async () => {
    seed();
    const y = await computeYoY("u1", 2026, 2025, "same-period", "2026-08-15");
    expect(y.movers[0]).toMatchObject({ name: "Shopping", prev: 30000, curr: 12000, changePct: -60, expenseIds: ["b2"] });
    expect(y.movers[1]).toMatchObject({ name: "Food", changePct: 40 });
  });

  it("builds cumulative spending for the chart over the year's months", async () => {
    seed();
    const y = await computeYoY("u1", 2026, 2025, "same-period", "2026-08-15");
    expect(y.monthLabels).toHaveLength(12);
    expect(y.monthLabels[0]).toBe("Apr");
    expect(y.current.cumulative).toEqual([0, 14000, 14000, 26000, 26000]);
  });

  it("says what changed in one sentence", async () => {
    seed();
    const y = await computeYoY("u1", 2026, 2025, "same-period", "2026-08-15");
    expect(y.summary).toBe("You're spending 35% less and saving 18 points more than this time last year.");
    const same = summarise({ partial: false, current: { ...y.current, spent: 100, savedPct: 50 }, base: { ...y.base, spent: 100, savedPct: 50 } });
    expect(same).toMatch(/^About the same as/);
  });
});
