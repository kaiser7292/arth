import { DatabaseSync } from "node:sqlite";

/** Broker records are off until switched on, and off really means off. On the real schema. */
let mockDb: DatabaseSync;
const mockStore = new Map<string, unknown>();
const flat = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params);
const mockAdapter = {
  execAsync: async (sql: string) => { mockDb.exec(sql); },
  runAsync: async (sql: string, ...params: unknown[]) => {
    const r = mockDb.prepare(sql).run(...(flat(params) as never[]));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).all(...(flat(params) as never[])),
  getFirstAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).get(...(flat(params) as never[])) ?? null,
  withTransactionAsync: async (fn: () => Promise<void>) => {
    mockDb.exec("BEGIN");
    try { await fn(); mockDb.exec("COMMIT"); } catch (e) { mockDb.exec("ROLLBACK"); throw e; }
  },
};
jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: (k: string) => mockStore.get(k), getNumber: (k: string) => mockStore.get(k), getString: (k: string) => mockStore.get(k),
    set: (k: string, v: unknown) => { mockStore.set(k, v); }, delete: (k: string) => { mockStore.delete(k); }, getAllKeys: () => [...mockStore.keys()], contains: (k: string) => mockStore.has(k),
  })),
}));
const mockKite = jest.fn();
jest.mock("@/services/kite-connect", () => ({
  getKiteCredentials: async () => ({ apiKey: "k", accessToken: "t" }),
  getKiteDayRecords: (...a: unknown[]) => mockKite(...a),
  getLinkedAccountId: () => "acc",
  isKiteTokenExpired: () => false,
}));
jest.mock("@/services/angel-connect", () => ({ getAngelCredentials: async () => null, getAngelDayRecords: jest.fn(), isAngelConnected: () => false }));
jest.mock("@/services/zebpay-connect", () => ({ getZebpayCache: () => ({ balances: [] }), getZebpayOrderFills: jest.fn(), isZebpayConnected: () => false }));

import { runMigrations } from "../../database/migrations";
import { captureAllBrokers, captureBroker, connectedApiBrokers } from "../../services/broker-history/capture";
import { isBrokerHistoryOn, setBrokerHistoryOn } from "../../services/broker-history/enabled";
import { getDetectedMoney } from "../../services/broker-history/history";
import { setPartOn } from "../../services/customise";

const U = "default-user";

beforeEach(async () => {
  mockStore.clear();
  mockKite.mockReset();
  mockKite.mockResolvedValue({ trades: [], mfOrders: [], holdings: [], payin: 0, payout: 0 });
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
  mockDb.exec(`
    INSERT OR IGNORE INTO users (id, name) VALUES ('${U}', 'Me');
    INSERT INTO financial_accounts (id, user_id, account_identifier, bank_name, account_type)
      VALUES ('acc', '${U}', 'AB1', 'Zerodha', 'demat'), ('bank', '${U}', '0006', 'HDFC', 'savings');
  `);
});

describe("the switch", () => {
  it("starts off", () => {
    expect(isBrokerHistoryOn()).toBe(false);
  });
  it("turns on, and goes off with Investments", () => {
    setBrokerHistoryOn(true);
    expect(isBrokerHistoryOn()).toBe(true);
    setPartOn("investments", false);
    expect(isBrokerHistoryOn()).toBe(false);
  });
});

describe("while off", () => {
  it("never calls a broker or saves anything", async () => {
    expect(await captureBroker("kite")).toEqual({ broker: "kite", status: "off" });
    await captureAllBrokers();
    expect(mockKite).not.toHaveBeenCalled();
    expect(mockDb.prepare("SELECT COUNT(*) n FROM broker_capture_days").get()).toEqual({ n: 0 });
  });
  it("has no brokers to remind about", async () => {
    expect(await connectedApiBrokers()).toEqual([]);
  });
});

describe("once on", () => {
  it("saves the day", async () => {
    setBrokerHistoryOn(true);
    expect(await captureBroker("kite")).toMatchObject({ status: "saved" });
    expect(mockKite).toHaveBeenCalledTimes(1);
    expect(await connectedApiBrokers()).toEqual(["kite"]);
  });
  it("keeps what was saved when switched off again", async () => {
    setBrokerHistoryOn(true);
    await captureBroker("kite");
    setBrokerHistoryOn(false);
    expect(mockDb.prepare("SELECT COUNT(*) n FROM broker_capture_days").get()).toEqual({ n: 1 });
  });
});

describe("the simple view", () => {
  const transfer = (id: string, from: string, to: string, amount: number, date: string, deleted = "NULL") =>
    mockDb.exec(`INSERT INTO account_transfers (id, user_id, from_account_id, to_account_id, amount, date, deleted_at) VALUES ('${id}', '${U}', '${from}', '${to}', ${amount}, '${date}', ${deleted});`);

  it("adds up detected transfers by direction and quarter", async () => {
    transfer("a", "bank", "acc", 20000, "2026-07-02");
    transfer("b", "bank", "acc", 5000.5, "2026-10-01");
    transfer("c", "acc", "bank", 700, "2026-10-16");
    const m = await getDetectedMoney("acc", 2026);
    expect(m).toMatchObject({ added: 25000.5, withdrawn: 700, count: 3 });
    expect(m.byQuarter[2]).toEqual({ added: 20000, withdrawn: 0 });
    expect(m.byQuarter[3]).toEqual({ added: 5000.5, withdrawn: 700 });
  });
  it("leaves out deleted transfers, other years and other accounts", async () => {
    transfer("a", "bank", "acc", 100, "2026-07-02", "'2026-08-01'");
    transfer("b", "bank", "acc", 200, "2025-07-02");
    expect(await getDetectedMoney("acc", 2026)).toMatchObject({ added: 0, withdrawn: 0, count: 0 });
    expect(await getDetectedMoney("bank", 2025)).toMatchObject({ added: 0, withdrawn: 200, count: 1 });
  });
  it("uses no broker records", async () => {
    mockDb.exec(`INSERT INTO broker_money_moves (id, account_id, broker, move_date, direction, amount, source) VALUES ('m', 'acc', 'kite', '2026-07-02', 'in', 999, 'file');`);
    expect(await getDetectedMoney("acc", 2026)).toMatchObject({ added: 0, count: 0 });
  });
});
