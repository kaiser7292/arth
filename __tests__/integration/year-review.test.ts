import { DatabaseSync } from "node:sqlite";

/**
 * buildYearReview against a real SQLite engine, plus the sharing rule: with
 * "Hide amounts" on, no shared line carries a money figure.
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
      { month: "2025-03", netWorth: 500000, loans: 200000, hisaab: 0 },
      { month: "2025-09", netWorth: 560000, loans: 180000, hisaab: 0 },
      { month: "2026-03", netWorth: 650000, loans: 150000, hisaab: 2000 },
    ],
  }),
}));

import { buildShareLines, buildYearReview, getReadyReviewFY } from "../../services/reports/year-review";

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
    CREATE TABLE hisaab_persons (id TEXT, owner_user_id TEXT);
    CREATE TABLE hisaab_entries (id TEXT, hisaab_person_id TEXT, type TEXT, amount REAL, date TEXT);

    INSERT INTO financial_accounts VALUES ('s1', 'u1', 'savings'), ('d1', 'u1', 'demat'), ('cc', 'u1', 'credit_card');
    INSERT INTO categories VALUES ('food', 'u1', 'Food', '#F97316'), ('rent', 'u1', 'Rent', '#6366F1');

    -- FY 2025-26 spending
    INSERT INTO expenses (id, user_id, account_id, amount, category_id, merchant_name, source, nature, date) VALUES
      ('e1', 'u1', 's1', 30000, 'rent', 'Landlord', 'manual', 'realized', '2025-04-05'),
      ('e2', 'u1', 's1', 30000, 'rent', 'Landlord', 'manual', 'realized', '2025-05-05'),
      ('e3', 'u1', 's1', 500, 'food', 'Swiggy', 'sms_auto', 'realized', '2025-05-10'),
      ('e4', 'u1', 's1', 700, 'food', 'Swiggy', 'sms_auto', 'realized', '2025-06-11'),
      ('e5', 'u1', 's1', 400, 'food', 'Swiggy', 'sms_auto', 'realized', '2025-06-20');
    -- refund on e4: not counted as money in, and reduces the spend
    INSERT INTO expenses (id, user_id, account_id, amount, nature, refund_of_expense_id, date) VALUES
      ('r1', 'u1', 's1', 200, 'credit', 'e4', '2025-06-12');
    -- salary in, card payment credit (ignored)
    INSERT INTO expenses (id, user_id, account_id, amount, nature, date) VALUES
      ('c1', 'u1', 's1', 100000, 'credit', '2025-04-30'),
      ('c2', 'u1', 'cc', 9999, 'credit', '2025-05-30');
    -- previous FY: food only
    INSERT INTO expenses (id, user_id, account_id, amount, category_id, merchant_name, nature, date) VALUES
      ('p1', 'u1', 's1', 1000, 'food', 'Zomato', 'realized', '2024-06-01');

    INSERT INTO account_transfers VALUES ('t1', 's1', 'd1', 10000, '2025-07-01', NULL);
    INSERT INTO hisaab_persons VALUES ('h1', 'u1');
    INSERT INTO hisaab_entries VALUES ('he1', 'h1', 'settlement', 1500, '2025-08-01');
  `);
}

describe("buildYearReview", () => {
  it("sums the year from spending, money in, net worth and Hisaab", async () => {
    seed();
    const r = await buildYearReview("u1", 2025, "2026-05-01");

    expect(r.fyLabel).toContain("2025");
    expect(r.isComplete).toBe(true);
    expect(r.totals.spent).toBe(61400); // 61600 − 200 refund
    expect(r.totals.txCount).toBe(5);
    expect(r.totals.smsCount).toBe(3);
    expect(r.totals.moneyIn).toBe(100000); // refund and card-payment credits left out

    expect(r.savings?.source).toBe("flows");
    expect(r.savings?.ratePct).toBeCloseTo(38.6, 1);

    expect(r.categories[0].name).toBe("Rent");
    expect(r.merchants.byVisits[0]).toMatchObject({ name: "Swiggy", count: 3 });
    expect(r.biggestMonth?.month).toBe("2025-05");
    expect(r.months).toHaveLength(12);

    expect(r.netWorth).toMatchObject({ start: 500000, end: 650000, change: 150000 });
    expect(r.debt).toMatchObject({ reduced: 50000 });
    expect(r.invested).toMatchObject({ amount: 10000 });
    expect(r.hisaab).toMatchObject({ peopleSettled: 1, settledAmount: 1500, netAtEnd: 2000 });
    expect(r.vsLastYear?.spentPrev).toBe(1000);
  });

  it("with Hide amounts on, no shared line contains a money figure", async () => {
    seed();
    const r = await buildYearReview("u1", 2025, "2026-05-01");
    const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

    const shown = buildShareLines(r, false, fmt);
    expect(shown.some((l) => l.value.includes("₹"))).toBe(true);

    const hidden = buildShareLines(r, true, fmt);
    expect(hidden.length).toBeGreaterThan(3);
    for (const line of hidden) expect(line.value).not.toContain("₹");
    // Specific money figures never leak in another form either.
    const joined = hidden.map((l) => l.value).join(" ");
    for (const n of ["61,400", "61400", "150,000", "1,50,000", "50,000", "10,000"]) expect(joined).not.toContain(n);
  });
});

describe("getReadyReviewFY", () => {
  it("offers last FY during the first 30 days of a new FY only", () => {
    expect(getReadyReviewFY(new Date(2026, 3, 1))).toBe(2025);
    expect(getReadyReviewFY(new Date(2026, 3, 30))).toBe(2025);
    expect(getReadyReviewFY(new Date(2026, 4, 1))).toBeNull();
    expect(getReadyReviewFY(new Date(2026, 2, 31))).toBeNull();
  });
});
