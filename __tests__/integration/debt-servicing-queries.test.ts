import { DatabaseSync } from "node:sqlite";

/**
 * The Budget tab's debt servicing row and the savings rate's EMI interest read loan tables with
 * hand-written SQL. Run both against the schema the migrations build, so a missing column fails here
 * rather than blanking a screen on the phone.
 */

let mockDb: DatabaseSync;
const mockAdapter = {
  execAsync: async (sql: string) => {
    mockDb.exec(sql);
  },
  runAsync: async (sql: string, ...params: unknown[]) => {
    const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
    const r = mockDb.prepare(sql).run(...(flat as never[]));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).all(...(params as never[])),
  getFirstAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).get(...(params as never[])) ?? null,
  withTransactionAsync: async (fn: () => Promise<void>) => {
    mockDb.exec("BEGIN");
    try {
      await fn();
      mockDb.exec("COMMIT");
    } catch (e) {
      mockDb.exec("ROLLBACK");
      throw e;
    }
  },
};

jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: () => undefined,
    getNumber: () => undefined,
    getString: () => undefined,
    set: () => {},
    delete: () => {},
    getAllKeys: () => [],
  })),
}));
jest.mock("@/database", () => ({ getDatabase: () => mockAdapter }));

import { runMigrations } from "../../database/migrations";
import { getDebtServicing } from "../../services/loan-accounts";
import { getLoanPaymentsByMonth } from "../../services/savings-tracker";

/** Insert a row filling every NOT NULL column without a default, so the test survives new columns. */
function insert(table: string, values: Record<string, unknown>) {
  const cols = mockDb.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number; dflt_value: unknown; pk: number }[];
  const row: Record<string, unknown> = { ...values };
  for (const c of cols) {
    if (c.name in row || !c.notnull || c.dflt_value != null) continue;
    row[c.name] = c.name.endsWith("_date") || c.name.endsWith("_at") ? "2026-11-01" : 0;
  }
  const names = Object.keys(row);
  mockDb.prepare(`INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...(Object.values(row) as never[]));
}

beforeAll(async () => {
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  mockDb.exec("PRAGMA foreign_keys = OFF");
  insert("financial_accounts", { id: "fa1", user_id: "u1", account_type: "loan", bank_name: "HDFC" });
  insert("loan_accounts", { id: "l1", financial_account_id: "fa1", status: "active", currency: "INR", loan_type: "home", emi_day_of_month: 5, interest_type: "fixed" });
  insert("loan_schedule_entries", { id: "s1", loan_account_id: "l1", installment_num: 1, due_date: "2026-11-05", emi_amount: 20000, principal_component: 12000, interest_component: 8000, status: "paid" });
  insert("loan_schedule_entries", { id: "s2", loan_account_id: "l1", installment_num: 2, due_date: "2026-12-05", emi_amount: 20000, principal_component: 12100, interest_component: 7900, status: "scheduled" });
  insert("expenses", { id: "e1", user_id: "u1", amount: 20000, date: "2026-11-05", status: "approved", nature: "realized" });
  insert("expense_loan_links", { id: "ll1", expense_id: "e1", loan_account_id: "l1", link_kind: "emi", schedule_entry_id: "s1", amount: 20000 });
  // A prepayment the same month: counts as paid, shown apart from the EMI.
  insert("expenses", { id: "e2", user_id: "u1", amount: 50000, date: "2026-11-20", status: "approved", nature: "realized" });
  insert("expense_loan_links", { id: "ll2", expense_id: "e2", loan_account_id: "l1", link_kind: "prepayment", amount: 50000 });
});

test("debt servicing: each loan's EMIs and prepayments paid, and EMIs due by the schedule", async () => {
  const nov = await getDebtServicing("u1", "2026-11-01", "2026-11-30");
  expect(nov).toMatchObject({ paid: 70000, prepaid: 50000, due: 20000 });
  expect(nov.loans).toEqual([{ loanId: "l1", name: "HDFC Home loan", paid: 70000, prepaid: 50000, due: 20000 }]);
  expect(await getDebtServicing("u1", "2026-12-01", "2026-12-31")).toMatchObject({ paid: 0, prepaid: 0, due: 20000 });
});

test("a rebuilt schedule (lower EMI after a prepayment) is what's due", async () => {
  mockDb.prepare("UPDATE loan_schedule_entries SET emi_amount = 15000 WHERE id = 's2'").run();
  expect((await getDebtServicing("u1", "2026-12-01", "2026-12-31")).due).toBe(15000);
});

test("savings rate takes off every loan payment, EMIs and prepayments", async () => {
  const m = await getLoanPaymentsByMonth("u1", "2026-04-01", "2027-03-31");
  expect([...m.entries()]).toEqual([["2026-11", 70000]]);
});
