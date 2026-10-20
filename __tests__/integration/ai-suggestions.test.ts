import { DatabaseSync } from "node:sqlite";

/**
 * AI Suggestions against the REAL schema: the export asks, a hand-written reply answers, Arth
 * reads it, and the ticked items are applied.
 *
 *   - reading is forgiving: prose, code fences, curly quotes, trailing commas, a cut-off reply
 *   - accepting is strict: invented references, unknown categories, patterns and unknown kinds
 *     of change are all refused, with a reason
 *   - nothing changes on read; applying does what the manual screens would
 */

let mockDb: DatabaseSync;
const mockFlat = (params: unknown[]) =>
  (params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params) as never[];
const mockAdapter = {
  execAsync: async (sql: string) => {
    mockDb.exec(sql);
  },
  runAsync: async (sql: string, ...params: unknown[]) => {
    const r = mockDb.prepare(sql).run(...mockFlat(params));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).all(...mockFlat(params)),
  getFirstAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).get(...mockFlat(params)) ?? null,
  withTransactionAsync: async (fn: () => Promise<void>) => fn(),
};

jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: () => undefined,
    getNumber: () => undefined,
    getString: () => undefined,
    set: () => {},
    delete: () => {},
    getAllKeys: () => [],
    addOnValueChangedListener: () => ({ remove: () => {} }),
  })),
}));
jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));

import { runMigrations } from "../../database/migrations";
import { buildAiExport, DEFAULT_AI_EXPORT_SECTIONS } from "../../services/ai-export";
import { buildReplyInstructions, shortRef } from "../../services/ai-reply-format";
import {
  applySuggestions,
  DELIBERATE_TYPES,
  findSuggestionObjects,
  readAiReply,
  SUGGESTION_GROUPS,
} from "../../services/ai-suggestions";

const USER = "default-user";
const TODAY = new Date(2026, 9, 10);
const NL = String.fromCharCode(10);

function insert(table: string, values: Record<string, unknown>) {
  const cols = mockDb.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string; type: string; notnull: number; dflt_value: unknown;
  }[];
  const row: Record<string, unknown> = { ...values };
  for (const c of cols) {
    if (c.name in row || !c.notnull || c.dflt_value != null) continue;
    row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : `x-${table}-${c.name}`;
  }
  const names = Object.keys(row);
  mockDb
    .prepare(`INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`)
    .run(...(Object.values(row) as never[]));
}

const expense = (id: string, over: Record<string, unknown>) =>
  insert("expenses", {
    id, user_id: USER, amount: 100, date: "2026-09-10", nature: "realized", status: "approved", source: "manual", ...over,
  });

const one = <T,>(sql: string, ...params: unknown[]) => mockDb.prepare(sql).get(...(params as never[])) as T;
const reply = (...items: object[]) => JSON.stringify({ arth_suggestions: 1, suggestions: items });

// 8-hex ids so shortRef has something to shorten.
const E = {
  swiggy1: "aaaaaaaa-0000-4000-8000-000000000001",
  swiggy2: "bbbbbbbb-0000-4000-8000-000000000002",
  swiggyPending: "cccccccc-0000-4000-8000-000000000003",
  amzn: "dddddddd-0000-4000-8000-000000000004",
  gift: "eeeeeeee-0000-4000-8000-000000000005",
};
const SMS = { kotak1: "11111111-0000-4000-8000-00000000000a", kotak2: "22222222-0000-4000-8000-00000000000b", otp: "33333333-0000-4000-8000-00000000000c" };

function seed() {
  mockDb.exec(`
    DELETE FROM expenses; DELETE FROM categories; DELETE FROM merchant_mappings; DELETE FROM merchant_corrections;
    DELETE FROM merchant_aliases; DELETE FROM smart_rules; DELETE FROM budgets; DELETE FROM pending_sms;
    DELETE FROM sms_template_patterns; DELETE FROM financial_accounts; DELETE FROM vault_entries;
  `);
  insert("categories", { id: "cat-other", user_id: USER, name: "Other", is_active: 1 });
  insert("categories", { id: "cat-food", user_id: USER, name: "Food", is_active: 1 });
  insert("categories", { id: "cat-shop", user_id: USER, name: "Shopping", is_active: 1 });
  insert("financial_accounts", {
    id: "acc-1", user_id: USER, bank_name: "HDFC", account_type: "savings", account_identifier: "4521",
    account_label: null, is_active: 1,
  });
  expense(E.swiggy1, { amount: 482, date: "2026-09-14", merchant_name: "Swiggy", category_id: "cat-other" });
  expense(E.swiggy2, { amount: 310, date: "2026-09-20", merchant_name: "Swiggy", category_id: "cat-other" });
  expense(E.swiggyPending, { amount: 250, date: "2026-10-02", merchant_name: "Swiggy", category_id: null, status: "pending_review" });
  expense(E.amzn, { amount: 1999, date: "2026-09-18", merchant_name: "AMZN MKTP IN", category_id: "cat-other" });
  expense(E.gift, { amount: 700, date: "2026-09-25", merchant_name: "Swiggy", category_id: "cat-other" });

  const now = Date.now();
  insert("pending_sms", {
    id: SMS.kotak1, sms_id: "k1", user_id: USER, address: "VM-KOTAKB-S", status: "failed", expense_id: null, sms_date: now - 1000,
    body: "Sent Rs.482.00 from Kotak Bank AC X4521 to SWIGGY on 14-09-26. UPI Ref 426718890123.",
  });
  insert("pending_sms", {
    id: SMS.kotak2, sms_id: "k2", user_id: USER, address: "VM-KOTAKB-S", status: "failed", expense_id: null, sms_date: now - 2000,
    body: "Sent Rs.1250.00 from Kotak Bank AC X4521 to UBER on 15-09-26. UPI Ref 426718890999.",
  });
  insert("pending_sms", {
    id: SMS.otp, sms_id: "k3", user_id: USER, address: "VM-KOTAKB-S", status: "failed", expense_id: null, sms_date: now - 3000,
    body: "LEAK_OTP 991122 is your OTP for a transaction of Rs.500. Do not share it.",
  });
  insert("vault_entries", {
    id: "v-1", title: "LEAK_VAULT_TITLE", category: "banking", login_method: "password", username: "LEAK_VAULT_USER",
  });
}

beforeAll(async () => {
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  mockDb.exec("PRAGMA foreign_keys = OFF; PRAGMA ignore_check_constraints = ON;");
});
beforeEach(seed);

describe("finding the suggestions in a pasted reply", () => {
  const item = '{"type":"add_category","name":"Pets","why":"x"}';

  it("reads a reply wrapped in prose and a code fence", () => {
    const pasted = ["Here you go:", "```json", `{"arth_suggestions":1,"suggestions":[${item}]}`, "```", "Let me know!"].join(NL);
    expect(findSuggestionObjects(pasted)).toEqual({ objects: [item], recognised: true, cutOff: false });
  });

  it("survives curly quotes, trailing commas and braces inside text", () => {
    const pasted = `{“arth_suggestions”:1,“suggestions”:[{“type”:“add_category”,“name”:“A {b} c”,},]}`;
    const { objects } = findSuggestionObjects(pasted);
    expect(objects).toHaveLength(1);
  });

  it("keeps the whole items of a reply that was cut off", () => {
    const pasted = `{"arth_suggestions":1,"suggestions":[${item},${NL}{"type":"set_budget","category":"Fo`;
    expect(findSuggestionObjects(pasted)).toEqual({ objects: [item], recognised: true, cutOff: true });
  });

  it("accepts a bare list, and refuses text that isn't a reply", () => {
    expect(findSuggestionObjects(`[${item}]`).objects).toEqual([item]);
    expect(findSuggestionObjects("Sure! Your spending looks fine {no changes}.").recognised).toBe(false);
  });
});

describe("the export asks for suggestions", () => {
  const opts = (suggest: object) => ({
    from: "2026-04-01", to: "2026-10-10", sections: DEFAULT_AI_EXPORT_SECTIONS,
    hidePeopleNames: true, hideMerchantNames: false, suggest: suggest as never,
  });

  it("adds the request, reply format, references and lists", async () => {
    const { data } = await buildAiExport(USER, opts({ request: "tidy" }), TODAY);
    expect(Object.keys(data).slice(0, 3)).toEqual(["guide", "request", "reply_instructions"]);
    expect((data.reply_instructions as string[]).join(" ")).toContain('"type":"merchant_category"');
    expect(data.categories).toEqual(expect.arrayContaining(["Other", "Food", "Shopping"]));
    expect((data.merchants as { merchant: string }[])[0]).toEqual({ merchant: "Swiggy", entries: 3, amount: 1492, category: "Other" });
    const txns = data.transactions as { ref: string }[];
    expect(txns).toHaveLength(4); // the unreviewed one stays out
    expect(txns[0].ref).toBe(shortRef("t", E.swiggy1));
    expect(data.unread_messages).toBeUndefined();
  });

  it("setup adds unreviewed entries and unread messages, never one-time codes or the vault", async () => {
    const { data, counts } = await buildAiExport(
      USER,
      opts({ request: "setup", includeUnreviewed: true, includeUnreadMessages: true }),
      TODAY,
    );
    const txns = data.transactions as { reviewed: boolean }[];
    expect(txns.filter((t) => !t.reviewed)).toHaveLength(1);
    expect(counts.unreadMessages).toBe(2);
    expect((data.unread_messages as { id: string; similar: number }[])[0]).toMatchObject({
      id: shortRef("s", SMS.kotak1), sender: "VM-KOTAKB-S", similar: 2,
    });
    expect((data.reply_instructions as string[]).join(" ")).toContain('"type":"sms_template"');
    expect(JSON.stringify(data)).not.toContain("LEAK_");
  });
});

describe("the instructions given to the assistant", () => {
  it("every example in them is something Arth reads as that kind of change", () => {
    const lines = buildReplyInstructions({ unreadMessages: true, unreviewed: true, fullSetup: true });
    const examples = lines
      .map((line) => /^(\w+) - .*?(\{"type":.*\})$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null);
    // one example per kind of change Arth accepts
    expect(examples.map((m) => m[1]).sort()).toEqual(SUGGESTION_GROUPS.map((g) => g.type).sort());
    for (const [, type, example] of examples) {
      const { objects } = findSuggestionObjects(`{"arth_suggestions":1,"suggestions":[${example}]}`);
      expect(objects).toEqual([example]);
      expect(JSON.parse(example).type).toBe(type);
    }
  });
});

describe("reading a reply", () => {
  it("accepts what is real and explains what is not", async () => {
    const ref = shortRef("t", E.gift);
    const pasted = reply(
      { type: "add_category", name: "Gifts", why: "One gift order" },
      { type: "add_category", name: "food", why: "exists" },
      { type: "merchant_category", merchant: "swiggy", category: "Food", why: "Food delivery" },
      { type: "merchant_category", merchant: "zomato", category: "Food", why: "not a merchant here" },
      { type: "recategorize", ref, date: "2026-09-25", amount: "700", category: "Gifts", why: "A gift" },
      { type: "recategorise", ref, date: "2026-09-25", amount: 999, category: "Food", why: "wrong amount" },
      { type: "recategorise", ref: "tdeadbeef", date: "2026-09-25", amount: 700, category: "Food", why: "invented" },
      { type: "set_budget", category: "Travel", amount: 5000, why: "no such category" },
      { type: "set_budget", category: "Food", amount: "12,000", why: "Average is 11,300" },
      { type: "add_rule", name: "Pattern", when: [{ field: "merchant", is: "regex", value: ".*" }], category: "Food", why: "x" },
      { type: "add_rule", name: "Big Amazon", when: [{ field: "merchant", is: "contains", value: "amazon" }, { field: "amount", is: "greater_than", value: 10000 }], category: "Shopping", why: "Gadgets" },
      { type: "fix_merchant", from: "amzn mktp in", to: "Amazon", why: "Same shop" },
      { type: "delete_transaction", ref, why: "nope" },
    );
    const before = one<{ n: number }>("SELECT COUNT(*) as n FROM categories").n;
    const result = await readAiReply(USER, pasted, TODAY);

    expect(result.accepted.map((s) => `${s.type}: ${s.title}`)).toEqual([
      "add_category: Gifts",
      "fix_merchant: AMZN MKTP IN → Amazon",
      "merchant_category: swiggy → Food",
      "recategorise: Swiggy · ₹700 · 2026-09-25",
      "add_rule: Big Amazon",
      "set_budget: Food · ₹12,000 a month",
    ]);
    expect(result.accepted[2].detail).toBe("Moves 4 past entries, and files future ones");
    expect(result.alreadySet).toBe(1);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      'None of your merchants contain "zomato"',
      "Names a transaction that doesn't match any of yours",
      "Names a transaction that doesn't match any of yours",
      "Rules from an assistant can't use patterns",
      '"Travel" is not one of your categories',
      "Is not a kind of change Arth accepts",
    ]);
    // reading changed nothing
    expect(one<{ n: number }>("SELECT COUNT(*) as n FROM categories").n).toBe(before);
  });

  it("says so when the text is not a reply at all", async () => {
    const result = await readAiReply(USER, "Your spending looks healthy this month.", TODAY);
    expect(result).toMatchObject({ recognised: false, accepted: [] });
  });
});

describe("a full setup: income, savings target, buckets and goals", () => {
  const full = (request: string) => ({
    from: "2026-04-01", to: "2026-10-10", sections: DEFAULT_AI_EXPORT_SECTIONS,
    hidePeopleNames: true, hideMerchantNames: false, suggest: { request } as never,
  });

  it("the file tells the assistant not to ask questions, and says what is already set", async () => {
    const { data } = await buildAiExport(USER, full("everything"), TODAY);
    const instructions = data.reply_instructions as string[];
    expect(instructions[0]).toMatch(/^DO NOT ASK QUESTIONS/);
    expect(instructions.join(" ")).toContain('"type":"set_income"');
    expect(instructions.join(" ")).toContain("Never choose a savings target, an investment or a goal for the user");
    expect(data.current_setup).toMatchObject({
      financial_year: "FY 2026-27", monthly_income: null, pay_day: null, expected_bonus: 0, savings_target_pct: 0,
      monthly_budgets: [], investment_buckets: [], goals: [], merchant_rules: [], smart_rules: [], message_templates: [],
      accounts_set_up: [{ bank: "HDFC", type: "savings", last4: "4521" }],
    });
    expect((data.guide as string[]).join(" ")).toContain("do not suggest anything that already exists");

    // a single job doesn't ask for the plan-level settings, but still sees what's already set up
    const { data: tidy } = await buildAiExport(USER, full("tidy"), TODAY);
    expect((tidy.reply_instructions as string[]).join(" ")).not.toContain("set_income");
    expect(tidy.current_setup).toMatchObject({ accounts_set_up: [{ bank: "HDFC" }] });
  });

  it("reads and applies them, and refuses what makes no sense", async () => {
    mockDb.exec("DELETE FROM salary_profiles; DELETE FROM yearly_plans; DELETE FROM investment_buckets; DELETE FROM life_milestones;");
    const pasted = reply(
      { type: "set_income", monthly: 142500, pay_day: 1, bonus: "50,000", months: { "2026-12": 200000, "2025-01": 1 }, why: "Salary on the 1st" },
      { type: "set_savings_target", percent: 30, why: "You said 30 percent" },
      { type: "set_savings_target", percent: 150, why: "nonsense" },
      { type: "add_investment_bucket", name: "Mutual funds", annual_target: 120000, why: "10000 a month" },
      { type: "add_milestone", name: "House down payment", target_amount: 1500000, target_date: "2029-03-31", why: "15 lakh by March 2029" },
      { type: "add_goal", name: "Old trip", target_amount: 50000, target_date: "2024-01-01", why: "in the past" },
    );
    const result = await readAiReply(USER, pasted, TODAY);
    expect(result.accepted.map((s) => `${s.title} | ${s.detail}`)).toEqual([
      "Take-home pay · ₹1,42,500 a month | Not set yet · arrives on day 1 · bonus ₹50,000 · 1 month differs",
      "Save 30% of income | Not set yet",
      "Mutual funds · ₹1,20,000 this year | About ₹10,000 a month",
      "House down payment · ₹15,00,000 by 2029-03-31 | About ₹51,724 a month for 29 months",
    ]);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      "The savings target must be between 1 and 90 percent",
      "The goal needs a date in the future",
    ]);
    // every one of these is a deliberate yes
    expect(result.accepted.every((s) => DELIBERATE_TYPES.has(s.type))).toBe(true);

    const applied = await applySuggestions(USER, result.accepted, TODAY);
    expect(applied.failed).toEqual([]);
    expect(applied.applied).toEqual({ set_income: 1, set_savings_target: 1, add_investment_bucket: 1, add_milestone: 1 });

    // 11 months at 142,500 and December at 200,000, stored the way the Income Calculator stores it
    expect(one("SELECT input_mode, computed_monthly_in_hand, monthly_overrides, expected_bonus, salary_credit_day, financial_year FROM salary_profiles")).toEqual({
      input_mode: "direct", computed_monthly_in_hand: expect.closeTo(147291.67, 2), monthly_overrides: '{"8":"200000"}',
      expected_bonus: 50000, salary_credit_day: 1, financial_year: "2026",
    });
    expect(one("SELECT savings_rate_target_pct, annual_salary_in_hand, expected_bonus, total_planned_investments FROM yearly_plans WHERE financial_year = '2026'")).toEqual({
      savings_rate_target_pct: 30, annual_salary_in_hand: expect.closeTo(1767500, 2), expected_bonus: 50000,
      total_planned_investments: 120000,
    });
    expect(one("SELECT name, annual_target, financial_year FROM investment_buckets")).toEqual({
      name: "Mutual funds", annual_target: 120000, financial_year: "2026",
    });
    expect(one("SELECT name, target_amount, target_date, duration_years, duration_months FROM life_milestones")).toEqual({
      name: "House down payment", target_amount: 1500000, target_date: "2029-03-31", duration_years: 2, duration_months: 5,
    });

    // the same reply again changes nothing
    const again = await readAiReply(USER, pasted, TODAY);
    expect(again.accepted).toEqual([]);
    expect(again.alreadySet).toBe(4);

    // a raise shows as a change from what is set now
    const raise = await readAiReply(USER, reply({ type: "set_income", monthly: 150000, pay_day: 1, bonus: 50000, months: {}, why: "x" }), TODAY);
    expect(raise.accepted[0].detail).toBe("Now ₹1,42,500 a month · arrives on day 1 · bonus ₹50,000");
  });
});

describe("applying", () => {
  it("categories, merchant names, merchant categories, exceptions, rules, budgets", async () => {
    const pasted = reply(
      { type: "add_category", name: "Gifts", why: "x" },
      { type: "fix_merchant", from: "AMZN MKTP IN", to: "Amazon", why: "x" },
      { type: "merchant_category", merchant: "swiggy", category: "Food", why: "x" },
      { type: "merchant_category", merchant: "amazon", category: "Shopping", why: "x" },
      { type: "recategorise", ref: shortRef("t", E.gift), date: "2026-09-25", amount: 700, category: "Gifts", why: "x" },
      { type: "add_rule", name: "Big Amazon", when: [{ field: "amount", is: "greater_than", value: 10000 }], category: "Shopping", why: "x" },
      { type: "set_budget", category: "Food", amount: 12000, why: "x" },
    );
    const { accepted, rejected } = await readAiReply(USER, pasted, TODAY);
    expect(rejected).toEqual([]);
    const result = await applySuggestions(USER, accepted, TODAY);
    expect(result.failed).toEqual([]);
    expect(result.applied).toEqual({
      add_category: 1, fix_merchant: 1, merchant_category: 2, recategorise: 1, add_rule: 1, set_budget: 1,
    });

    const cat = (id: string) =>
      one<{ name: string | null }>("SELECT c.name FROM expenses e LEFT JOIN categories c ON c.id = e.category_id WHERE e.id = ?", id).name;
    expect(cat(E.swiggy1)).toBe("Food");
    expect(cat(E.swiggyPending)).toBe("Food"); // the one still waiting for review is filed too
    expect(cat(E.gift)).toBe("Gifts"); // the exception wins over its merchant's category
    expect(cat(E.amzn)).toBe("Shopping"); // renamed first, so "amazon" catches it
    expect(one<{ merchant_name: string }>("SELECT merchant_name FROM expenses WHERE id = ?", E.amzn).merchant_name).toBe("Amazon");
    expect(one<{ n: number }>("SELECT COUNT(*) as n FROM smart_rules WHERE name = 'Big Amazon'").n).toBe(1);
    // Oct 2026 to Mar 2027
    expect(one<{ n: number }>("SELECT COUNT(*) as n FROM budgets WHERE amount = 12000").n).toBe(6);

    // asking again finds nothing left to do for the merchant
    const again = await readAiReply(USER, reply({ type: "merchant_category", merchant: "amazon", category: "Shopping", why: "x" }), TODAY);
    expect(again).toMatchObject({ accepted: [], alreadySet: 1 });
  });

  it("a missing transaction waits in the review queue", async () => {
    const pasted = reply({
      type: "add_transaction", date: "2026-09-05", amount: 15000, kind: "spend", category: "Other",
      merchant: "Landlord", account: "hdfc", why: "Paid every month",
    });
    const { accepted } = await readAiReply(USER, pasted, TODAY);
    await applySuggestions(USER, accepted, TODAY);
    expect(one("SELECT status, account_id, amount, description FROM expenses WHERE merchant_name = 'Landlord'")).toEqual({
      status: "pending_review", account_id: "acc-1", amount: 15000, description: "AI suggested: Paid every month",
    });

    const future = await readAiReply(USER, reply({ type: "add_transaction", date: "2026-12-01", amount: 5, kind: "spend" }), TODAY);
    expect(future.rejected[0].reason).toBe("The date is missing, wrong or in the future");
  });

  it("builds an SMS template from quoted parts and tests it on the unread messages", async () => {
    const good = {
      type: "sms_template", sms: shortRef("s", SMS.kotak1), bank: "Kotak", kind: "debit",
      fields: { amount: "482.00", account: "4521", merchant: "SWIGGY", date: "14-09-26", ref: "426718890123" },
      why: "Kotak UPI debit",
    };
    const result = await readAiReply(
      USER,
      reply(
        good,
        { ...good, fields: { amount: "999.99" } },
        { ...good, sms: "s00000000" },
      ),
      TODAY,
    );
    expect(result.rejected.map((r) => r.reason)).toEqual([
      "The amount it quotes isn't in the message",
      "Names a bank message that isn't one of your unread ones",
    ]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]).toMatchObject({ type: "sms_template", title: "Kotak debit", reads: 2 });

    // applying saves the template and sends what it reads to the review queue
    const applied = await applySuggestions(USER, result.accepted, TODAY);
    expect(applied).toMatchObject({ applied: { sms_template: 1 }, readFromMessages: 2, failed: [] });
    expect(
      mockDb.prepare("SELECT e.amount, e.date, e.status FROM expenses e JOIN pending_sms p ON p.expense_id = e.id ORDER BY e.amount").all(),
    ).toEqual([
      { amount: 482, date: "2026-09-14", status: "pending_review" },
      { amount: 1250, date: "2026-09-15", status: "pending_review" },
    ]);
  });

  it("forgives an assistant that quotes a little too much, and tells two formats apart", async () => {
    const result = await readAiReply(
      USER,
      reply(
        {
          type: "sms_template", sms: shortRef("s", SMS.kotak1), bank: "Kotak", kind: "debit",
          fields: { amount: "Rs.482.00", account: "X4521", merchant: "SWIGGY" }, why: "x",
        },
        // the second example of the same format is the same template, not a second one
        {
          type: "sms_template", sms: shortRef("s", SMS.kotak2), bank: "Kotak", kind: "debit",
          fields: { amount: "1250.00", account: "4521", merchant: "UBER" }, why: "x",
        },
        // a one-time code message is never a transaction
        { type: "sms_template", sms: shortRef("s", SMS.otp), bank: "Kotak", kind: "debit", fields: { amount: "500" }, why: "x" },
      ),
      TODAY,
    );
    expect(result.rejected.map((r) => r.reason)).toEqual(["Would read almost any message, so it was left out"]);
    expect(result.accepted.map((s) => s.title)).toEqual(["Kotak debit"]);
  });

  it("counts what a merchant category will really move", async () => {
    expense("ffffffff-0000-4000-8000-000000000006", { amount: 99, merchant_name: "Swiggy Instamart", category_id: null });
    const result = await readAiReply(
      USER,
      reply(
        { type: "add_category", name: "Delivery", why: "x" },
        // a new category: nothing can be in it yet, so every Swiggy entry moves
        { type: "merchant_category", merchant: "swiggy", category: "Delivery", why: "x" },
        // ...except Instamart, which this same reply files elsewhere
        { type: "merchant_category", merchant: "swiggy instamart", category: "Shopping", why: "x" },
      ),
      TODAY,
    );
    expect(result.accepted.map((s) => `${s.title}: ${s.detail}`)).toEqual([
      "Delivery: null",
      "swiggy → Delivery: Moves 4 past entries, and files future ones",
      "swiggy instamart → Shopping: Moves 1 past entry, and files future ones",
    ]);
    const applied = await applySuggestions(USER, result.accepted, TODAY);
    expect(applied.entriesMoved).toBe(5); // each entry moved once
  });
});
