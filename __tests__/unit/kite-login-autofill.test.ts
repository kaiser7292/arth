const mockStorage = new Map<string, string>();
const mockEntries: Record<string, any> = {};

jest.mock("../../services/storage", () => ({
  settingsStorage: {
    getString: jest.fn((key: string) => mockStorage.get(key)),
    set: jest.fn((key: string, value: string) => { mockStorage.set(key, value); }),
    delete: jest.fn((key: string) => { mockStorage.delete(key); }),
  },
}));

jest.mock("../../services/vault", () => ({
  getVaultEntries: jest.fn(async () => Object.values(mockEntries)),
  getVaultEntry: jest.fn(async (id: string) => mockEntries[id] ?? null),
  decryptField: jest.fn(async (enc: string) => enc.replace(/^enc:/, "")),
  decryptCustomFields: jest.fn(async (enc: string | null) => (enc ? JSON.parse(enc) : {})),
}));

import {
  buildLoginFillJs,
  buildTotpFillJs,
  getKiteLoginCandidates,
  getKiteLoginSecrets,
  getKiteVaultEntryId,
  isKiteLoginUrl,
  setKiteVaultEntryId,
} from "@/services/kite-login-autofill";

function entry(id: string, over: Record<string, any> = {}) {
  return {
    id, title: id, category: "demat", login_method: "password",
    username: null, email: null, phone: null, password_enc: null, pin_enc: null,
    url: null, notes: null, custom_fields: null, renewal_date: null,
    linked_account_id: null, created_at: "", updated_at: null, deleted_at: null,
    ...over,
  };
}

beforeEach(() => {
  mockStorage.clear();
  for (const k of Object.keys(mockEntries)) delete mockEntries[k];
});

describe("isKiteLoginUrl", () => {
  it.each([
    "https://kite.zerodha.com",
    "https://kite.zerodha.com/",
    "https://kite.zerodha.com/connect/login?api_key=x&v=3",
    "https://kite.zerodha.com?x=1",
  ])("accepts %s", (url) => expect(isKiteLoginUrl(url)).toBe(true));

  it.each([
    undefined,
    "",
    "http://kite.zerodha.com/",
    "https://kite.zerodha.com.evil.com/",
    "https://evil.com/?https://kite.zerodha.com/",
    "https://notkite.zerodha.com/",
    "https://kite.zerodha.community/",
  ])("rejects %s", (url) => expect(isKiteLoginUrl(url as any)).toBe(false));
});

describe("vault entry link", () => {
  it("stores and clears the chosen entry id", () => {
    expect(getKiteVaultEntryId()).toBeNull();
    setKiteVaultEntryId("v1");
    expect(getKiteVaultEntryId()).toBe("v1");
    setKiteVaultEntryId(null);
    expect(getKiteVaultEntryId()).toBeNull();
  });
});

describe("getKiteLoginCandidates", () => {
  it("excludes entries without a login ID or password (e.g. the API key entry)", async () => {
    mockEntries.api = entry("api", { password_enc: "enc:apikey" });
    mockEntries.nopw = entry("nopw", { username: "AB1234" });
    mockEntries.ok = entry("ok", { username: "AB1234", password_enc: "enc:pw" });
    const ids = (await getKiteLoginCandidates()).map((e) => e.id);
    expect(ids).toEqual(["ok"]);
  });
});

describe("getKiteLoginSecrets", () => {
  it("returns user ID, password and TOTP secret", async () => {
    mockEntries.z = entry("z", {
      username: "AB1234",
      password_enc: "enc:secret",
      custom_fields: JSON.stringify({ totp_secret: "JBSWY3DPEHPK3PXP" }),
    });
    await expect(getKiteLoginSecrets("z")).resolves.toEqual({
      userId: "AB1234", password: "secret", totpSecret: "JBSWY3DPEHPK3PXP",
    });
  });

  it("falls back to phone as the login ID and allows no TOTP secret", async () => {
    mockEntries.z = entry("z", { login_method: "phone_otp", phone: "9999999999", password_enc: "enc:pw" });
    await expect(getKiteLoginSecrets("z")).resolves.toEqual({
      userId: "9999999999", password: "pw", totpSecret: null,
    });
  });

  it("returns null for a missing entry or one without a password", async () => {
    mockEntries.z = entry("z", { username: "AB1234" });
    await expect(getKiteLoginSecrets("z")).resolves.toBeNull();
    await expect(getKiteLoginSecrets("missing")).resolves.toBeNull();
  });
});

describe("fill scripts", () => {
  it("embeds values as escaped JS string literals", () => {
    const pw = `a"b'c\\d</script>\n`;
    const js = buildLoginFillJs("AB1234", pw);
    expect(js).toContain(JSON.stringify(pw));
    expect(js).toContain(JSON.stringify("AB1234"));
    expect(() => new Function(js)).not.toThrow();
  });

  it("builds a syntactically valid TOTP fill script", () => {
    const js = buildTotpFillJs("012345");
    expect(js).toContain('"012345"');
    expect(() => new Function(js)).not.toThrow();
  });
});
