const mockStore = new Map<string, string>();
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: (k: string) => mockStore.get(k),
    set: (k: string, v: string) => mockStore.set(k, v),
    delete: (k: string) => mockStore.delete(k),
    getBoolean: () => undefined,
    getNumber: () => undefined,
    getAllKeys: () => [...mockStore.keys()],
    contains: (k: string) => mockStore.has(k),
  })),
}));
jest.mock("@/services/kite-connect", () => ({
  getLinkedAccountId: () => mockStore.get("kite_linked"),
  getCachedHoldings: () => JSON.parse(mockStore.get("kite_h") ?? "[]"),
  getCachedMFHoldings: () => [],
  getLastSynced: () => "2026-11-04T09:00:00.000Z",
}));
jest.mock("@/services/angel-connect", () => ({ getCachedAngelHoldings: () => [], getAngelLastSynced: () => null }));
jest.mock("@/services/zebpay-connect", () => ({ getZebpayCache: () => ({ balances: [] }), getZebpayLastSynced: () => null }));

import { getHoldingsForAccount } from "@/services/demat-holdings";

const stock = (tradingsymbol: string, quantity: number, last_price: number) => ({
  tradingsymbol, isin: tradingsymbol, quantity, t1_quantity: 0, average_price: 10, last_price, pnl: 0,
});

describe("holdings on a demat account", () => {
  beforeEach(() => mockStore.clear());

  it("shows the linked broker's holdings, biggest first", () => {
    mockStore.set("kite_linked", "zerodha");
    mockStore.set("kite_h", JSON.stringify([stock("SMALL", 1, 10), stock("BIG", 100, 10)]));
    const [h] = getHoldingsForAccount("zerodha");
    expect(h.brokerLabel).toBe("Zerodha");
    expect(h.rows.map((r) => r.title)).toEqual(["BIG", "SMALL"]);
    expect(h.lastSynced).toBe("2026-11-04T09:00:00.000Z");
    expect(h.current).toBe(1010);
    expect(h.invested).toBe(1010);
  });

  it("lists every holding, not just the biggest", () => {
    mockStore.set("kite_linked", "zerodha");
    mockStore.set("kite_h", JSON.stringify(Array.from({ length: 12 }, (_, i) => stock(`S${i}`, 1, 10))));
    expect(getHoldingsForAccount("zerodha")[0].rows).toHaveLength(12);
  });

  it("shows nothing on an account no broker is linked to", () => {
    mockStore.set("kite_linked", "zerodha");
    mockStore.set("kite_h", JSON.stringify([stock("BIG", 100, 10)]));
    expect(getHoldingsForAccount("groww")).toEqual([]);
  });

  it("shows nothing when the linked broker holds nothing", () => {
    mockStore.set("kite_linked", "zerodha");
    expect(getHoldingsForAccount("zerodha")).toEqual([]);
  });
});
