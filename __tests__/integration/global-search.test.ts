import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

/** "Search or do" against the real schema, with made-up data. */

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
const mockSecure = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  setItemAsync: async (k: string, v: string) => void mockSecure.set(k, v),
  getItemAsync: async (k: string) => mockSecure.get(k) ?? null,
  deleteItemAsync: async (k: string) => void mockSecure.delete(k),
}));
jest.mock("react-native-aes-crypto", () => ({
  __esModule: true,
  default: {
    randomKey: async () => "k",
    encrypt: async (pt: string) => `enc:${pt}`,
    decrypt: async (ct: string) => ct.slice(4),
  },
}));
jest.mock("../../database", () => ({
  getDatabase: () => mockAdapter,
  initDatabase: async () => mockAdapter,
}));

import { DEFAULT_USER_ID } from "../../constants/app";
import { runMigrations } from "../../database/migrations";
import {
  clearRecentSearchResults,
  dateWordsIn,
  closeNames,
  getRecentSearchResults,
  rememberSearchResult,
  searchCatalog,
  searchData,
  withoutActionWords,
} from "../../services/global-search";
import { SEARCH_CATALOG, SUGGESTED_ACTION_IDS } from "../../services/search-catalog";
import { createVaultEntry } from "../../services/vault";

const USER = DEFAULT_USER_ID;

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
const tx = (values: Record<string, unknown>) =>
  insert("expenses", { id: `e${++seq}`, user_id: USER, date: "2026-10-15", amount: 100, status: "approved", nature: "realized", source: "manual", currency: "INR", ...values });

const group = async (q: string, key: string) => (await searchData(q)).find((g) => g.key === key);

beforeEach(async () => {
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  mockKv.clear();
  mockSecure.clear();
  insert("users", { id: USER });
  insert("financial_accounts", { id: "bank", user_id: USER, account_type: "savings", bank_name: "Axis Bank", account_identifier: "1111", account_label: "Salary account" });
  insert("categories", { id: "food", user_id: USER, name: "Food" });
});

describe("the catalog", () => {
  const appDir = path.join(__dirname, "../../app");
  const screens = new Set<string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith(".tsx") && !e.name.startsWith("_")) {
        const route = path.relative(appDir, f).replace(/\\/g, "/").replace(/\.tsx$/, "");
        screens.add(`/${route}`);
        if (route.endsWith("/index")) screens.add(`/${route.slice(0, -6)}`);
      }
    }
  };
  walk(appDir);

  it("every entry opens a real screen", () => {
    const missing = SEARCH_CATALOG.filter((e) => e.target && !screens.has(e.target.pathname)).map((e) => `${e.id}: ${e.target!.pathname}`);
    expect(missing).toEqual([]);
  });

  it("ids are unique and suggestions exist", () => {
    const ids = SEARCH_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of SUGGESTED_ACTION_IDS) expect(ids).toContain(id);
  });

  it("finds how to change things, one or many", () => {
    const first = (q: string) => searchCatalog(q).actions[0]?.title;
    expect(first("change date")).toBe("Change a transaction's date");
    expect(first("change transaction date")).toBe("Change a transaction's date");
    expect(first("edit transaction")).toBe("Edit a transaction");
    expect(first("delete transaction")).toBe("Delete a transaction");
    expect(first("bulk edit")).toBe("Edit transactions in bulk");
    expect(first("change dates in bulk")).toBe("Change dates in bulk");
    expect(first("fix multiple categories")).toBe("Change category in bulk");
    expect(first("change password")).toBe("Change a saved password");
    expect(first("remove goal")).toBe("Edit or delete a goal");
    expect(first("stop subscription")).toBe("Edit or stop a reminder");
    expect(searchCatalog("change date").actions.map((a) => a.title)).toContain("Change dates in bulk");
    expect(searchCatalog("change date swiggy").actions[0]?.title).toBe("Change a transaction's date");
  });

  it("bulk actions open Transactions already selecting, single edits don't", () => {
    const entry = (id: string) => SEARCH_CATALOG.find((e) => e.id === id)!;
    expect(entry("bulk-date").target?.params?.select).toBe("1");
    expect(entry("edit-tx-date").target?.params?.select).toBeUndefined();
    expect(entry("edit-tx-date").target?.params?.hint).toBeTruthy();
  });

  it("finds what people would type", () => {
    const first = (q: string) => searchCatalog(q).actions[0]?.title;
    expect(first("change income")).toBe("Change my income");
    expect(first("add investment")).toBe("Add an investment");
    expect(first("set up a goal")).toBe("Set up a goal");
    expect(searchCatalog("salary").actions.map((a) => a.title)).toContain("Change my income");
    expect(searchCatalog("incme").screens.map((a) => a.title)).toContain("Income Calculator");
    expect(searchCatalog("emi").screens.map((a) => a.title)).toContain("Loans");
    expect(searchCatalog("passwrd").screens.map((a) => a.title)).toContain("Vault");
    expect(searchCatalog("where did my money go").screens.map((a) => a.title)).toContain("Spending split");
  });
});

describe("transactions", () => {
  it("by name, category, amount and meaning", async () => {
    tx({ merchant_name: "Swiggy", category_id: "food", amount: 450 });
    tx({ description: "Dentist", amount: 6000 });
    expect((await group("swiggy", "transactions"))?.results[0].title).toBe("Swiggy");
    expect((await group("food", "transactions"))?.total).toBe(1);
    expect((await group(">5000", "transactions"))?.results[0].title).toBe("Dentist");
    expect((await group("450", "transactions"))?.results[0].title).toBe("Swiggy");
    expect((await group("khana", "transactions"))?.results[0].title).toBe("Swiggy");
  });

  it("a typo finds a real merchant", async () => {
    tx({ merchant_name: "Swiggy" });
    expect(closeNames("swigy", ["Swiggy", "Amazon"])).toEqual(["swiggy"]);
    insert("merchant_aliases", { id: "a1", user_id: USER, sms_name: "SWIGGY", canonical_name: "Swiggy" });
    expect((await group("swigy", "transactions"))?.results[0].title).toBe("Swiggy");
  });

  it("a one-character word, or a long sentence, doesn't break the search", async () => {
    tx({ merchant_name: "Store 9" });
    expect((await group("store 9", "transactions"))?.results[0].title).toBe("Store 9");
    await expect(searchData("how do i find every single food and travel and shopping bill from the shop")).resolves.toBeDefined();
    expect((await group("store 9 food travel shopping bills rent money", "transactions"))).toBeUndefined();
  });

  it("an edit search still finds the transaction it names", async () => {
    tx({ merchant_name: "Swiggy" });
    expect(withoutActionWords(["change", "date", "swiggy"])).toEqual(["swiggy"]);
    expect(withoutActionWords(["change", "date"])).toEqual(["change", "date"]);
    expect(withoutActionWords(["amount", "swiggy"])).toEqual(["amount", "swiggy"]);
    expect((await group("change date swiggy", "transactions"))?.results[0].title).toBe("Swiggy");
  });

  it("date words narrow it down", async () => {
    tx({ merchant_name: "Swiggy", date: "2026-09-10" });
    tx({ merchant_name: "Swiggy", date: "2026-10-10" });
    const today = new Date("2026-10-20T10:00:00");
    expect(dateWordsIn("swiggy last month", today)).toEqual({ rest: "swiggy", from: "2026-09-01", to: "2026-09-30" });
    expect(dateWordsIn("swiggy", today)).toEqual({ rest: "swiggy" });
  });

  it("leaves out deleted, rejected and forecast rows", async () => {
    tx({ merchant_name: "Gone", deleted_at: "2026-10-16" });
    tx({ merchant_name: "Gone", status: "rejected" });
    tx({ merchant_name: "Gone", nature: "forecast" });
    expect(await group("gone", "transactions")).toBeUndefined();
  });

  it("over a handful offers See all", async () => {
    for (let i = 0; i < 6; i++) tx({ merchant_name: "Swiggy" });
    const g = await group("swiggy", "transactions");
    expect(g?.results).toHaveLength(4);
    expect(g?.total).toBe(6);
    expect(g?.seeAll?.params).toEqual({ search: "swiggy" });
  });
});

describe("everything else", () => {
  it("finds accounts and people", async () => {
    insert("hisaab_persons", { id: "p1", owner_user_id: USER, name: "Rahul" });
    expect((await group("axis", "accounts"))?.results[0].target?.params).toEqual({ accountId: "bank" });
    expect((await group("rahul", "people"))?.results[0].title).toBe("Rahul");
    expect((await group("rahl", "people"))?.results[0].title).toBe("Rahul");
  });

  it("Vault finds entries by what's in the clear, never by a secret", async () => {
    await createVaultEntry({ title: "Sample Bank", category: "banking", login_method: "password", username: "user_9", password: "hunter22" });
    expect((await group("sample", "vault"))?.results[0].title).toBe("Sample Bank");
    expect((await group("user_9", "vault"))?.results).toHaveLength(1);
    expect(await group("hunter22", "vault")).toBeUndefined();
    expect(JSON.stringify((await group("sample", "vault"))?.results)).not.toContain("hunter22");
  });

  it("an empty search returns nothing, and one failing table doesn't lose the rest", async () => {
    expect(await searchData("  ")).toEqual([]);
    tx({ merchant_name: "Swiggy" });
    mockDb.exec("DROP TABLE smart_rules");
    expect((await group("swiggy", "transactions"))?.total).toBe(1);
  });
});

describe("recent", () => {
  it("keeps the newest few, once each, and never an amount", () => {
    for (let i = 0; i < 8; i++) rememberSearchResult({ key: `k${i}`, title: `T${i}`, icon: "x", amount: 500, subtitle: "secret-ish" });
    rememberSearchResult({ key: "k3", title: "T3", icon: "x" });
    const r = getRecentSearchResults();
    expect(r).toHaveLength(6);
    expect(r[0].key).toBe("k3");
    expect(new Set(r.map((x) => x.key)).size).toBe(6);
    expect(JSON.stringify(r)).not.toContain("500");
    expect(JSON.stringify(r)).not.toContain("secret-ish");
    clearRecentSearchResults();
    expect(getRecentSearchResults()).toEqual([]);
  });
});
