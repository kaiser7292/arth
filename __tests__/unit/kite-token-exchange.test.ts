/**
 * Bring-your-own-key Kite login: the request_token is exchanged directly with Zerodha
 * using the user's own secret, which never leaves the phone (only its checksum does).
 */
import { createHash } from "crypto";

const mockSecure: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockSecure[k] = v;
  }),
  getItemAsync: jest.fn(async (k: string) => mockSecure[k] ?? null),
  deleteItemAsync: jest.fn(async (k: string) => {
    delete mockSecure[k];
  }),
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: jest.fn(async (_alg: string, data: string) =>
    require("crypto").createHash("sha256").update(data).digest("hex"),
  ),
}));
jest.mock("../../services/storage", () => ({
  settingsStorage: { getString: jest.fn(), set: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../database", () => ({ getDatabase: jest.fn() }));

import {
  clearKiteCredentials,
  exchangeRequestToken,
  getKiteApiSecret,
  storeKiteApiKey,
  storeKiteApiSecret,
} from "../../services/kite-connect";

const fetchMock = jest.fn();
(global as any).fetch = fetchMock;

function ok(data: object) {
  return { ok: true, status: 200, json: async () => ({ status: "success", data }) };
}

describe("exchangeRequestToken (on-device, BYOK)", () => {
  beforeEach(() => {
    for (const k in mockSecure) delete mockSecure[k];
    fetchMock.mockReset();
  });

  it("posts the checksum to Zerodha and never sends the secret", async () => {
    await storeKiteApiKey("key1");
    await storeKiteApiSecret("sec1");
    fetchMock.mockResolvedValue(ok({ access_token: "at", user_id: "AB1234", public_token: "pt", extra: 1 }));

    const res = await exchangeRequestToken("rt1");

    expect(res).toEqual({ access_token: "at", user_id: "AB1234", public_token: "pt" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.kite.trade/session/token");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Kite-Version"]).toBe("3");
    const body = new URLSearchParams(init.body);
    expect(body.get("api_key")).toBe("key1");
    expect(body.get("request_token")).toBe("rt1");
    expect(body.get("checksum")).toBe(createHash("sha256").update("key1rt1sec1").digest("hex"));
    expect(init.body).not.toContain("sec1");
  });

  it("asks for the secret instead of calling Zerodha when it is missing", async () => {
    await storeKiteApiKey("key1");
    await expect(exchangeRequestToken("rt1")).rejects.toThrow(/API secret/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows Zerodha's own error message", async () => {
    await storeKiteApiKey("key1");
    await storeKiteApiSecret("sec1");
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ status: "error", message: "Invalid checksum", error_type: "TokenException" }),
    });
    await expect(exchangeRequestToken("rt1")).rejects.toThrow("Invalid checksum");
  });

  it("clears the secret with the other credentials", async () => {
    await storeKiteApiSecret("sec1");
    await clearKiteCredentials();
    await expect(getKiteApiSecret()).resolves.toBeNull();
  });
});
