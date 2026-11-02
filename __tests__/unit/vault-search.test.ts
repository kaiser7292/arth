import { removedVaultSecrets, vaultEntryMatches, type VaultEntry } from "../../services/vault";

jest.mock("@/database", () => ({ getDatabase: jest.fn() }));

const entry = (over: Partial<VaultEntry>) =>
  ({ title: "Sample Bank", category: "banking", login_method: "password", username: null, email: null, phone: null, url: null, notes: null, ...over }) as VaultEntry;

describe("vaultEntryMatches", () => {
  it("finds by anything stored in the clear, ignoring case", () => {
    expect(vaultEntryMatches(entry({}), "sample")).toBe(true);
    expect(vaultEntryMatches(entry({ username: "user_1" }), "USER_1")).toBe(true);
    expect(vaultEntryMatches(entry({ email: "a@example.com" }), "example")).toBe(true);
    expect(vaultEntryMatches(entry({ phone: "9000000000" }), "9000")).toBe(true);
    expect(vaultEntryMatches(entry({ url: "bank.example" }), "bank.ex")).toBe(true);
    expect(vaultEntryMatches(entry({ notes: "joint account" }), "joint")).toBe(true);
  });

  it("finds by the entry's type and login method", () => {
    expect(vaultEntryMatches(entry({ category: "gaming" }), "gaming")).toBe(true);
    expect(vaultEntryMatches(entry({ login_method: "phone_otp" }), "otp")).toBe(true);
  });

  it("never looks inside secrets", () => {
    expect(vaultEntryMatches(entry({ password_enc: "hunter2" }), "hunter2")).toBe(false);
    expect(vaultEntryMatches(entry({ custom_fields: "hunter2" }), "hunter2")).toBe(false);
  });

  it("a blank search matches everything", () => {
    expect(vaultEntryMatches(entry({}), "  ")).toBe(true);
  });
});

describe("removedVaultSecrets", () => {
  it("names what was saved and is now blank", () => {
    expect(removedVaultSecrets({ password: "a", mpin: "1" }, { password: "", mpin: " " })).toEqual(["password", "MPIN"]);
  });

  it("is quiet about a changed secret, a new one, or a plain field", () => {
    expect(removedVaultSecrets({ password: "a" }, { password: "b" })).toEqual([]);
    expect(removedVaultSecrets({}, { password: "b" })).toEqual([]);
    expect(removedVaultSecrets({ expiry: "12/30" }, {})).toEqual([]);
  });
});
