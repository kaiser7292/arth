import { DatabaseSync } from "node:sqlite";

/**
 * FD auto-renewal (docs/FD_IMPROVEMENTS_PROPOSAL.md point 4) and the
 * recompute of upcoming FD figures, against a REAL SQLite engine.
 */
let mockSqlite: DatabaseSync;
let mockNextId = 0;

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
jest.mock("../../services/settings", () => ({ bumpDataVersion: jest.fn() }));
jest.mock("../../utils/uuid", () => ({ generateUUID: () => `gen-${++mockNextId}` }));

import {
  getFDRenewedOn,
  isFDEditable,
  materialiseMaturedInvestments,
  refreshFDScheduleFigures,
  updateFDDetails,
} from "../../services/investment-accounts";
import { addMonthsClamped, computeFDInterest } from "../../services/investment-engine";
import { todayIso } from "../../utils/date";

const TODAY = todayIso();
// A 1-year FD that matured a month ago: renews once, next maturity 11 months ahead.
const START = addMonthsClamped(TODAY, -13);
const MATURITY = addMonthsClamped(START, 12);
const NEXT_MATURITY = addMonthsClamped(MATURITY, 12);

const fdParams = (principal: number, start: string, maturity: string) => ({
  principal,
  interest_rate_pa: 7,
  start_date: start,
  maturity_date: maturity,
  interest_method: "compound" as const,
  compounding_freq: "quarterly" as const,
});

function seed(opts: {
  mode: "none" | "principal" | "principal_interest";
  start?: string;
  maturity?: string;
  principal?: number;
  interest?: number;
  override?: number | null;
}) {
  const start = opts.start ?? START;
  const maturity = opts.maturity ?? MATURITY;
  const principal = opts.principal ?? 100000;
  const interest = opts.interest ?? computeFDInterest(fdParams(principal, start, maturity));
  mockNextId = 0;
  mockSqlite = new DatabaseSync(":memory:");
  mockSqlite.exec(`
    CREATE TABLE financial_accounts (
      id TEXT PRIMARY KEY, user_id TEXT, is_active INTEGER DEFAULT 1, bank_name TEXT,
      closed_at TEXT, closed_note TEXT, updated_at TEXT, account_type TEXT
    );
    CREATE TABLE investment_products (
      id TEXT PRIMARY KEY, financial_account_id TEXT, instrument TEXT DEFAULT 'fd', valuation TEXT DEFAULT 'contract',
      principal REAL, interest_rate_pa REAL, interest_method TEXT, compounding_freq TEXT,
      start_date TEXT, maturity_date TEXT, payout_mode TEXT, source_account_id TEXT,
      auto_credit_on_maturity INTEGER, status TEXT, created_at TEXT, updated_at TEXT,
      investment_bucket_id TEXT, linked_contribution_id TEXT, maturity_amount_override REAL,
      renewal_mode TEXT NOT NULL DEFAULT 'none'
    );
    CREATE TABLE investment_schedule_entries (
      id TEXT PRIMARY KEY, product_id TEXT, event_num INTEGER, event_date TEXT, kind TEXT,
      principal_component REAL, interest_component REAL, status TEXT DEFAULT 'scheduled',
      linked_expense_id TEXT, linked_transfer_id TEXT
    );
    CREATE TABLE expenses (
      id TEXT PRIMARY KEY, user_id TEXT, amount REAL, currency TEXT, description TEXT,
      account_id TEXT, date TEXT, nature TEXT, source TEXT, status TEXT, created_at TEXT,
      deleted_at TEXT
    );
    INSERT INTO financial_accounts (id, user_id, bank_name, account_type) VALUES ('fd-fa', 'u1', 'HDFC', 'investment');
    INSERT INTO financial_accounts (id, user_id, bank_name, account_type) VALUES ('savings-fa', 'u1', 'HDFC', 'savings');
  `);
  mockSqlite
    .prepare(
      `INSERT INTO investment_products
         (id, financial_account_id, principal, interest_rate_pa, interest_method, compounding_freq,
          start_date, maturity_date, source_account_id, status, maturity_amount_override, renewal_mode)
       VALUES ('prod-1', 'fd-fa', ?, 7, 'compound', 'quarterly', ?, ?, 'savings-fa', 'active', ?, ?);`,
    )
    .run(principal, start, maturity, opts.override ?? null, opts.mode);
  mockSqlite
    .prepare(
      `INSERT INTO investment_schedule_entries
         (id, product_id, event_num, event_date, kind, principal_component, interest_component, status)
       VALUES ('se-1', 'prod-1', 1, ?, 'maturity', ?, ?, 'scheduled');`,
    )
    .run(maturity, principal, interest);
}

const product = () =>
  mockSqlite.prepare("SELECT * FROM investment_products WHERE id = 'prod-1'").get() as {
    principal: number;
    start_date: string;
    maturity_date: string;
    status: string;
    maturity_amount_override: number | null;
  };
const entries = () =>
  mockSqlite
    .prepare("SELECT * FROM investment_schedule_entries WHERE product_id = 'prod-1' ORDER BY event_num")
    .all() as { id: string; event_num: number; event_date: string; status: string; principal_component: number; interest_component: number; linked_expense_id: string | null }[];
const credits = () =>
  mockSqlite.prepare("SELECT * FROM expenses WHERE nature = 'credit' AND deleted_at IS NULL ORDER BY date").all() as {
    id: string;
    amount: number;
    account_id: string;
    status: string;
    description: string;
    date: string;
  }[];
const fdClosedAt = () =>
  (mockSqlite.prepare("SELECT closed_at FROM financial_accounts WHERE id = 'fd-fa'").get() as { closed_at: string | null }).closed_at;

describe("FD renewal at maturity", () => {
  it("principal only: pays the interest to the funding account and renews the principal for the same term", async () => {
    seed({ mode: "principal" });
    const interest = computeFDInterest(fdParams(100000, START, MATURITY));
    await materialiseMaturedInvestments("u1");

    expect(credits()).toEqual([
      expect.objectContaining({ amount: interest, account_id: "savings-fa", status: "pending_review", date: MATURITY }),
    ]);
    expect(product()).toMatchObject({ principal: 100000, start_date: MATURITY, maturity_date: NEXT_MATURITY, status: "active" });
    const [old, next] = entries();
    expect(old).toMatchObject({ status: "materialised", linked_expense_id: credits()[0].id });
    expect(next).toMatchObject({
      event_num: 2,
      event_date: NEXT_MATURITY,
      status: "scheduled",
      principal_component: 100000,
      interest_component: computeFDInterest(fdParams(100000, MATURITY, NEXT_MATURITY)),
    });
    expect(fdClosedAt()).toBeNull();
    expect(await getFDRenewedOn("prod-1")).toBe(MATURITY);
  });

  it("principal + interest: credits the interest inside the FD and renews the whole maturity amount", async () => {
    seed({ mode: "principal_interest" });
    const interest = computeFDInterest(fdParams(100000, START, MATURITY));
    await materialiseMaturedInvestments("u1");

    expect(credits()).toEqual([expect.objectContaining({ amount: interest, account_id: "fd-fa", status: "pending_review" })]);
    expect(product()).toMatchObject({ principal: 100000 + interest, start_date: MATURITY, maturity_date: NEXT_MATURITY });
    expect(entries()[1]).toMatchObject({
      principal_component: 100000 + interest,
      interest_component: computeFDInterest(fdParams(100000 + interest, MATURITY, NEXT_MATURITY)),
    });
    expect(fdClosedAt()).toBeNull();
  });

  it("uses the corrected maturity amount for the finished term, then clears it", async () => {
    seed({ mode: "principal_interest", override: 107500 });
    await materialiseMaturedInvestments("u1");
    expect(credits()[0].amount).toBe(7500);
    expect(product()).toMatchObject({ principal: 107500, maturity_amount_override: null });
  });

  it("uses the bank's interest credit from SMS (net of TDS) instead of queuing another", async () => {
    seed({ mode: "principal" });
    const interest = computeFDInterest(fdParams(100000, START, MATURITY));
    const net = Math.round(interest * 0.9);
    mockSqlite
      .prepare(
        `INSERT INTO expenses (id, user_id, amount, account_id, date, nature, source, status)
         VALUES ('sms-int', 'u1', ?, 'savings-fa', ?, 'credit', 'sms_auto', 'pending_review');`,
      )
      .run(net, MATURITY);
    await materialiseMaturedInvestments("u1");
    expect(credits()).toHaveLength(1);
    expect(entries()[0].linked_expense_id).toBe("sms-int");
  });

  it("catches up several terms when the app wasn't opened", async () => {
    const start = addMonthsClamped(TODAY, -25); // matured 13 months ago and 1 month ago
    seed({ mode: "principal", start, maturity: addMonthsClamped(start, 12) });
    await materialiseMaturedInvestments("u1");
    expect(entries().map((e) => e.status)).toEqual(["materialised", "materialised", "scheduled"]);
    expect(credits()).toHaveLength(2);
    expect(product().maturity_date).toBe(addMonthsClamped(start, 36));
  });

  it("is idempotent", async () => {
    seed({ mode: "principal" });
    await materialiseMaturedInvestments("u1");
    await materialiseMaturedInvestments("u1");
    expect(credits()).toHaveLength(1);
    expect(entries()).toHaveLength(2);
  });

  it("doesn't renew an FD that isn't due yet", async () => {
    seed({ mode: "principal", start: TODAY, maturity: addMonthsClamped(TODAY, 12) });
    await materialiseMaturedInvestments("u1");
    expect(credits()).toHaveLength(0);
    expect(entries()).toHaveLength(1);
  });

  it("a renewed FD stays editable: only the new term is regenerated, history is kept", async () => {
    seed({ mode: "principal" });
    await materialiseMaturedInvestments("u1");
    expect(await isFDEditable("prod-1")).toBe(true);
    await updateFDDetails("fd-fa", {
      interest_rate_pa: 6.5,
      interest_method: "compound",
      compounding_freq: "quarterly",
      maturity_date: NEXT_MATURITY,
      renewal_mode: "none",
    });
    const all = entries();
    expect(all).toHaveLength(2);
    expect(all[0].status).toBe("materialised");
    expect(all[1]).toMatchObject({
      event_num: 2,
      interest_component: computeFDInterest({ ...fdParams(100000, MATURITY, NEXT_MATURITY), interest_rate_pa: 6.5 }),
    });
  });
});

describe("refreshFDScheduleFigures", () => {
  const FUTURE_START = TODAY;
  const FUTURE_MATURITY = addMonthsClamped(TODAY, 12);

  it("recomputes an upcoming FD's interest with the current maths", async () => {
    seed({ mode: "none", start: FUTURE_START, maturity: FUTURE_MATURITY, interest: 1234 });
    expect(await refreshFDScheduleFigures("u1")).toBe(1);
    expect(entries()[0].interest_component).toBe(computeFDInterest(fdParams(100000, FUTURE_START, FUTURE_MATURITY)));
    expect(await refreshFDScheduleFigures("u1")).toBe(0);
  });

  it("leaves an FD with a manual correction alone", async () => {
    seed({ mode: "none", start: FUTURE_START, maturity: FUTURE_MATURITY, interest: 1234, override: 101500 });
    expect(await refreshFDScheduleFigures("u1")).toBe(0);
    expect(entries()[0].interest_component).toBe(1234);
  });

  it("leaves an entry already linked to a payout credit alone", async () => {
    seed({ mode: "none", start: FUTURE_START, maturity: FUTURE_MATURITY, interest: 1234 });
    mockSqlite.exec("UPDATE investment_schedule_entries SET linked_expense_id = 'c1' WHERE id = 'se-1';");
    expect(await refreshFDScheduleFigures("u1")).toBe(0);
  });
});
