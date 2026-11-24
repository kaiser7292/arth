import { DatabaseSync } from "node:sqlite";

/**
 * Scan history against the REAL schema (every migration on a real SQLite engine): SMS scans and
 * on-device AI scans share one history, each source keeps its own 30 runs, AI runs count their
 * messages per category, and "Add to Catch Up" is recorded on the saved row.
 */
let mockDb: DatabaseSync;
const mockAdapter = {
  execAsync: async (sql: string) => {
    mockDb.exec(sql);
  },
  runAsync: async (sql: string, ...params: unknown[]) => {
    const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
    const r = mockDb.prepare(sql).run(...(flat as never[]));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).all(...(params as never[])),
  getFirstAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).get(...(params as never[])) ?? null,
  withTransactionAsync: async (fn: () => Promise<void>) => {
    mockDb.exec("BEGIN");
    try {
      await fn();
      mockDb.exec("COMMIT");
    } catch (e) {
      mockDb.exec("ROLLBACK");
      throw e;
    }
  },
};

jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: () => undefined,
    getNumber: () => undefined,
    getString: () => undefined,
    set: () => {},
    delete: () => {},
    getAllKeys: () => [],
  })),
}));
jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));

import { runMigrations } from "../../database/migrations";
import { getScanRunDetails, getScanRuns, markScanDetailAdded, saveScanRun, type ScanRunInput } from "../../services/sms/sms-scan-logging";

const U = "default_user";
const flush = () => new Promise((r) => setImmediate(r));

const base: Omit<ScanRunInput, "details"> = {
  userId: U,
  isManual: true,
  smsReadCount: 0,
  hardcodedMatchCount: 0,
  templateMatchCount: 0,
  filteredCount: 0,
  unrecognizedCount: 0,
  skippedCount: 0,
  expenseCreatedCount: 0,
  creditCreatedCount: 0,
};

beforeEach(async () => {
  mockDb = new DatabaseSync(":memory:");
  await runMigrations(mockAdapter as never);
});

it("keeps SMS and AI runs side by side, with an AI run's counts and reading", async () => {
  await saveScanRun({ ...base, smsReadCount: 4, hardcodedMatchCount: 3, details: [] });
  const aiId = await saveScanRun({
    ...base,
    source: "ai",
    label: "Last 7 days · 3 messages",
    smsReadCount: 3,
    details: [
      {
        category: "ai_transaction",
        smsAddress: "AX-TESTBK",
        smsBodyPreview: "Rs 120 debited from A/c XX0000",
        smsDate: 1,
        parsedAmount: 120,
        messageRef: "m1",
        aiResult: { kind: "transaction", result: { amount: 120 }, warnings: [] },
        aiMs: 900,
      },
      { category: "ai_not_money", messageRef: "m2", aiResult: { kind: "not_transaction" } },
      { category: "ai_error", messageRef: "m3", filterReason: "model busy" },
    ],
  });

  const runs = await getScanRuns(U);
  expect(runs.map((r) => r.source).sort()).toEqual(["ai", "sms"]);
  const ai = runs.find((r) => r.source === "ai")!;
  expect(ai).toMatchObject({
    id: aiId,
    label: "Last 7 days · 3 messages",
    category_counts: { ai_transaction: 1, ai_not_money: 1, ai_error: 1 },
    added_count: 0,
  });
  expect((await getScanRuns(U, 1, "sms"))[0].source).toBe("sms");

  const details = await getScanRunDetails(aiId);
  const tx = details.find((d) => d.message_ref === "m1")!;
  expect(JSON.parse(tx.ai_result!)).toMatchObject({ kind: "transaction", result: { amount: 120 } });
  expect(tx.ai_ms).toBe(900);

  await markScanDetailAdded(aiId, "m1", { expenseId: "exp-1", note: null });
  expect((await getScanRuns(U, 60, "ai"))[0].added_count).toBe(1);
});

it("keeps 30 runs per source, so AI test runs never push SMS scans out", async () => {
  await saveScanRun({ ...base, details: [] });
  for (let i = 0; i < 32; i++) {
    await saveScanRun({ ...base, source: "ai", details: [{ category: "ai_not_money", messageRef: `m${i}` }] });
    await flush();
  }
  expect(await getScanRuns(U, 100, "ai")).toHaveLength(30);
  expect(await getScanRuns(U, 100, "sms")).toHaveLength(1);
});

it("purging old runs takes their messages with them", async () => {
  for (let i = 0; i < 31; i++) {
    await saveScanRun({ ...base, source: "ai", details: [{ category: "ai_not_money", messageRef: `m${i}` }] });
    await flush();
  }
  const left = mockDb.prepare("SELECT COUNT(*) AS n FROM sms_scan_details").get() as { n: number };
  expect(left.n).toBe(30);
});
