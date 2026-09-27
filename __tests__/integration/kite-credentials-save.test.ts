import { DatabaseSync } from "node:sqlite";

/**
 * Zerodha credentials Save / Update Vault against a real SQLite schema (every migration) and the
 * real Vault + broker-vault code. Only the phone's crypto and secure storage are faked.
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

import { runMigrations } from "../../database/migrations";
import { loadBrokerSecretsFromVault, saveBrokerSecretsToVault } from "../../services/broker-vault";
import { getKiteLoginSecrets, getKiteVaultEntryId, setKiteVaultEntryId } from "../../services/kite-login-autofill";
import { storeKiteApiKey } from "../../services/kite-connect";

beforeEach(async () => {
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  mockKv.clear();
  mockSecure.clear();
});

describe("Zerodha credentials save (real database)", () => {
  it("Save: stores API key, creates the Vault entry and links it for the login fill", async () => {
    await storeKiteApiKey("apikey123");
    const { entryId, created } = await saveBrokerSecretsToVault("kite", {
      apiKey: "apikey123", clientId: "AB1234", password: "s3cret", totpSecret: "JBSWY3DPEHPK3PXP",
    });
    setKiteVaultEntryId(entryId);
    expect(created).toBe(true);
    expect(getKiteVaultEntryId()).toBe(entryId);
    await expect(getKiteLoginSecrets(entryId)).resolves.toEqual({
      userId: "AB1234", password: "s3cret", totpSecret: "JBSWY3DPEHPK3PXP",
    });
  });

  it("Update Vault: saving again updates the same entry", async () => {
    const first = await saveBrokerSecretsToVault("kite", { apiKey: "a", clientId: "AB1234", password: "p1" });
    const second = await saveBrokerSecretsToVault("kite", { apiKey: "a", clientId: "AB1234", password: "p2", totpSecret: "JBSWY3DPEHPK3PXP" });
    expect(second).toEqual({ entryId: first.entryId, created: false });
    await expect(loadBrokerSecretsFromVault("kite")).resolves.toMatchObject({
      clientId: "AB1234", password: "p2", totpSecret: "JBSWY3DPEHPK3PXP", apiKey: "a",
    });
  });

  it("works when only a TOTP key is given", async () => {
    const { entryId } = await saveBrokerSecretsToVault("kite", { apiKey: "a", clientId: "", password: "", totpSecret: "JBSWY3DPEHPK3PXP" });
    await expect(getKiteLoginSecrets(entryId)).resolves.toMatchObject({ totpSecret: "JBSWY3DPEHPK3PXP" });
  });
});

import { createVaultEntry } from "../../services/vault";

describe("Zerodha credentials save over existing Vault data", () => {
  async function account(): Promise<string> {
    const cols = (mockDb.prepare("PRAGMA table_info(financial_accounts)").all() as { name: string; notnull: number; dflt_value: unknown }[]);
    const vals: Record<string, unknown> = { id: "acc_demat", user_id: "default_user", account_type: "demat", bank_name: "Zerodha" };
    for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in vals)) vals[c.name] = c.name.endsWith("_at") ? "2026-01-01" : "x";
    const keys = Object.keys(vals);
    mockDb.exec("PRAGMA foreign_keys = OFF");
    mockDb.prepare(`INSERT INTO financial_accounts (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...(Object.values(vals) as never[]));
    mockDb.exec("PRAGMA foreign_keys = ON");
    return "acc_demat";
  }

  it("updates the old 'Zerodha Kite API' entry (API key saved as its password)", async () => {
    const old = await createVaultEntry({
      title: "Zerodha Kite API", category: "demat", login_method: "password", password: "apikey123",
      url: "https://developers.kite.trade/apps", notes: "Kite Connect API key used by Arth for portfolio sync",
    });
    const r = await saveBrokerSecretsToVault("kite", { apiKey: "apikey123", clientId: "AB1234", password: "pw", totpSecret: "JBSWY3DPEHPK3PXP" });
    expect(r.entryId).toBe(old);
    await expect(getKiteLoginSecrets(r.entryId)).resolves.toEqual({ userId: "AB1234", password: "pw", totpSecret: "JBSWY3DPEHPK3PXP" });
  });

  it("updates a hand-made Demat entry linked to an account and picked for the login fill", async () => {
    const acc = await account();
    const id = await createVaultEntry({
      title: "Zerodha", category: "demat", login_method: "password", username: "AB1234", password: "old",
      linked_account_id: acc, renewal_date: "2027-01-01", custom_fields_data: { tpin: "1234" },
    });
    setKiteVaultEntryId(id);
    const r = await saveBrokerSecretsToVault("kite", { apiKey: "a", clientId: "AB1234", password: "new", totpSecret: "JBSWY3DPEHPK3PXP" });
    expect(r.entryId).toBe(id);
    await expect(getKiteLoginSecrets(id)).resolves.toEqual({ userId: "AB1234", password: "new", totpSecret: "JBSWY3DPEHPK3PXP" });
  });
});

describe("Kite secure storage that can't be read", () => {
  it("treats an unreadable API key or session as not saved instead of throwing", async () => {
    const SecureStore = require("expo-secure-store");
    const original = SecureStore.getItemAsync;
    SecureStore.getItemAsync = async () => { throw new Error("Could not decrypt the value"); };
    try {
      const { getKiteApiKey, getKiteCredentials } = require("../../services/kite-connect");
      await expect(getKiteApiKey()).resolves.toBeNull();
      await expect(getKiteCredentials()).resolves.toBeNull();
    } finally {
      SecureStore.getItemAsync = original;
    }
  });
});
