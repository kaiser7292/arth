/** One-tap Sync: which brokers run, and one broker's trouble staying its own. Made-up values. */

const mockSave = jest.fn(async (_id: string, portfolio: number, fund: number) => ({ portfolio, fund }));
const mockAngel = jest.fn();
const mockKite = jest.fn();
const mockZebpay = jest.fn();
let mockLinks: Record<string, string | null>;
let mockKiteExpired: boolean;
let mockKiteKey: string | null;
let mockAngelOn: boolean;
let mockZebpayOn: boolean;

jest.mock("@/services/financial-account", () => ({ saveBrokerSnapshot: (a: string, b: number, c: number) => mockSave(a, b, c) }));
jest.mock("@/services/broker-link", () => ({ getBrokerLinkedAccount: (b: string) => mockLinks[b] ?? null }));
jest.mock("@/services/angel-connect", () => ({
  isAngelConnected: () => mockAngelOn,
  getAngelCredentials: async () => null,
  syncAngelData: () => mockAngel(),
}));
jest.mock("@/services/kite-connect", () => ({
  getKiteCredentials: async () => (mockKiteKey ? { apiKey: mockKiteKey } : null),
  isKiteTokenExpired: () => mockKiteExpired,
  syncKiteData: () => mockKite(),
}));
jest.mock("@/services/zebpay-connect", () => ({
  isZebpayConnected: () => mockZebpayOn,
  syncZebpayData: () => mockZebpay(),
}));

import { getConnectedBrokers, syncAllBrokers, syncBroker } from "../../services/broker-sync";

beforeEach(() => {
  jest.clearAllMocks();
  mockLinks = { angel: "acc-a", zebpay: "acc-z" };
  mockKiteExpired = false;
  mockKiteKey = "k";
  mockAngelOn = true;
  mockZebpayOn = true;
  mockKite.mockResolvedValue({ linkedAccountId: "acc-k", portfolioTotal: 1000, fundsAvailable: 50 });
  mockAngel.mockResolvedValue({ holdings: [{}], totalHolding: { totalholdingvalue: "2000.5" }, funds: { availablecash: "75" } });
  mockZebpay.mockResolvedValue({ totalInr: 300, inrBalance: 10 });
});

describe("broker sync", () => {
  it("lists only what's connected, so no broker means no button", async () => {
    expect(await getConnectedBrokers()).toEqual(["kite", "angel", "zebpay"]);
    mockKiteKey = null;
    mockAngelOn = false;
    mockZebpayOn = false;
    expect(await getConnectedBrokers()).toEqual([]);
  });

  it("syncs each and saves today's snapshot", async () => {
    const r = await syncAllBrokers();
    expect(r).toEqual([
      { broker: "kite", status: "saved", portfolio: 1000, fund: 50 },
      { broker: "angel", status: "saved", portfolio: 2000.5, fund: 75 },
      { broker: "zebpay", status: "saved", portfolio: 300, fund: 10 },
    ].map(({ fund, ...rest }) => ({ ...rest, fund })));
    expect(mockSave).toHaveBeenCalledWith("acc-a", 2000.5, 75);
  });

  it("an expired Zerodha login asks for a login, and the others still save", async () => {
    mockKiteExpired = true;
    const r = await syncAllBrokers();
    expect(r[0]).toEqual({ broker: "kite", status: "needs_login" });
    expect(r[1].status).toBe("saved");
    expect(mockKite).not.toHaveBeenCalled();
  });

  it("a Zerodha session refused early is treated the same way", async () => {
    mockKite.mockRejectedValue(new Error("Incorrect `api_key` or `access_token`."));
    expect(await syncBroker("kite")).toEqual({ broker: "kite", status: "needs_login" });
  });

  it("no linked account asks for one, and saves nothing", async () => {
    mockLinks.angel = null;
    expect(await syncBroker("angel")).toEqual({ broker: "angel", status: "needs_account" });
    expect(mockAngel).not.toHaveBeenCalled();
    mockKite.mockRejectedValue(new Error("NO_ACCOUNT_LINKED"));
    expect(await syncBroker("kite")).toEqual({ broker: "kite", status: "needs_account" });
  });

  it("one failure is reported and doesn't stop the rest", async () => {
    mockAngel.mockRejectedValue(new Error("Couldn't reach Angel One."));
    const r = await syncAllBrokers();
    expect(r[1]).toEqual({ broker: "angel", status: "failed", message: "Couldn't reach Angel One." });
    expect(r[0].status).toBe("saved");
    expect(r[2].status).toBe("saved");
  });

  it("holdings with no total never save a false zero", async () => {
    mockAngel.mockResolvedValue({ holdings: [{}], totalHolding: null, funds: null });
    expect((await syncBroker("angel")).status).toBe("failed");
    expect(mockSave).not.toHaveBeenCalled();
  });
});
