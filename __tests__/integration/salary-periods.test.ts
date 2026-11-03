import { DatabaseSync } from "node:sqlite";

/** Salary periods, the check and the plan against the real schema, with made-up numbers. */

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
import { getMyMonth } from "../../services/my-month";
import { createSalaryProfile, getSalaryProfileByFY } from "../../services/salary-profile";
import {
  adoptCreditedSalary,
  creditPeriod,
  dismissSalaryCheck,
  getMonthSalaryState,
  getSalaryChecks,
  getSalaryMonths,
  salaryStatus,
  setCreditSalaryMonth,
  shiftMonth,
  withMonthOverride,
} from "../../services/salary-periods";
import { deriveYearlyPlan } from "../../services/yearly-plan";

const USER = "default_user";
const FY = "2026";
const today = new Date("2026-11-03T10:00:00");

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
function salary(date: string, amount: number, extra: Record<string, unknown> = {}): string {
  const id = `s${++seq}`;
  insert("expenses", { id, user_id: USER, date, amount, status: "approved", nature: "credit", credit_kind: "salary", source: "manual", currency: "INR", account_id: "bank", ...extra });
  return id;
}
const profile = (extra: Record<string, unknown> = {}) =>
  createSalaryProfile({ financial_year: FY, user_id: USER, input_mode: "direct", computed_monthly_in_hand: 85000, salary_credit_day: 30, status: "complete", ...extra } as never);
const at = async (month: string) => (await getSalaryMonths(USER, FY, today)).find((r) => r.month === month)!;

beforeEach(async () => {
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  mockKv.clear();
  insert("users", { id: USER });
  insert("financial_accounts", { id: "bank", user_id: USER, account_type: "savings", bank_name: "Bank", account_identifier: "1111" });
});

describe("which month a credit counts for", () => {
  it("shifts across a year end", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
  it("follows the setting unless the credit says otherwise", () => {
    expect(creditPeriod("2026-10-30", null, 0)).toBe("2026-10");
    expect(creditPeriod("2026-10-30", null, 1)).toBe("2026-11");
    expect(creditPeriod("2026-11-01", null, -1)).toBe("2026-10");
    expect(creditPeriod("2026-10-30", "2026-10", 1)).toBe("2026-10");
  });
  it("the setting moves a credit between months", async () => {
    await profile({ salary_month_offset: 1 });
    salary("2026-10-30", 85000);
    expect((await at("2026-10")).credited).toBe(0);
    expect((await at("2026-11")).credited).toBe(85000);
  });
  it("one credit can be moved on its own, and back", async () => {
    await profile();
    const id = salary("2026-10-31", 85000);
    await setCreditSalaryMonth(id, "2026-11");
    expect((await at("2026-11")).credited).toBe(85000);
    await setCreditSalaryMonth(id, null);
    expect((await at("2026-10")).credited).toBe(85000);
  });
  it("a credit from before the year can belong to it", async () => {
    await profile({ salary_month_offset: 1 });
    salary("2026-03-30", 85000);
    expect((await at("2026-04")).credited).toBe(85000);
  });
});

describe("the check", () => {
  it("small differences are a match", () => {
    expect(salaryStatus(85000, 85100)).toBe("match");
    expect(salaryStatus(85000, 85400)).toBe("match");
    expect(salaryStatus(85000, 85500)).toBe("more");
    expect(salaryStatus(85000, 82500)).toBe("less");
    expect(salaryStatus(1000, 1099)).toBe("match");
  });
  it("calls a month missing only after pay day and a few days' grace", async () => {
    await profile({ salary_credit_day: 1 });
    expect((await at("2026-11")).status).toBe("upcoming");
    expect((await at("2026-10")).status).toBe("missing");
    expect((await at("2027-01")).status).toBe("upcoming");
  });
  it("uses month-wise amounts", async () => {
    const overrides = { 6: "90000" };
    await profile({ monthly_overrides: JSON.stringify(overrides), computed_monthly_in_hand: (85000 * 11 + 90000) / 12 });
    salary("2026-10-30", 90000);
    const r = await at("2026-10");
    expect(r.expected).toBe(90000);
    expect(r.status).toBe("match");
    expect((await at("2026-09")).expected).toBeCloseTo(85000, 2);
  });
  it("lists differences for a month, until dismissed", async () => {
    await profile({ salary_credit_day: 1 });
    salary("2026-10-30", 82500);
    const scope = { month: "2026-10" };
    const [check] = await getSalaryChecks(USER, scope);
    expect(check).toMatchObject({ status: "less", credited: 82500, expected: 85000, adopts: "month" });
    dismissSalaryCheck("2026-10");
    expect(await getSalaryChecks(USER, scope)).toEqual([]);
  });
  it("updating the calculator changes only that month, and the others don't drift", async () => {
    await profile({ salary_credit_day: 1 });
    salary("2026-10-30", 82500);
    const [check] = await getSalaryChecks(USER, { month: "2026-10" });
    await adoptCreditedSalary(USER, FY, check);
    expect((await at("2026-10")).status).toBe("match");
    expect((await at("2026-09")).expected).toBeCloseTo(85000, 2);
    expect((await getSalaryProfileByFY(USER, FY))!.computed_monthly_in_hand).toBeCloseTo((85000 * 11 + 82500) / 12, 2);
  });
  it("repeat updates keep the base month steady", () => {
    let p = { monthly_overrides: null as string | null, computed_monthly_in_hand: 85000 };
    for (const [i, a] of [[0, 80000], [1, 90000], [0, 81000]] as const) {
      const n = withMonthOverride(p, i, a);
      p = { monthly_overrides: JSON.stringify(n.overrides), computed_monthly_in_hand: n.average };
    }
    expect(p.computed_monthly_in_hand * 12).toBeCloseTo(85000 * 10 + 81000 + 90000, 1);
  });
});

describe("before pay day", () => {
  it("says salary is due, with the date and amount, until pay day has properly passed", async () => {
    await profile({ salary_credit_day: 30 });
    expect(await getMonthSalaryState(USER, "2026-11", new Date("2026-11-03T10:00:00"))).toEqual({ state: "due", date: "2026-11-30", amount: 85000 });
    expect(await getMonthSalaryState(USER, "2026-11", new Date("2026-12-02T10:00:00"))).toEqual({ state: "due", date: "2026-11-30", amount: 85000 });
    expect(await getMonthSalaryState(USER, "2026-11", new Date("2026-12-05T10:00:00"))).toEqual({ state: "missing" });
  });
  it("a short month uses its last day", async () => {
    await profile({ salary_credit_day: 30 });
    expect(await getMonthSalaryState(USER, "2027-02", new Date("2027-02-03T10:00:00"))).toMatchObject({ date: "2027-02-28" });
  });
  it("follows the setting: a salary counted for next month arrives this month", async () => {
    await profile({ salary_credit_day: 30, salary_month_offset: 1 });
    expect(await getMonthSalaryState(USER, "2026-11", new Date("2026-10-20T10:00:00"))).toMatchObject({ state: "due", date: "2026-10-30" });
  });
  it("says nothing once it's in, or with no salary to compare", async () => {
    await profile({ salary_credit_day: 30 });
    salary("2026-11-02", 85000);
    expect(await getMonthSalaryState(USER, "2026-11", new Date("2026-11-03T10:00:00"))).toBeNull();
    mockDb.exec("DELETE FROM salary_profiles");
    expect(await getMonthSalaryState(USER, "2026-11", new Date("2026-11-03T10:00:00"))).toBeNull();
  });
});

describe("the yearly plan", () => {
  it("uses what was credited for past months and the plan for the future", async () => {
    await profile({ salary_credit_day: 1 });
    salary("2026-10-30", 82500);
    const plan = await deriveYearlyPlan(USER, FY);
    expect(plan.annual_salary_in_hand).toBe(85000 * 12 - 2500);
    expect(plan.salary_actuals).toMatchObject({ months: 1, difference: -2500 });
  });
  it("a past month with nothing tagged keeps its planned figure", async () => {
    await profile({ salary_credit_day: 1 });
    const plan = await deriveYearlyPlan(USER, FY);
    expect(plan.annual_salary_in_hand).toBe(85000 * 12);
    expect(plan.salary_actuals!.months).toBe(0);
    expect(plan.salary_actuals!.missing).toBeGreaterThan(0);
  });
  it("a bonus received is part of the expected bonus, not on top", async () => {
    await profile({ expected_bonus: 100000 });
    salary("2026-10-15", 60000, { credit_kind: "bonus" });
    expect((await deriveYearlyPlan(USER, FY)).expected_bonus).toBe(100000);
    salary("2026-10-16", 70000, { credit_kind: "bonus" });
    expect((await deriveYearlyPlan(USER, FY)).expected_bonus).toBe(130000);
  });
  it("business income isn't compared", async () => {
    await profile({ income_type: "business" });
    salary("2026-10-30", 1000);
    expect(await getSalaryMonths(USER, FY, today)).toEqual([]);
  });
});

describe("My Month with the setting", () => {
  it("counts salary for the month it belongs to, and says where the rest went", async () => {
    await profile({ salary_month_offset: 1 });
    salary("2026-10-30", 85000);
    const oct = await getMyMonth(USER, "2026-10");
    expect(oct).toMatchObject({ salary: 0, salaryMovedOut: 85000, moneyIn: 0 });
    const nov = await getMyMonth(USER, "2026-11");
    expect(nov).toMatchObject({ salary: 85000, salaryMovedOut: 0, moneyIn: 85000 });
  });
});
