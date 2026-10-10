import { DatabaseSync } from "node:sqlite";

/**
 * Export for AI Insights, against the REAL schema (every migration run on a real SQLite engine).
 *
 *   - leak guard: the vault, SMS text, credentials, full account numbers, and deleted or
 *     unreviewed entries never reach the file, with every section switched on
 *   - allow-list guard: the file contains no key outside AI_EXPORT_KEYS
 *   - figures match: month balances equal what the account ledger computes
 *   - switches: each one removes what it says it removes
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
jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));

import { runMigrations } from "../../database/migrations";
import { computeUnseededBalance, getMonthBalanceSummary } from "../../services/account-balance";
import {
  AI_EXPORT_KEYS,
  buildAiExport,
  DEFAULT_AI_EXPORT_SECTIONS,
  formatAiExportJson,
  type AiExportOptions,
  type AiExportSections,
} from "../../services/ai-export";

const USER = "default-user";
const TODAY = new Date(2026, 9, 10); // 10 Oct 2026
const ALL_ON: AiExportSections = { ...DEFAULT_AI_EXPORT_SECTIONS, notes: true, hisaab: true };

function options(over: Partial<AiExportOptions> = {}): AiExportOptions {
  return {
    from: "2026-04-01",
    to: "2026-10-10",
    sections: ALL_ON,
    hidePeopleNames: false,
    hideMerchantNames: false,
    ...over,
  };
}

/** Insert a row, filling any required column the test doesn't care about with a dummy. */
function insert(table: string, values: Record<string, unknown>) {
  const cols = mockDb.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
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

function expense(id: string, over: Record<string, unknown>) {
  insert("expenses", {
    id,
    user_id: USER,
    amount: 100,
    date: "2026-05-10",
    nature: "realized",
    status: "approved",
    source: "manual",
    ...over,
  });
}

beforeAll(async () => {
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  // Fixture rows only fill the columns the export reads; the rest get dummies.
  mockDb.exec("PRAGMA foreign_keys = OFF; PRAGMA ignore_check_constraints = ON;");
  mockDb.exec("DELETE FROM categories; DELETE FROM payment_modes;");

  insert("categories", { id: "cat-food", user_id: USER, name: "Groceries" });
  insert("payment_modes", { id: "pm-upi", user_id: USER, name: "UPI" });
  insert("tags", { id: "tag-1", user_id: USER, name: "trip" });

  // Seeded savings account, opening set in April.
  insert("financial_accounts", {
    id: "acc-sav", user_id: USER, bank_name: "HDFC", account_type: "savings",
    account_identifier: "LEAK_ACCT_50100099991234", account_label: null, is_active: 1,
  });
  insert("account_month_balances", { id: "amb-1", account_id: "acc-sav", month: "2026-04", opening_balance: 50000 });
  // Credit card, seeded at 0.
  insert("financial_accounts", {
    id: "acc-cc", user_id: USER, bank_name: "ICICI", account_type: "credit_card",
    account_identifier: "8811", account_label: "ICICI Card", credit_limit: 200000, is_active: 1,
  });
  insert("account_month_balances", { id: "amb-2", account_id: "acc-cc", month: "2026-04", opening_balance: 0 });
  // Wallet with no opening anywhere - the unseeded path.
  insert("financial_accounts", {
    id: "acc-wal", user_id: USER, bank_name: "Paytm", account_type: "wallet",
    account_identifier: "7700", account_label: "Paytm Wallet", is_active: 1,
  });

  expense("e-spend", {
    amount: 1249, date: "2026-04-03", account_id: "acc-sav", category_id: "cat-food", payment_mode_id: "pm-upi",
    merchant_name: "BigBasket", description: "weekly shop", raw_source_text: "LEAK_SMS_BODY debited 1249",
    source_sms_address: "LEAK_SENDER",
  });
  insert("expense_tags", { expense_id: "e-spend", tag_id: "tag-1" });
  expense("e-salary", { amount: 90000, date: "2026-04-30", nature: "credit", credit_kind: "salary", account_id: "acc-sav" });
  expense("e-cc", { amount: 5000, date: "2026-05-12", account_id: "acc-cc", merchant_name: "Croma" });
  expense("e-refund", { amount: 500, date: "2026-05-20", nature: "credit", refund_of_expense_id: "e-cc", account_id: "acc-cc" });
  expense("e-split", { amount: 400, split_original_amount: 1000, date: "2026-06-02", account_id: "acc-sav" });
  expense("e-wallet", { amount: 300, date: "2026-06-15", account_id: "acc-wal" });
  expense("e-adjust", {
    amount: 250, date: "2026-06-20", nature: "ledger_adjustment", account_id: "acc-sav",
    description: "[Balance Adjustment +] LEAK_ADJUST",
  });
  // None of these may appear.
  expense("e-deleted", { amount: 111, merchant_name: "LEAK_DELETED", deleted_at: "2026-05-11", account_id: "acc-sav" });
  expense("e-pending", { amount: 222, merchant_name: "LEAK_PENDING", status: "pending_review", account_id: "acc-sav" });
  expense("e-rejected", { amount: 333, merchant_name: "LEAK_REJECTED", status: "rejected", account_id: "acc-sav" });
  expense("e-forecast", { amount: 444, merchant_name: "LEAK_FORECAST", nature: "forecast", account_id: "acc-sav" });
  expense("e-moved", { amount: 555, merchant_name: "LEAK_RECLASSIFIED", reclassified_as_transfer: 1, account_id: "acc-sav" });
  expense("e-old", { amount: 666, merchant_name: "LEAK_OUT_OF_PERIOD", date: "2025-12-01", account_id: "acc-sav" });

  insert("account_transfers", {
    id: "t-1", user_id: USER, from_account_id: "acc-sav", to_account_id: "acc-cc", amount: 4500,
    date: "2026-06-05", description: "card bill", raw_source_text: "LEAK_TRANSFER_SMS",
  });

  insert("budgets", { id: "b-1", user_id: USER, category_id: "cat-food", month: "2026-04", amount: 8000 });

  insert("hisaab_persons", { id: "hp-1", owner_user_id: USER, name: "Rohan", phone: "LEAK_PHONE", is_active: 1, initial_balance: 0 });
  insert("hisaab_entries", { id: "he-1", hisaab_person_id: "hp-1", amount: 600, date: "2026-06-02", type: "debit", description: "dinner" });

  // Tables the export must never read.
  insert("vault_entries", {
    id: "v-1", title: "LEAK_VAULT_TITLE", category: "banking", login_method: "password",
    username: "LEAK_VAULT_USER", password_enc: "LEAK_VAULT_PASSWORD", notes: "LEAK_VAULT_NOTES",
  });
  insert("integration_credentials", { service: "LEAK_SERVICE", key: "LEAK_KEY", value_enc: "LEAK_SECRET" });
  insert("sms_scan_runs", { id: "run-1" });
  insert("sms_scan_details", { id: "sd-1", scan_run_id: "run-1", sms_body_preview: "LEAK_SCAN_BODY", parsed_merchant: "LEAK_SCAN_MERCHANT" });
  insert("pending_sms", { id: "ps-1", user_id: USER, body: "LEAK_PENDING_SMS" });
});

describe("Export for AI Insights", () => {
  it("leaks nothing sensitive with every section on", async () => {
    const { data, skipped } = await buildAiExport(USER, options(), TODAY);
    expect(skipped).toEqual([]);
    const json = JSON.stringify(data);
    expect(json).not.toContain("LEAK_");
    // the long account number is cut to its last four characters
    expect(json).toContain('"last4":"1234"');
  });

  it("contains no key outside the allow-list", async () => {
    const { data } = await buildAiExport(USER, options(), TODAY);
    const allowed = new Set<string>(AI_EXPORT_KEYS);
    const seen = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        for (const [k, child] of Object.entries(v)) {
          if (child === undefined) continue;
          seen.add(k);
          walk(child);
        }
      }
    };
    walk(data);
    expect([...seen].filter((k) => !allowed.has(k))).toEqual([]);
    // the guide comes first and the long row list last
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    expect(keys[0]).toBe("guide");
    expect(keys[keys.length - 1]).toBe("transactions");
  });

  it("exports only approved, live transactions and labels them", async () => {
    const { data, counts } = await buildAiExport(USER, options(), TODAY);
    const txns = data.transactions as Record<string, unknown>[];
    expect(counts.transactions).toBe(6);
    expect(txns.map((t) => t.kind)).toEqual(["spend", "income", "spend", "refund", "spend", "spend"]);

    expect(txns[0]).toEqual({
      date: "2026-04-03", amount: 1249, kind: "spend", income_type: null, full_amount: null,
      category: "Groceries", merchant: "BigBasket", account: "a1", mode: "UPI", tags: ["trip"], note: "weekly shop",
    });
    // every row has the same fields, so the list reads as a table
    expect(new Set(txns.map((t) => Object.keys(t).join())).size).toBe(1);
    expect(txns[1].income_type).toBe("salary");
    // a shared spend carries the user's share and the full amount
    expect(txns[4]).toMatchObject({ amount: 400, full_amount: 1000 });

    // the move between own accounts is a transfer, not a transaction
    expect(data.transfers).toEqual([{ date: "2026-06-05", amount: 4500, from: "a1", to: "a2", note: "card bill" }]);
  });

  it("uses the app's own monthly spending figure", async () => {
    const { data } = await buildAiExport(USER, options(), TODAY);
    const summary = data.monthly_summary as Record<string, unknown>[];
    expect(summary).toHaveLength(7); // Apr to Oct
    expect(summary[0]).toEqual({ month: "2026-04", spending: 1249, income: 90000, refunds: 0, invested: 0, loan_payments: 0 });
    // May: 5,000 on the card less the 500 refund
    expect(summary[1]).toMatchObject({ month: "2026-05", spending: 4500, refunds: 500 });
  });

  it("month balances match the account ledger", async () => {
    // Export first: it must get these right without the ledger having healed any rows.
    const { data } = await buildAiExport(USER, options(), TODAY);
    const accounts = data.accounts as { name: string; balances: { month: string; opening: number; closing: number }[] }[];
    const balancesOf = (name: string) => accounts.find((a) => a.name === name)!.balances;

    for (const [name, id] of [["HDFC", "acc-sav"], ["ICICI Card", "acc-cc"]] as const) {
      const exported = balancesOf(name);
      expect(exported.map((b) => b.month)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
      for (const b of exported) {
        const ledger = await getMonthBalanceSummary(id, b.month);
        expect({ month: b.month, opening: b.opening, closing: b.closing }).toEqual({
          month: b.month, opening: ledger!.opening_balance, closing: ledger!.closing_balance,
        });
      }
    }
    // savings: 50,000 - 1,249 + 90,000 in April
    expect(balancesOf("HDFC")[0]).toEqual({ month: "2026-04", opening: 50000, closing: 138751 });
    // card: owes 5,000 - 500 refund at the end of May, then the 4,500 bill payment clears it
    expect(balancesOf("ICICI Card")[1].closing).toBe(4500);
    expect(balancesOf("ICICI Card")[2].closing).toBe(0);

    // unseeded wallet: starts at its first month of activity
    const wallet = balancesOf("Paytm Wallet");
    expect(wallet[0].month).toBe("2026-06");
    for (const b of wallet) {
      const ledger = await computeUnseededBalance("acc-wal", b.month);
      expect([b.opening, b.closing]).toEqual([ledger.opening, ledger.closing]);
    }
  });

  it("does not write to the database", async () => {
    const count = () => (mockDb.prepare("SELECT COUNT(*) as n FROM account_month_balances").get() as { n: number }).n;
    mockDb.exec("DELETE FROM account_month_balances WHERE id NOT IN ('amb-1', 'amb-2');");
    await buildAiExport(USER, options(), TODAY);
    expect(count()).toBe(2);
  });

  it("budgets and hisaab come through", async () => {
    const { data } = await buildAiExport(USER, options(), TODAY);
    expect(data.budgets).toMatchObject({
      total_budget: 8000,
      by_category: [{ category: "Groceries", budget: 8000, spent: 1249 }],
    });
    expect(data.hisaab).toEqual({
      people: [{ name: "Rohan", balance: 600 }],
      entries: [{ date: "2026-06-02", person: "Rohan", type: "debit", amount: 600, note: "dinner" }],
    });
  });

  it("each switch removes what it says", async () => {
    const none = Object.fromEntries(Object.keys(ALL_ON).map((k) => [k, false])) as unknown as AiExportSections;
    const { data: empty } = await buildAiExport(USER, options({ sections: none }), TODAY);
    expect(Object.keys(empty).filter((k) => empty[k] !== undefined).sort()).toEqual(
      ["currency", "generated_on", "guide", "period"],
    );

    const { data: defaults } = await buildAiExport(
      USER,
      options({ sections: DEFAULT_AI_EXPORT_SECTIONS, hidePeopleNames: true, hideMerchantNames: true }),
      TODAY,
    );
    const json = JSON.stringify(defaults);
    expect(defaults.hisaab).toBeUndefined();
    expect(json).not.toContain('"note"');
    expect(json).not.toContain("weekly shop");
    expect(json).not.toContain("BigBasket");
    expect(json).not.toContain("Rohan");

    const { data: masked } = await buildAiExport(USER, options({ hidePeopleNames: true }), TODAY);
    expect(JSON.stringify(masked.hisaab)).not.toContain("Rohan");
    expect((masked.hisaab as { people: unknown[] }).people).toEqual([{ name: "Person 1", balance: 600 }]);

    // without the accounts section, transactions carry no account reference
    const { data: noAccounts } = await buildAiExport(USER, options({ sections: { ...ALL_ON, accounts: false } }), TODAY);
    expect(noAccounts.accounts).toBeUndefined();
    expect(noAccounts.transfers).toBeUndefined();
    expect(JSON.stringify(noAccounts.transactions)).not.toContain('"account"');
  });

  it("writes standard JSON with one record per line", async () => {
    const { data } = await buildAiExport(USER, options(), TODAY);
    const text = formatAiExportJson(data);
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(data)));
    const lines = text.split(String.fromCharCode(10));
    expect(lines.filter((l) => l.includes('"kind":'))).toHaveLength(6);
    expect(lines.filter((l) => l.includes('"kind":')).every((l) => l.trim().startsWith('{"date":'))).toBe(true);
  });

  it("never runs past today", async () => {
    const { data } = await buildAiExport(USER, options({ to: "2027-03-31" }), TODAY);
    expect(data.period).toEqual({ from: "2026-04-01", to: "2026-10-10" });
  });
});
