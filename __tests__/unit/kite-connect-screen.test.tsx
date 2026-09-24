import React from "react";
import { render, waitFor } from "@testing-library/react-native";

jest.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light", setColorScheme: jest.fn() }),
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("expo-linking", () => ({ parse: jest.fn(() => ({ queryParams: {} })) }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));
jest.mock("react-native-webview", () => ({ WebView: () => null }));
jest.mock("../../hooks/use-alert", () => ({ useAlert: () => jest.fn() }));
const mockStorage = new Map<string, string>();
jest.mock("../../services/storage", () => ({
  settingsStorage: {
    getString: jest.fn((k: string) => mockStorage.get(k)),
    getBoolean: jest.fn(() => undefined),
    getNumber: jest.fn(() => undefined),
    set: jest.fn((k: string, v: string) => { mockStorage.set(k, v); }),
    delete: jest.fn((k: string) => { mockStorage.delete(k); }),
    contains: jest.fn(() => false),
  },
}));
jest.mock("../../services/financial-account", () => ({
  addOrUpdateSnapshot: jest.fn(),
  updateFundBalance: jest.fn(),
}));
jest.mock("../../services/vault", () => ({ getVaultEntry: jest.fn(async () => null) }));
jest.mock("../../services/kite-login-autofill", () => ({
  KITE_LOGIN_WATCHER_JS: "",
  buildLoginFillJs: jest.fn(),
  buildTotpFillJs: jest.fn(),
  getKiteLoginCandidates: jest.fn(async () => []),
  getKiteLoginSecrets: jest.fn(async () => null),
  getKiteVaultEntryId: jest.fn(() => null),
  isKiteLoginUrl: jest.fn(() => true),
  setKiteVaultEntryId: jest.fn(),
}));

const mockCache: Record<string, any> = {};
jest.mock("../../services/kite-connect", () => ({
  clearKiteCredentials: jest.fn(),
  clearKiteSession: jest.fn(),
  exchangeRequestToken: jest.fn(),
  getCachedHoldings: () => mockCache.holdings,
  getCachedMFHoldings: () => mockCache.mf,
  getCachedMFOrders: () => mockCache.mfOrders,
  getCachedOrders: () => mockCache.orders,
  getCachedPositions: () => mockCache.positions,
  getCachedSIPs: () => mockCache.sips,
  getCachedTotals: () => ({ portfolio: 204816, funds: 1200 }),
  getDematAccountsForPicker: jest.fn(async () => []),
  getKiteCredentials: jest.fn(async () => ({ apiKey: "k" })),
  getKiteLoginUrl: jest.fn(() => "https://kite.zerodha.com/connect/login"),
  getLastSynced: () => "2026-09-24T04:49:00.000Z",
  getLinkedAccountId: () => "acc1",
  isKiteAuthenticated: jest.fn(async () => true),
  isKiteTokenExpired: () => false,
  setLinkedAccountId: jest.fn(),
  storeKiteAccessToken: jest.fn(),
  syncKiteData: jest.fn(),
}));

import KiteConnectScreen from "../../app/settings/kite-connect";

let caught: Error | null = null;
class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: Error) { caught = e; }
  render() { return this.state.failed ? null : this.props.children; }
}
function renderScreen() {
  caught = null;
  return render(<Boundary><KiteConnectScreen /></Boundary>);
}
afterEach(() => {
  if (caught) throw new Error(`Screen crashed: ${caught.message}\n${caught.stack}`);
});

function setCache() {
  mockCache.holdings = [{
    tradingsymbol: "IBULLSLTD", exchange: "NSE", isin: "INE1", quantity: 690, t1_quantity: 0,
    average_price: 30.4, last_price: 28.41, close_price: 29, pnl: -1373.1, day_change_percentage: -2.44,
  }];
  mockCache.mf = [{
    folio: "F1", fund: "HDFC NIFTY 50 INDEX FUND - DIRECT PLAN", tradingsymbol: "INF179K01XQ0",
    average_price: 238.13, last_price: 229.19, last_price_date: "2026-09-19", quantity: 132.688, pledged_quantity: 0, pnl: 0,
  }];
  mockCache.positions = [];
  mockCache.sips = [{
    sip_id: "s1", fund: "PARAG PARIKH ELSS", tradingsymbol: "INF1", status: "ACTIVE", frequency: "monthly",
    instalment_amount: 5000, instalments_remaining: -1, next_instalment: "2026-10-05", instalment_day: 5,
  }];
  mockCache.orders = [];
  mockCache.mfOrders = [{
    // Kite's real /mf/orders shape: transaction_type and average_price, no order_type or price.
    order_id: "o1", fund: "HDFC NIFTY 50 INDEX FUND - DIRECT PLAN", tradingsymbol: "INF1", status: "COMPLETE",
    transaction_type: "BUY", amount: 5000, quantity: 21.8, average_price: 229.2, order_timestamp: "2026-09-20 10:00:00",
    folio: "F1", last_price: 229.19,
  }];
}

describe("Kite Connect screen", () => {
  beforeEach(() => { mockStorage.clear(); setCache(); });

  it("renders a synced portfolio without throwing", async () => {
    const { findByText, findAllByText } = renderScreen();
    expect(await findByText("IBULLSLTD")).toBeTruthy();
    expect(await findAllByText("HDFC NIFTY 50 INDEX FUND - DIRECT PLAN")).toHaveLength(2);
    expect(await findByText("21.8 units · @ ₹229.2")).toBeTruthy();
  });

  it("survives every field being missing or null", async () => {
    const strip = (o: Record<string, unknown>, keep: string[]) =>
      Object.fromEntries(Object.keys(o).map((k) => [k, keep.includes(k) ? o[k] : null]));
    mockCache.holdings = mockCache.holdings.map((h: any) => strip(h, ["tradingsymbol"]));
    mockCache.mf = mockCache.mf.map((h: any) => strip(h, []));
    mockCache.sips = mockCache.sips.map((h: any) => strip(h, []));
    mockCache.mfOrders = mockCache.mfOrders.map((h: any) => strip(h, []));
    mockCache.positions = [{ tradingsymbol: "NIFTY" }];
    mockCache.orders = [{ order_id: "x" }];
    const { findByText } = renderScreen();
    await waitFor(async () => expect(await findByText("IBULLSLTD")).toBeTruthy());
  });
});
