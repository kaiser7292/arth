/** Angel One sync when the session has ended, or a call fails. All values made up. */

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
jest.mock("@/database", () => ({
  getDatabase: () => ({
    runAsync: async () => ({ changes: 1 }),
    getAllAsync: async () => [],
    getFirstAsync: async () => null,
  }),
}));

import { getCachedAngelHoldings, storeAngelCredentials, syncAngelData } from "../../services/angel-connect";

const LOGIN = "loginByPassword";
const ok = (data: unknown) => ({ status: 200, json: async () => ({ status: true, data }) });
const refused = (code = "AG8001") => ({ status: 200, json: async () => ({ status: false, errorcode: code, message: "Invalid Token" }) });
const holding = { tradingsymbol: "ABC" };

let session: string;
let validSessions: Set<string>;
let logins: number;
let network: "up" | "down";

function install() {
  (global as { fetch: unknown }).fetch = jest.fn(async (url: string, init: { headers: Record<string, string> }) => {
    if (network === "down") throw new Error("Network request failed");
    if (url.includes(LOGIN)) {
      logins += 1;
      session = `jwt${logins}`;
      validSessions.add(session);
      return ok({ jwtToken: session, refreshToken: "r" });
    }
    if (!validSessions.has((init.headers.Authorization ?? "").replace("Bearer ", ""))) return refused();
    if (url.includes("getAllHolding")) return ok({ holdings: [holding], totalholding: { totalholdingvalue: 100 } });
    if (url.includes("getRMS")) return ok({ net: "1" });
    return ok([]);
  });
}

beforeEach(async () => {
  mockKv.clear();
  mockSecure.clear();
  session = "old";
  validSessions = new Set();
  logins = 0;
  network = "up";
  await storeAngelCredentials("key", "A1", "pw", "JBSWY3DPEHPK3PXP");
  mockSecure.set("angel_jwt_token", "old");
  mockSecure.set("angel_refresh_token", "r");
  // Our clock says the session has hours left; Angel One may disagree.
  install();
});

const seedClock = (keys: string[]) => {
  for (const k of keys) mockKv.set(k, String(Date.now() + 3_600_000));
};

describe("syncAngelData", () => {
  beforeEach(() => seedClock(["angel_token_expiry"]));

  it("logs in again by itself when Angel One has ended the session, then syncs", async () => {
    const r = await syncAngelData();
    expect(logins).toBe(1);
    expect(r.holdings).toEqual([holding]);
    expect(getCachedAngelHoldings()).toEqual([holding]);
  });

  it("doesn't log in when the session is still good", async () => {
    validSessions.add("old");
    await syncAngelData();
    expect(logins).toBe(0);
  });

  it("a network failure keeps the saved data and says so", async () => {
    validSessions.add("old");
    await syncAngelData();
    network = "down";
    await expect(syncAngelData()).rejects.toThrow(/Couldn't reach Angel One/);
    expect(getCachedAngelHoldings()).toEqual([holding]);
  });

  it("if the new login is refused too, it says so rather than showing an empty sync", async () => {
    validSessions.add("old");
    await syncAngelData();
    validSessions.clear();
    (global.fetch as jest.Mock).mockImplementation(async (url: string) =>
      url.includes(LOGIN) ? ok({ jwtToken: "bad", refreshToken: "r" }) : refused("AG8002"),
    );
    await expect(syncAngelData()).rejects.toThrow(/didn't accept the sign-in/);
    expect(getCachedAngelHoldings()).toEqual([holding]);
  });

  it("one failed part keeps its saved copy while the rest update", async () => {
    validSessions.add("old");
    await syncAngelData();
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes("getAllHolding")) throw new Error("Network request failed");
      return ok([]);
    });
    const r = await syncAngelData();
    expect(r.holdings).toEqual([holding]);
    expect(r.orders).toEqual([]);
  });

  it("really having no holdings does empty the list", async () => {
    validSessions.add("old");
    await syncAngelData();
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => (url.includes("getAllHolding") ? ok(null) : ok([])));
    const r = await syncAngelData();
    expect(r.holdings).toEqual([]);
  });
});
