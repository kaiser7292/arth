import { DatabaseSync } from "node:sqlite";

/**
 * My month and dated goals against the real schema (every migration), with made-up numbers. The
 * point of My month is that nothing is counted twice and left over adds up.
 */

let mockDb: DatabaseSync;
const mockAdapter = {
  execAsync: async (sql: string) => { mockDb.exec(sql); },
  runAsync: async (sql: string, ...params: unknown[]) => {
    const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
    const r = mockDb.prepare(sql).run(...(flat as never[]));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) => {
    const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
    return mockDb.prepare(sql).all(...(flat as never[]));
  },
  getFirstAsync: async (sql: string, ...params: unknown[]) => {
    const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
    return mockDb.prepare(sql).get(...(flat as never[])) ?? null;
  },
  withTransactionAsync: async (fn: () => Promise<void>) => {
    mockDb.exec("BEGIN");
    try { await fn(); mockDb.exec("COMMIT"); } catch (e) { mockDb.exec("ROLLBACK"); throw e; }
  },
};

const mockKv = new Map<string, unknown>();
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: (k: string) => mockKv.get(k) as boolean | undefined,
    getNumber: (k: string) => mockKv.get(k) as number | undefined,
    getString: (k: string) => mockKv.get(k) as string | undefined,
    set: (k: string, v: unknown) => void mockKv.set(k, v),
    delete: (k: string) => void mockKv.delete(k),
    contains: (k: string) => mockKv.has(k),
    getAllKeys: () => [...mockKv.keys()],
  })),
}));
jest.mock("../../database", () => ({
  getDatabase: () => mockAdapter,
  initDatabase: async () => mockAdapter,
}));

import { runMigrations } from "../../database/migrations";
import { goalMonthlyNeeded, goalMonths, saveDatedGoal } from "../../services/dated-goal";
import { getLifeMilestones } from "../../services/life-milestone";
import { getMonthAccounts, getMyMonth } from "../../services/my-month";
import { deriveYearlyPlan, getBucketsByFY } from "../../services/yearly-plan";

const USER = "default_user";
const MONTH = "2026-10";

function insert(table: string, values: Record<string, unknown>) {
  const cols = mockDb.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[];
  const row: Record<string, unknown> = { ...values };
  for (const c of cols) {
    if (c.notnull && c.dflt_value == null && !c.pk && !(c.name in row)) row[c.name] = c.type.toUpperCase().includes("INT") || c.type.toUpperCase() === "REAL" ? 0 : "x";
  }
  const keys = Object.keys(row);
  mockDb.exec("PRAGMA foreign_keys = OFF");
  mockDb.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...(keys.map((k) => row[k]) as never[]));
  mockDb.exec("PRAGMA foreign_keys = ON");
}

let seq = 0;
function tx(values: Record<string, unknown>): string {
  const id = `e${++seq}`;
  insert("expenses", { id, user_id: USER, date: "2026-10-15", status: "approved", nature: "realized", source: "manual", currency: "INR", ...values });
  return id;
}

beforeEach(async () => {
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  mockKv.clear();
  insert("users", { id: USER });
  insert("financial_accounts", { id: "bank", user_id: USER, account_type: "savings", bank_name: "Bank", account_identifier: "1111" });
  insert("financial_accounts", { id: "card", user_id: USER, account_type: "credit_card", bank_name: "Bank", account_identifier: "2222" });
  insert("financial_accounts", { id: "demat", user_id: USER, account_type: "demat", bank_name: "Broker", account_identifier: "3333" });
  insert("categories", { id: "food", user_id: USER, name: "Food" });
  insert("categories", { id: "rent", user_id: USER, name: "Rent" });
});

describe("getMyMonth", () => {
  it("adds up: money in, minus spent, minus saved", async () => {
    tx({ nature: "credit", credit_kind: "salary", amount: 85000, account_id: "bank" });
    tx({ nature: "credit", credit_kind: "interest", amount: 3000, account_id: "bank" });
    tx({ amount: 18000, category_id: "rent" });
    tx({ amount: 6000, category_id: "food" });
    tx({ amount: 20000, money_event: "fd_open" });
    tx({ amount: 5000, money_event: "sip" });
    const m = await getMyMonth(USER, MONTH);
    expect(m).toMatchObject({ salary: 85000, otherIncome: 3000, moneyIn: 88000, spent: 24000, savedTotal: 25000, leftOver: 39000 });
    expect(m.categories.map((c) => c.name)).toEqual(["Rent", "Food"]);
    expect(m.saved).toEqual([{ label: "Fixed deposits", amount: 20000 }, { label: "SIPs", amount: 5000 }]);
  });

  it("refunds, own transfers and card payments aren't money in", async () => {
    tx({ nature: "credit", credit_kind: "salary", amount: 1000, account_id: "bank" });
    tx({ nature: "credit", credit_kind: "refund", amount: 200, account_id: "bank" });
    tx({ nature: "credit", amount: 300, account_id: "bank", money_event: "self_transfer" });
    tx({ nature: "credit", amount: 400, account_id: "bank", money_event: "fd_closure" });
    tx({ nature: "credit", amount: 500, account_id: "card" });
    expect((await getMyMonth(USER, MONTH)).moneyIn).toBe(1000);
  });

  it("a refund lowers what was spent", async () => {
    const shoes = tx({ amount: 1000, category_id: "food" });
    tx({ nature: "credit", amount: 400, account_id: "bank", refund_of_expense_id: shoes });
    expect((await getMyMonth(USER, MONTH)).spent).toBe(600);
  });

  it("an investment is saved, not spent, and counts once", async () => {
    const sip = tx({ amount: 5000, money_event: "sip" });
    insert("investment_buckets", { id: "b1", user_id: USER, name: "Index", annual_target: 60000 });
    insert("expense_investment_links", { id: "l1", expense_id: sip, investment_bucket_id: "b1", contribution_amount: 5000 });
    insert("account_transfers", { id: "t1", from_account_id: "bank", to_account_id: "demat", amount: 2000, date: "2026-10-10", user_id: USER });
    const m = await getMyMonth(USER, MONTH);
    expect(m.spent).toBe(0);
    expect(m.savedTotal).toBe(7000);
    expect(m.saved.map((s) => s.label)).toEqual(["Linked to goals", "Moved to investment accounts"]);
  });

  it("a transfer between own accounts isn't spent", async () => {
    tx({ amount: 900, money_event: "self_transfer" });
    expect((await getMyMonth(USER, MONTH)).spent).toBe(0);
  });

  it("only this month, and pending rows are counted as waiting, not in the totals", async () => {
    tx({ amount: 100, date: "2026-09-30" });
    tx({ amount: 100, date: "2026-11-01" });
    tx({ amount: 50, status: "pending_review" });
    const m = await getMyMonth(USER, MONTH);
    expect(m.spent).toBe(0);
    expect(m.waitingForReview).toBe(1);
  });

  it("spending more than came in goes negative", async () => {
    tx({ amount: 500, category_id: "food" });
    expect((await getMyMonth(USER, MONTH)).leftOver).toBe(-500);
  });
});

describe("after the budget", () => {
  const budget = (category: string, amount: number) => insert("budgets", { id: `b-${category}`, user_id: USER, category_id: category, month: MONTH, amount });

  it("has nothing to say without a budget", async () => {
    tx({ nature: "credit", credit_kind: "salary", amount: 1000, account_id: "bank" });
    expect((await getMyMonth(USER, MONTH)).afterBudget).toBeNull();
  });

  it("holds back the whole budget even if little is spent so far, and takes off what's saved", async () => {
    tx({ nature: "credit", credit_kind: "salary", amount: 80000, account_id: "bank" });
    budget("rent", 20000);
    budget("food", 10000);
    tx({ amount: 2000, category_id: "food" });
    tx({ amount: 5000, money_event: "sip" });
    expect((await getMyMonth(USER, MONTH)).afterBudget).toEqual({ setAside: 30000, free: 45000 });
  });

  it("overspending and spending with no budget aren't free", async () => {
    tx({ nature: "credit", credit_kind: "salary", amount: 80000, account_id: "bank" });
    budget("food", 10000);
    tx({ amount: 12000, category_id: "food" });
    tx({ amount: 3000, category_id: "rent" });
    tx({ amount: 1000 });
    expect((await getMyMonth(USER, MONTH)).afterBudget).toEqual({ setAside: 16000, free: 64000 });
  });
});

describe("getMonthAccounts", () => {
  it("lists banks and wallets with their balance at month end, not cards or demat", async () => {
    tx({ nature: "credit", amount: 1000, account_id: "bank" });
    tx({ amount: 300, account_id: "bank" });
    tx({ amount: 999, account_id: "bank", date: "2026-11-05" });
    const rows = await getMonthAccounts(USER, MONTH);
    expect(rows.map((r) => r.id)).toEqual(["bank"]);
    expect(rows[0].balance).toBe(700);
  });
});

describe("dated goals", () => {
  const today = new Date("2026-11-03T10:00:00");
  const goal = { userId: USER, name: "Europe trip", total: 300000, targetDate: "2028-03-31", financialYear: "2026", fyStartMonth: 4, today };

  it("works out the months, this month and the target month included", () => {
    expect(goalMonths("2028-03-31", today)).toBe(17);
    expect(goalMonths("2026-11-30", today)).toBe(1);
    expect(goalMonths("2026-10-31", today)).toBe(0);
  });

  it("works out the monthly amount, less what's saved, and refuses a past date", () => {
    expect(goalMonthlyNeeded(170000, 0, "2028-03-31", today)).toBe(10000);
    expect(goalMonthlyNeeded(170000, 85000, "2028-03-31", today)).toBe(5000);
    expect(goalMonthlyNeeded(100, 200, "2028-03-31", today)).toBe(0);
    expect(goalMonthlyNeeded(100, 0, "2026-10-31", today)).toBeNull();
  });

  it("saves the total and date on a milestone linked to the bucket", async () => {
    await saveDatedGoal(goal);
    const [milestone] = await getLifeMilestones(USER);
    const [bucket] = await getBucketsByFY(USER, "2026");
    expect(milestone).toMatchObject({ name: "Europe trip", target_amount: 300000, target_date: "2028-03-31" });
    expect(bucket).toMatchObject({ name: "Europe trip", linked_milestone_id: milestone.id });
    expect(bucket.annual_target).toBeCloseTo((300000 / 17) * 12, 1);
  });

  it("isn't counted twice in the yearly plan", async () => {
    await saveDatedGoal(goal);
    const plan = await deriveYearlyPlan(USER, "2026");
    expect(plan?.total_planned_milestones).toBe(0);
    expect(plan?.total_planned_investments).toBeCloseTo((300000 / 17) * 12, 0);
  });

  it("a goal due within a year plans its whole total this year", async () => {
    await saveDatedGoal({ ...goal, targetDate: "2027-02-28" });
    const [bucket] = await getBucketsByFY(USER, "2026");
    expect(bucket.annual_target).toBe(300000);
  });

  it("editing changes the same milestone and bucket", async () => {
    await saveDatedGoal(goal);
    const [milestone] = await getLifeMilestones(USER);
    const [bucket] = await getBucketsByFY(USER, "2026");
    await saveDatedGoal({ ...goal, total: 170000, bucketId: bucket.id, milestoneId: milestone.id });
    expect(await getLifeMilestones(USER)).toHaveLength(1);
    const buckets = await getBucketsByFY(USER, "2026");
    expect(buckets).toHaveLength(1);
    expect(buckets[0].annual_target).toBe(120000);
  });
});
