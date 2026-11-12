import { DatabaseSync } from "node:sqlite";

/**
 * Fix my data against the REAL schema (docs/AI_CORRECTIONS_DESIGN.md): health finds what's wrong,
 * a hand-written correction file is read (strictly) and applied through the app's own services,
 * and the data ends up the way the screens would have left it. Made-up values.
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
// Files the export writes, kept in memory.
const mockWritten = new Map<string, string>();
jest.mock("expo-file-system", () => ({
  Paths: { cache: "cache", document: "document" },
  File: class {
    name: string;
    constructor(_dir: string, name: string) {
      this.name = name;
    }
    get exists() {
      return mockWritten.has(this.name);
    }
    get uri() {
      return `file://${this.name}`;
    }
    get size() {
      return (mockWritten.get(this.name) ?? "").length;
    }
    delete() {
      mockWritten.delete(this.name);
    }
    write(text: string) {
      mockWritten.set(this.name, text);
    }
  },
}));
jest.mock("expo-clipboard", () => ({ setStringAsync: async () => true }));
jest.mock("expo-sharing", () => ({ isAvailableAsync: async () => false }));
// The undo snapshot writes a file; backup restore has its own tests.
const mockSnapshot = jest.fn(async () => {});
jest.mock("../../services/corrections/snapshot", () => ({
  takeSnapshot: () => mockSnapshot(),
  recordApplied: () => {},
}));

import { runMigrations } from "../../database/migrations";
import { shortRef } from "../../services/ai-reply-format";
import { applyCorrections } from "../../services/corrections/apply";
import { getHealthReport, merchantKey } from "../../services/corrections/health";
import { accountFixRef, findCorrectionObjects, readCorrections } from "../../services/corrections/read";

const USER = "default-user";

function insert(table: string, values: Record<string, unknown>) {
  const cols = mockDb.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number; dflt_value: unknown }[];
  const row: Record<string, unknown> = { ...values };
  for (const c of cols) {
    if (c.name in row || !c.notnull || c.dflt_value != null) continue;
    row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : `x-${table}-${c.name}`;
  }
  const names = Object.keys(row);
  mockDb.prepare(`INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...(Object.values(row) as never[]));
}
const one = <T,>(sql: string, ...params: unknown[]) => mockDb.prepare(sql).get(...(params as never[])) as T;

const E = {
  swiggyOdd: "a1a1a1a1-0000-4000-8000-000000000001",
  swiggy: "b2b2b2b2-0000-4000-8000-000000000002",
  swiggyCopy: "c3c3c3c3-0000-4000-8000-000000000003",
  ccBill: "d4d4d4d4-0000-4000-8000-000000000004",
  refund: "e5e5e5e5-0000-4000-8000-000000000005",
  zerodha: "f6f6f6f6-0000-4000-8000-000000000006",
  uncat: "a7a7a7a7-0000-4000-8000-000000000007",
};
const ACC = { sav: "11111111-aaaa-4000-8000-000000000001", card: "22222222-bbbb-4000-8000-000000000002" };

const expense = (id: string, over: Record<string, unknown>) =>
  insert("expenses", { id, user_id: USER, amount: 100, date: "2026-10-05", nature: "realized", status: "approved", source: "manual", account_id: ACC.sav, ...over });
const t = (id: string, date: string, amount: number) => ({ ref: shortRef("t", id), date, amount });

function seed() {
  mockDb.exec(`
    DELETE FROM expenses; DELETE FROM categories; DELETE FROM financial_accounts; DELETE FROM payment_modes;
    DELETE FROM account_transfers; DELETE FROM smart_rules; DELETE FROM merchant_aliases; DELETE FROM merchant_mappings; DELETE FROM merchant_corrections;
  `);
  insert("categories", { id: "cat-food", user_id: USER, name: "Food", is_active: 1 });
  insert("categories", { id: "cat-other", user_id: USER, name: "Other", is_active: 1 });
  insert("payment_modes", { id: "pm-upi", user_id: USER, name: "UPI", type: "upi", is_active: 1 });
  insert("financial_accounts", { id: ACC.sav, user_id: USER, bank_name: "HDFC", account_type: "savings", account_identifier: "4521", is_active: 1 });
  // A credit card Arth guessed as a savings account.
  insert("financial_accounts", { id: ACC.card, user_id: USER, bank_name: "HDFC", account_type: "savings", account_identifier: "9911", is_active: 1 });
  expense(E.swiggyOdd, { amount: 482, date: "2026-10-03", merchant_name: "SWIGGY*ORDER", category_id: "cat-other" });
  expense(E.swiggy, { amount: 310, date: "2026-10-04", merchant_name: "Swiggy", category_id: "cat-food" });
  expense(E.swiggyCopy, { amount: 310, date: "2026-10-04", merchant_name: "Swiggy", category_id: "cat-food" });
  expense(E.ccBill, { amount: 5000, date: "2026-10-06", merchant_name: "HDFC CC BILL", category_id: "cat-other" });
  expense(E.refund, { amount: 310, date: "2026-10-08", merchant_name: "Swiggy", nature: "credit", credit_kind: "refund" });
  expense(E.zerodha, { amount: 20000, date: "2026-10-09", merchant_name: "ZERODHA BROKING", nature: "credit" });
  expense(E.uncat, { amount: 90, date: "2026-10-10", merchant_name: "Chai Point", category_id: null });
}

beforeAll(async () => {
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  mockDb.exec("PRAGMA foreign_keys = OFF; PRAGMA ignore_check_constraints = ON;");
});
beforeEach(seed);

describe("data health", () => {
  it("boils merchant spellings down to one key", () => {
    expect(merchantKey("SWIGGY*ORDER")).toBe(merchantKey("Swiggy"));
    expect(merchantKey("Zomato Pvt Ltd")).toBe(merchantKey("ZOMATO"));
  });

  it("finds spellings, uncategorised spending and refunds left unlinked", async () => {
    const h = await getHealthReport(USER, "2026-11-12");
    const count = (id: string) => h.checks.find((c) => c.id === id)?.count;
    expect(count("uncategorised")).toBe(1);
    expect(count("refunds")).toBe(1);
    expect(h.merchantSpellings.some((g) => g.names.map((n) => n.name).includes("SWIGGY*ORDER"))).toBe(true);
    expect(h.score).toBeLessThan(100);
  });
});

describe("reading a correction file", () => {
  it("finds the corrections in prose and code fences", () => {
    const item = '{"type":"mark_redemption","ref":"tf6f6f6f6","date":"2026-10-09","amount":20000}';
    const r = findCorrectionObjects(`Here:\n\`\`\`json\n{"format":"arth-corrections/1","corrections":[${item}]}\n\`\`\``);
    expect(r).toEqual({ objects: [item], recognised: true, cutOff: false });
  });

  it("refuses what doesn't match the data, with a reason, and changes nothing", async () => {
    const pasted = JSON.stringify({
      corrections: [
        { type: "set_merchant", ...t(E.swiggyOdd, "2026-10-03", 999), merchant: "Swiggy" }, // wrong amount
        { type: "move_account", ...t(E.swiggy, "2026-10-04", 310), account: "k00000000" }, // not an account
        { type: "adjust_balance", account: accountFixRef(ACC.sav), balance: "lots" },
        { type: "set_income_type", ...t(E.swiggy, "2026-10-04", 310), income_type: "salary" }, // a payment
        { type: "delete_everything" },
      ],
    });
    const r = await readCorrections(USER, pasted);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected.map((x) => x.reason)).toEqual(
      expect.arrayContaining([
        "Names a transaction that doesn't match any of yours",
        "Names an account that isn't one of yours",
        "Has no balance",
        "Only money in has an income type",
      ]),
    );
    expect(r.rejected).toHaveLength(5);
    expect(one<{ merchant_name: string }>("SELECT merchant_name FROM expenses WHERE id = ?", E.swiggyOdd).merchant_name).toBe("SWIGGY*ORDER");
  });

  it("keeps the first of two structural changes to one transaction", async () => {
    const r = await readCorrections(
      USER,
      JSON.stringify({
        corrections: [
          { type: "mark_transfer", ...t(E.swiggyCopy, "2026-10-04", 310), other_account: accountFixRef(ACC.card) },
          { type: "mark_duplicate", ...t(E.swiggyCopy, "2026-10-04", 310), same_as_ref: shortRef("t", E.swiggy), same_as_date: "2026-10-04", same_as_amount: 310 },
        ],
      }),
    );
    expect(r.accepted.map((f) => f.type)).toEqual(["mark_duplicate"]);
    expect(r.rejected[0].reason).toBe("Changes a transaction another correction already changes");
  });

  it("counts a correction that's already true, instead of listing it", async () => {
    const r = await readCorrections(USER, JSON.stringify({ corrections: [{ type: "set_merchant", ...t(E.swiggy, "2026-10-04", 310), merchant: "Swiggy" }] }));
    expect(r.accepted).toHaveLength(0);
    expect(r.alreadySet).toBe(1);
  });
});

describe("applying corrections", () => {
  const file = () =>
    JSON.stringify({
      format: "arth-corrections/1",
      corrections: [
        { type: "add_rule", name: "Chai is food", when: [{ field: "merchant", is: "contains", value: "Chai" }], category: "Food" },
        { type: "set_account_type", account: accountFixRef(ACC.card), account_type: "credit_card", why: "Card bill payments go to it" },
        { type: "mark_duplicate", ...t(E.swiggyCopy, "2026-10-04", 310), same_as_ref: shortRef("t", E.swiggy), same_as_date: "2026-10-04", same_as_amount: 310 },
        { type: "mark_transfer", ...t(E.ccBill, "2026-10-06", 5000), other_account: accountFixRef(ACC.card) },
        { type: "link_refund", ...t(E.refund, "2026-10-08", 310), purchase_ref: shortRef("t", E.swiggy), purchase_date: "2026-10-04", purchase_amount: 310 },
        { type: "fix_merchant", from: "SWIGGY*ORDER", to: "Swiggy" },
        { type: "recategorise", ...t(E.uncat, "2026-10-10", 90), category: "Food" },
        { type: "set_payment_mode", ...t(E.swiggy, "2026-10-04", 310), payment_mode: "UPI" },
        { type: "set_spend_type", ...t(E.swiggy, "2026-10-04", 310), unavoidable: false },
        { type: "mark_redemption", ...t(E.zerodha, "2026-10-09", 20000) },
      ],
    });

  it("reads every kind, in apply order", async () => {
    const r = await readCorrections(USER, file());
    expect(r.rejected).toEqual([]);
    expect(r.accepted.map((f) => f.type)).toEqual([
      "set_account_type",
      "mark_duplicate",
      "mark_transfer",
      "link_refund",
      "fix_merchant",
      "recategorise",
      "set_payment_mode",
      "set_spend_type",
      "mark_redemption",
      "add_rule",
    ]);
  });

  it("applies each through the app's own services, after a snapshot", async () => {
    const r = await readCorrections(USER, file());
    const result = await applyCorrections(USER, r.accepted);
    expect(mockSnapshot).toHaveBeenCalled();
    expect(result.failed).toEqual([]);
    expect(result.applied).toBe(10);

    const row = (id: string) => one<Record<string, unknown>>("SELECT * FROM expenses WHERE id = ?", id);
    expect(one<{ account_type: string }>("SELECT account_type FROM financial_accounts WHERE id = ?", ACC.card).account_type).toBe("credit_card");
    expect(row(E.swiggyCopy).deleted_at).not.toBeNull(); // Recycle Bin, not gone
    expect(row(E.ccBill).reclassified_as_transfer).toBe(1);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM account_transfers WHERE from_account_id = ? AND to_account_id = ? AND deleted_at IS NULL", ACC.sav, ACC.card).n).toBe(1);
    expect(row(E.refund).refund_of_expense_id).toBe(E.swiggy);
    expect(row(E.swiggyOdd).merchant_name).toBe("Swiggy");
    expect(row(E.uncat).category_id).toBe("cat-food");
    expect(row(E.swiggy).payment_mode_id).toBe("pm-upi");
    expect(row(E.swiggy).is_right_spend).toBe(0);
    expect(row(E.zerodha).money_event).toBe("investment_withdrawal");
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM smart_rules WHERE name = 'Chai is food'").n).toBe(1);
    // The impact report shows the app's own figures moving.
    expect(result.changes).toEqual(expect.arrayContaining([expect.objectContaining({ id: "health:uncategorised", before: 1, value: 0 })]));
    // Amounts and dates are never touched.
    expect(row(E.swiggy)).toMatchObject({ amount: 310, date: "2026-10-04" });
  });

  it("lists one that fails and still applies the rest", async () => {
    const r = await readCorrections(USER, file());
    // Between reading and applying, the transfer's payment disappears.
    mockDb.prepare("DELETE FROM expenses WHERE id = ?").run(E.ccBill);
    const result = await applyCorrections(USER, r.accepted);
    expect(result.failed.map((f) => f.title)).toEqual([expect.stringContaining("HDFC CC BILL")]);
    expect(result.applied).toBe(9);
  });
});

describe("the Fix my data file", () => {
  it("holds the request, the format, the findings and every transaction with its links, and nothing private", async () => {
    mockDb.prepare("UPDATE expenses SET refund_of_expense_id = ? WHERE id = ?").run(E.swiggy, E.refund);
    insert("vault_entries", { id: "v-1", title: "LEAK_VAULT_TITLE", category: "banking", login_method: "password", username: "LEAK_VAULT_USER" });
    mockDb.prepare("UPDATE expenses SET raw_source_text = 'LEAK_SMS_BODY Rs.482 debited' WHERE id = ?").run(E.swiggyOdd);

    const { buildFixExport } = await import("../../services/corrections/export");
    const f = await buildFixExport(USER, { includePeople: false, includeNotes: false });
    const json = mockWritten.get(f.fileName) ?? "";
    const data = JSON.parse(json);

    expect(data.format).toBe("arth-corrections/1");
    expect(data.request).toMatch(/consistent/);
    expect(data.reply_instructions.join(" ")).toMatch(/mark_transfer/);
    expect(data.accounts_for_fixes.map((a: { fix_ref: string }) => a.fix_ref)).toContain(accountFixRef(ACC.card));
    expect(data.health.findings.length).toBeGreaterThan(0);
    const refundRow = data.transactions.find((r: { ref: string }) => r.ref === shortRef("t", E.refund));
    expect(refundRow.refund_of).toBe(shortRef("t", E.swiggy));
    expect(json).not.toMatch(/LEAK_/);
    // The keys first, so an assistant reading only the start still has the instructions.
    expect(Object.keys(data).slice(0, 5)).toEqual(["guide", "format", "request", "reply_instructions", "health"]);
  });
});
