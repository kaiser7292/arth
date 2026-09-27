/**
 * Broker credentials <-> Vault: saved under the Vault's own field names (so the Vault shows them),
 * updated in place rather than duplicated, and read back for "Fill from Vault" after a restore.
 */

type Entry = {
  id: string;
  title: string;
  category: string;
  login_method: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  password_enc: string | null;
  custom_fields: string | null;
  url: string | null;
  notes: string | null;
  renewal_date: string | null;
  linked_account_id: string | null;
};

const mockEntries: Entry[] = [];
const mockSettings = new Map<string, string>();

jest.mock("@/services/storage", () => ({
  settingsStorage: {
    getString: (k: string) => mockSettings.get(k),
    set: (k: string, v: string) => void mockSettings.set(k, v),
    delete: (k: string) => void mockSettings.delete(k),
  },
}));

// "Encryption" is JSON here - the Vault's own crypto isn't what's under test.
jest.mock("@/services/vault", () => {
  let n = 0;
  return {
    decryptField: async (s: string) => s,
    decryptCustomFields: async (s: string | null) => (s ? JSON.parse(s) : {}),
    getVaultEntry: async (id: string) => mockEntries.find((e) => e.id === id) ?? null,
    searchVaultEntries: async (q: string) =>
      mockEntries.filter((e) => e.title.toLowerCase().includes(q.toLowerCase())),
    createVaultEntry: async (input: Record<string, unknown>) => {
      const id = `v${++n}`;
      mockEntries.push({
        id,
        title: input.title as string,
        category: input.category as string,
        login_method: input.login_method as string,
        username: (input.username as string) ?? null,
        email: null,
        phone: null,
        password_enc: (input.password as string) ?? null,
        custom_fields: input.custom_fields_data ? JSON.stringify(input.custom_fields_data) : null,
        url: (input.url as string) ?? null,
        notes: (input.notes as string) ?? null,
        renewal_date: null,
        linked_account_id: null,
      });
      return id;
    },
    updateVaultEntry: async (id: string, input: Record<string, unknown>) => {
      const e = mockEntries.find((x) => x.id === id)!;
      // Mirrors the real updateVaultEntry: text columns it isn't given become NULL.
      e.username = (input.username as string) ?? null;
      e.url = (input.url as string) ?? null;
      e.notes = (input.notes as string) ?? null;
      if (input.password !== undefined) e.password_enc = input.password as string;
      if (input.custom_fields_data) e.custom_fields = JSON.stringify(input.custom_fields_data);
    },
  };
});

import {
  loadBrokerSecretsFromVault,
  normalizeCustomFields,
  saveBrokerSecretsToVault,
} from "../../services/broker-vault";

beforeEach(() => {
  mockEntries.length = 0;
  mockSettings.clear();
});

describe("broker credentials in the Vault", () => {
  it("saves Angel's API key and TOTP secret where the Vault shows them, and reads them back", async () => {
    const { created } = await saveBrokerSecretsToVault("angel", {
      apiKey: "key1",
      clientId: "S123",
      password: "1234",
      totpSecret: "abcd efgh ijkl mnop",
    });
    expect(created).toBe(true);
    expect(JSON.parse(mockEntries[0].custom_fields!)).toEqual({ api_key: "key1", totp_secret: "ABCDEFGHIJKLMNOP" });
    expect(await loadBrokerSecretsFromVault("angel")).toEqual({
      clientId: "S123",
      password: "1234",
      apiKey: "key1",
      apiSecret: undefined,
      totpSecret: "ABCDEFGHIJKLMNOP",
    });
  });

  it("updates the existing entry instead of making a second one, keeping what it already had", async () => {
    await saveBrokerSecretsToVault("zebpay", { apiKey: "k", apiSecret: "s" });
    const e = mockEntries[0];
    e.custom_fields = JSON.stringify({ ...JSON.parse(e.custom_fields!), statement_password: "pdf" });

    const { created } = await saveBrokerSecretsToVault("zebpay", { apiKey: "k2", apiSecret: "s2" });
    expect(created).toBe(false);
    expect(mockEntries).toHaveLength(1);
    expect(JSON.parse(e.custom_fields!)).toEqual({ api_key: "k2", api_secret: "s2", statement_password: "pdf" });
    expect(e.url).toBe("https://www.zebpay.com"); // not wiped by the update
  });

  it("reads entries saved by the old Angel button (\"API Key\" / \"TOTP Secret\")", async () => {
    mockEntries.push({
      id: "old",
      title: "Angel One SmartAPI",
      category: "demat",
      login_method: "password",
      username: "S123",
      email: null,
      phone: null,
      password_enc: "pw",
      custom_fields: JSON.stringify({ "API Key": "k", "TOTP Secret": "SECRET" }),
      url: null,
      notes: null,
      renewal_date: null,
      linked_account_id: null,
    });
    expect(await loadBrokerSecretsFromVault("angel")).toMatchObject({ apiKey: "k", totpSecret: "SECRET", password: "pw" });
  });

  it("reads the old Kite entry, which kept the API key in the password field", async () => {
    mockEntries.push({
      id: "k",
      title: "Zerodha Kite API",
      category: "demat",
      login_method: "password",
      username: null,
      email: null,
      phone: null,
      password_enc: "kiteKey",
      custom_fields: null,
      url: null,
      notes: null,
      renewal_date: null,
      linked_account_id: null,
    });
    expect(await loadBrokerSecretsFromVault("kite")).toEqual({ apiKey: "kiteKey" });
  });

  it("returns null when the Vault has nothing for the broker", async () => {
    expect(await loadBrokerSecretsFromVault("angel")).toBeNull();
  });

  it("normalizeCustomFields maps legacy names and keeps everything else", () => {
    expect(normalizeCustomFields({ "API Key": "a", "Secret Key": "b", tpin: "1" })).toEqual({
      api_key: "a",
      api_secret: "b",
      tpin: "1",
    });
  });
});
