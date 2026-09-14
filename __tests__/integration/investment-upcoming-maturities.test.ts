import { DatabaseSync } from "node:sqlite";

/**
 * getUpcomingFDMaturities — feeds the "Upcoming maturities" card on
 * /investments (app/investments/index.tsx). Against a real SQLite engine
 * since the thing worth checking is the JOIN + ordering + override fallback,
 * not just that some SQL string got called.
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
};

jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));

import { getUpcomingFDMaturities } from "../../services/investment-accounts";

function seed() {
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    CREATE TABLE financial_accounts (
      id TEXT PRIMARY KEY, user_id TEXT, is_active INTEGER DEFAULT 1,
      account_label TEXT, bank_name TEXT, account_identifier TEXT
    );
    CREATE TABLE investment_products (
      id TEXT PRIMARY KEY, financial_account_id TEXT, maturity_amount_override REAL
    );
    CREATE TABLE investment_schedule_entries (
      id TEXT PRIMARY KEY, product_id TEXT, kind TEXT, event_date TEXT, status TEXT,
      principal_component REAL, interest_component REAL
    );
  `);
  mockSqlite.exec(`
    INSERT INTO financial_accounts VALUES ('fa-1', 'u1', 1, 'Tax saver FD', 'HDFC', 'FD001');
    INSERT INTO financial_accounts VALUES ('fa-2', 'u1', 1, NULL, 'ICICI', 'FD002');
    INSERT INTO financial_accounts VALUES ('fa-3', 'u1', 1, 'Other user FD', 'SBI', 'FD003');

    INSERT INTO investment_products VALUES ('prod-1', 'fa-1', NULL);
    INSERT INTO investment_products VALUES ('prod-2', 'fa-2', 52000);
    INSERT INTO investment_products VALUES ('prod-3', 'fa-3', NULL);

    -- fa-1: computed figure (no override), matures later.
    INSERT INTO investment_schedule_entries VALUES ('se-1', 'prod-1', 'maturity', '2026-12-01', 'scheduled', 100000, 7100);
    -- fa-2: manually corrected figure — should win over principal+interest.
    INSERT INTO investment_schedule_entries VALUES ('se-2', 'prod-2', 'maturity', '2026-06-01', 'scheduled', 50000, 3500);
    -- fa-3: belongs to a different user — must not appear.
    INSERT INTO investment_schedule_entries VALUES ('se-3', 'prod-3', 'maturity', '2026-01-01', 'scheduled', 20000, 1000);
  `);
  // fa-3 owned by a different user.
  mockSqlite.prepare("UPDATE financial_accounts SET user_id = 'u2' WHERE id = 'fa-3';").run();
}

describe("getUpcomingFDMaturities", () => {
  it("orders by soonest maturity first and scopes to the requesting user", async () => {
    seed();
    const rows = await getUpcomingFDMaturities("u1", 5);
    expect(rows.map((r) => r.financialAccountId)).toEqual(["fa-2", "fa-1"]);
  });

  it("uses the manual override amount when set, else principal + interest", async () => {
    seed();
    const rows = await getUpcomingFDMaturities("u1", 5);
    const fa1 = rows.find((r) => r.financialAccountId === "fa-1")!;
    const fa2 = rows.find((r) => r.financialAccountId === "fa-2")!;
    expect(fa1.maturityAmount).toBe(107100); // 100000 + 7100, no override
    expect(fa2.maturityAmount).toBe(52000); // override wins over 50000 + 3500

    // interestAmount is maturityAmount minus principal, override-aware —
    // feeds the "total interest earned" summary on /investments.
    expect(fa1.interestAmount).toBe(7100); // 107100 - 100000
    expect(fa2.interestAmount).toBe(2000); // 52000 (override) - 50000, NOT the computed 3500
  });

  it("falls back to bank name + last digits when no account_label is set", async () => {
    seed();
    const rows = await getUpcomingFDMaturities("u1", 5);
    const fa2 = rows.find((r) => r.financialAccountId === "fa-2")!;
    expect(fa2.label).toBe("ICICI ••FD002");
  });

  it("respects the limit", async () => {
    seed();
    const rows = await getUpcomingFDMaturities("u1", 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].financialAccountId).toBe("fa-2");
  });
});
