/**
 * Public-data seeder tests. Verifies Phase 1–2 ship safely:
 *  - seedPublicData() upserts bundle contents into the right tables with
 *    INSERT OR IGNORE semantics.
 *  - Never touches expenses, recurring_expense_rules, reminder_fulfillments,
 *    merchant_aliases, or any existing user-data table.
 *  - Is idempotent when the same bundle version is re-seeded.
 *  - Resolvers return data from the seeded tables.
 */

interface RunLog {
  sql: string;
  params: unknown[];
}

let executedRuns: RunLog[] = [];
let mockRows: Record<string, unknown[]> = {};

const mockDb = {
  getAllAsync: jest.fn(async (sql: string) => mockRows[sql] ?? []),
  getFirstAsync: jest.fn(async (sql: string, ..._params: unknown[]) => {
    const rows = mockRows[sql] ?? [];
    return rows[0] ?? null;
  }),
  runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    executedRuns.push({ sql, params });
    return { changes: 1, lastInsertRowId: 1 };
  }),
  execAsync: jest.fn(async () => {}),
  withTransactionAsync: jest.fn(async (cb: () => Promise<void>) => cb()),
};

jest.mock("../../database", () => ({
  getDatabase: () => mockDb,
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

import { seedPublicData } from "../../services/public-data";
import {
  resolveBankFromIfsc,
  resolveCategoryFromMcc,
  resolveMerchantBrand,
} from "../../services/public-data/lookup";
import {
  harvestReminderHintFromParsed,
  recordReminderSuggestion,
  type ReminderSuggestionFields,
} from "../../services/public-data/reminder-hints";
import type { ParsedSMS } from "../../services/sms/bank-patterns";

describe("seedPublicData (Phase 2 — MCC + IFSC bundles shipped)", () => {
  beforeEach(() => {
    executedRuns = [];
    mockRows = {};
    jest.clearAllMocks();
  });

  it("runs without throwing", async () => {
    await expect(seedPublicData()).resolves.toBeUndefined();
  });

  it("does not insert into any user-data table", async () => {
    await seedPublicData();

    const forbiddenTables = [
      "expenses",
      "recurring_expense_rules",
      "reminder_fulfillments",
      "merchant_aliases",
      "merchant_corrections",
      "merchant_mappings",
      "categories",
      "financial_accounts",
    ];

    for (const table of forbiddenTables) {
      const hit = executedRuns.find(
        (r) => r.sql.toLowerCase().includes(`insert`) &&
               r.sql.toLowerCase().includes(table.toLowerCase()),
      );
      expect(hit).toBeUndefined();
    }
  });

  it("inserts MCC bundle rows into mcc_codes via INSERT OR IGNORE", async () => {
    await seedPublicData();

    const mccInserts = executedRuns.filter((r) =>
      /INSERT OR IGNORE INTO mcc_codes/i.test(r.sql),
    );
    // greggles/mcc-codes ships ~981 rows; assert we inserted a realistic volume.
    expect(mccInserts.length).toBeGreaterThan(900);
    expect(mccInserts.length).toBeLessThan(1100);
  });

  it("inserts IFSC bundle rows into ifsc_bank_registry", async () => {
    await seedPublicData();

    const ifscInserts = executedRuns.filter((r) =>
      /INSERT OR IGNORE INTO ifsc_bank_registry/i.test(r.sql),
    );
    // razorpay/ifsc ships ~1500 bank prefixes.
    expect(ifscInserts.length).toBeGreaterThan(1000);
  });

  it("records the seeded version in data_bundle_versions", async () => {
    await seedPublicData();
    const versionWrites = executedRuns.filter((r) =>
      /INSERT INTO data_bundle_versions/i.test(r.sql),
    );
    // One row per bundle that successfully loaded (MCC + IFSC = 2 in Phase 2).
    expect(versionWrites.length).toBeGreaterThanOrEqual(2);
  });

  it("is idempotent — second call with already-seeded version is a no-op", async () => {
    // Each bundle has its own version string; stub the version lookup so
    // every bundle sees its version is already recorded and skips insert.
    // Bundle name arrives as the first bound parameter.
    const bundleVersions: Record<string, string> = {
      "mcc-codes": "2026-04-29",
      "ifsc-prefixes": "2026-04-29",
      "merchant-brands": "2026-04-29",
      "sms-senders": "2026-04-29",
      "sms-templates": "2026-04-30",
    };
    mockDb.getFirstAsync.mockImplementation(
      async (sql: string, ...params: unknown[]) => {
        if (
          /SELECT seeded_version FROM data_bundle_versions/i.test(sql) &&
          typeof params[0] === "string"
        ) {
          const v = bundleVersions[params[0]];
          return v ? { seeded_version: v } : null;
        }
        const rows = mockRows[sql] ?? [];
        return rows[0] ?? null;
      },
    );
    executedRuns = [];
    await seedPublicData();

    const bundleInserts = executedRuns.filter((r) =>
      /INSERT OR IGNORE INTO (mcc_codes|ifsc_bank_registry|merchant_brand_registry|sms_sender_registry|sms_template_patterns)/i.test(
        r.sql,
      ),
    );
    expect(bundleInserts.length).toBe(0);
  });
});

describe("resolvers (Phase 2 — real DB paths)", () => {
  beforeEach(() => {
    executedRuns = [];
    mockRows = {};
    jest.clearAllMocks();
  });

  it("resolveBankFromIfsc uppercases the prefix and queries ifsc_bank_registry", async () => {
    mockRows["SELECT bank_name FROM ifsc_bank_registry WHERE ifsc_prefix = ?;"] =
      [{ bank_name: "HDFC Bank" }];

    const result = await resolveBankFromIfsc("hdfc0001234");
    expect(result).toBe("HDFC Bank");
  });

  it("resolveBankFromIfsc returns null for invalid input", async () => {
    const result = await resolveBankFromIfsc("abc");
    expect(result).toBeNull();
  });

  it("resolveCategoryFromMcc returns the seeded category", async () => {
    mockRows["SELECT category_name FROM mcc_codes WHERE code = ?;"] = [
      { category_name: "Food" },
    ];

    const result = await resolveCategoryFromMcc("5812");
    expect(result).toBe("Food");
  });

  it("resolveMerchantBrand returns null when no alias matches", async () => {
    const result = await resolveMerchantBrand("UNKNOWN_MERCHANT_XYZ");
    expect(result).toBeNull();
  });

  it("resolveMerchantBrand returns canonical, category, and mcc from registry", async () => {
    mockRows[
      "SELECT brand_canonical, category_name, mcc_code FROM merchant_brand_registry WHERE alias = ? COLLATE NOCASE;"
    ] = [
      {
        brand_canonical: "Swiggy",
        category_name: "Food",
        mcc_code: "5812",
      },
    ];

    const result = await resolveMerchantBrand("PYU*Swiggy Food");
    expect(result).toEqual({
      canonical: "Swiggy",
      category: "Food",
      mcc: "5812",
    });
  });
});

describe("merchant-brands bundle content (shape contract)", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bundle = require("../../assets/data/merchant-brands.json") as {
    entries: Array<{
      id: string;
      alias: string;
      brand_canonical: string;
      category_name?: string;
      mcc_code?: string;
    }>;
  };

  it("has unique ids and aliases", () => {
    const ids = new Set(bundle.entries.map((e) => e.id));
    const aliases = new Set(bundle.entries.map((e) => e.alias));
    expect(ids.size).toBe(bundle.entries.length);
    expect(aliases.size).toBe(bundle.entries.length);
  });

  const validCategories = new Set([
    "Car & Vehicles",
    "Health & Medicine",
    "Travel & Going Out",
    "Rent & Utilities",
    "Subscriptions",
    "Grocery & Supplies",
    "Food",
    "Shopping & Gifts",
    "Family",
    "Miscellaneous",
    "Insurance",
    "EMIs",
    "Unknown",
  ]);

  it("every category_name matches an Artha default category", () => {
    const invalid = bundle.entries.filter(
      (e) => e.category_name && !validCategories.has(e.category_name),
    );
    expect(invalid).toEqual([]);
  });
});

describe("recordReminderSuggestion", () => {
  beforeEach(() => {
    executedRuns = [];
    mockRows = {};
    jest.clearAllMocks();
  });

  it("inserts into reminder_suggestions with a serialized payload", async () => {
    const fields: ReminderSuggestionFields = {
      amount: 499,
      merchant: "NETFLIX",
      account_identifier: "3001",
      due_date: "2026-05-01",
      mandate_ref: "Y37xmVJOER",
      reminder_kind: "standing_instruction",
    };

    await recordReminderSuggestion("icici-si-v1", "Some SMS body", fields);

    const insert = executedRuns.find((r) =>
      r.sql.includes("INSERT INTO reminder_suggestions"),
    );
    expect(insert).toBeDefined();
    // params: id, pattern_id, body, json
    expect(insert?.params[1]).toBe("icici-si-v1");
    expect(insert?.params[2]).toBe("Some SMS body");
    expect(JSON.parse(insert?.params[3] as string)).toEqual(fields);
  });

  it("never touches expense or rule tables", async () => {
    await recordReminderSuggestion("axis-emi-v1", "EMI SMS body", {
      amount: 22317,
      due_date: "2026-05-10",
      reminder_kind: "emi",
    });

    const forbidden = executedRuns.find((r) =>
      /INTO\s+(expenses|recurring_expense_rules|reminder_fulfillments)\b/i.test(r.sql),
    );
    expect(forbidden).toBeUndefined();
  });
});

describe("harvestReminderHintFromParsed", () => {
  beforeEach(() => {
    executedRuns = [];
    mockRows = {};
    jest.clearAllMocks();
  });

  function makeParsed(overrides: Partial<ParsedSMS>): ParsedSMS {
    return {
      amount: 499,
      merchant: "NETFLIX",
      cardLast4: "3001",
      date: null,
      bank: "ICICI Bank",
      type: "standing_instruction_reminder",
      skip: false,
      confidence: 0.9,
      dueDate: "2026-05-01",
      isForecast: true,
      ...overrides,
    };
  }

  it("stages a standing_instruction_reminder to reminder_suggestions", async () => {
    const parsed = makeParsed({});
    await harvestReminderHintFromParsed(parsed, "Payment of INR 499...");

    const insert = executedRuns.find((r) =>
      /INSERT INTO reminder_suggestions/i.test(r.sql),
    );
    expect(insert).toBeDefined();
    const fields = JSON.parse(insert!.params[3] as string);
    expect(fields.merchant).toBe("NETFLIX");
    expect(fields.due_date).toBe("2026-05-01");
    expect(fields.reminder_kind).toBe("standing_instruction");
    expect(fields.account_identifier).toBe("3001");
    expect(fields.amount).toBe(499);
  });

  it("maps emi_reminder to reminder_kind=emi", async () => {
    await harvestReminderHintFromParsed(
      makeParsed({ type: "emi_reminder", merchant: "EMI Payment", cardLast4: "7249" }),
      "EMI of INR 22317...",
    );
    const insert = executedRuns.find((r) =>
      /INSERT INTO reminder_suggestions/i.test(r.sql),
    );
    const fields = JSON.parse(insert!.params[3] as string);
    expect(fields.reminder_kind).toBe("emi");
  });

  it("maps amount_due_reminder to reminder_kind=bill_due", async () => {
    await harvestReminderHintFromParsed(
      makeParsed({ type: "amount_due_reminder", merchant: "Credit Card Amount Due" }),
      "Amount Due Rs.937 on HDFC...",
    );
    const insert = executedRuns.find((r) =>
      /INSERT INTO reminder_suggestions/i.test(r.sql),
    );
    const fields = JSON.parse(insert!.params[3] as string);
    expect(fields.reminder_kind).toBe("bill_due");
  });

  it("is a no-op for non-reminder transaction types", async () => {
    await harvestReminderHintFromParsed(
      makeParsed({ type: "debit", dueDate: null, isForecast: false }),
      "INR 492.50 spent using ICICI Bank Card...",
    );
    const insert = executedRuns.find((r) =>
      /INSERT INTO reminder_suggestions/i.test(r.sql),
    );
    expect(insert).toBeUndefined();
  });

  it("is a no-op when dueDate is missing", async () => {
    await harvestReminderHintFromParsed(
      makeParsed({ dueDate: null }),
      "unparseable body",
    );
    const insert = executedRuns.find((r) =>
      /INSERT INTO reminder_suggestions/i.test(r.sql),
    );
    expect(insert).toBeUndefined();
  });

  it("never writes to expenses or recurring_expense_rules", async () => {
    await harvestReminderHintFromParsed(makeParsed({}), "any body");
    const forbidden = executedRuns.find((r) =>
      /INTO\s+(expenses|recurring_expense_rules|reminder_fulfillments)\b/i.test(r.sql),
    );
    expect(forbidden).toBeUndefined();
  });
});
