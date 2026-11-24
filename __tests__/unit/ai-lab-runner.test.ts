jest.mock("@/services/ai/tasks/read-sms", () => ({ readSmsWithNano: jest.fn() }));
jest.mock("@/services/sms/sms-scan-logging", () => ({
  saveScanRun: jest.fn(async () => "run-1"),
  markScanDetailAdded: jest.fn(async () => {}),
}));

import { AppState } from "react-native";
import { readSmsWithNano } from "@/services/ai/tasks/read-sms";
import { markScanDetailAdded, saveScanRun } from "@/services/sms/sms-scan-logging";
import {
  __resetLabRun,
  getLabRun,
  markLabRowAdded,
  onLabRunFinished,
  startLabRun,
  stopLabRun,
  summariseLabRun,
  type RunRow,
} from "@/services/ai/lab-runner";

const read = readSmsWithNano as jest.Mock;
const rows: RunRow[] = [
  { id: "a", sender: "X", body: "one" },
  { id: "b", sender: "X", body: "two" },
  { id: "c", sender: "X", body: "three" },
];
// The real AppState, with its state and listeners under the test's control.
const mockAppState = {
  currentState: "active",
  listeners: new Set<(s: string) => void>(),
  emit(s: string) {
    mockAppState.currentState = s;
    mockAppState.listeners.forEach((l) => l(s));
  },
};
Object.defineProperty(AppState, "currentState", { get: () => mockAppState.currentState, configurable: true });
jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, l: (s: string) => void) => {
  mockAppState.listeners.add(l);
  return { remove: () => mockAppState.listeners.delete(l) };
}) as never);

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  __resetLabRun();
  mockAppState.currentState = "active";
  mockAppState.listeners.clear();
  read.mockReset();
  (saveScanRun as jest.Mock).mockClear();
  (markScanDetailAdded as jest.Mock).mockClear();
});

it("reads every message, keeps the results and says when it's done", async () => {
  read.mockResolvedValue({ outcome: { kind: "not_transaction" }, raw: "{}", ms: 10 });
  const finished = jest.fn();
  onLabRunFinished(finished);

  await startLabRun(rows, "Last 7 days · 3 messages");

  expect(read).toHaveBeenCalledTimes(3);
  const run = getLabRun();
  expect(run.running).toBe(false);
  expect(run.label).toBe("Last 7 days · 3 messages");
  expect(summariseLabRun(run.rows)).toMatchObject({ done: 3, notTransactions: 3 });
  expect(finished).toHaveBeenCalledTimes(1);
});

it("Stop ends the run early and doesn't announce it as done", async () => {
  read.mockImplementation(async () => {
    stopLabRun();
    return { outcome: { kind: "not_transaction" }, raw: "{}", ms: 10 };
  });
  const finished = jest.fn();
  onLabRunFinished(finished);

  await startLabRun(rows, "x");

  expect(read).toHaveBeenCalledTimes(1);
  expect(getLabRun()).toMatchObject({ running: false, stopped: true });
  expect(finished).not.toHaveBeenCalled();
});

it("pauses while Arth is in the background and carries on when it's back", async () => {
  read.mockResolvedValue({ outcome: { kind: "not_transaction" }, raw: "{}", ms: 10 });
  mockAppState.currentState = "background";

  const done = startLabRun(rows.slice(0, 1), "x");
  await flush();
  expect(getLabRun().paused).toBe(true);
  expect(read).not.toHaveBeenCalled();

  mockAppState.emit("active");
  await done;
  expect(read).toHaveBeenCalledTimes(1);
  expect(getLabRun()).toMatchObject({ running: false, paused: false });
});

it("ignores a second start while one is running", async () => {
  let release!: () => void;
  read.mockImplementationOnce(() => new Promise((r) => (release = () => r({ outcome: { kind: "not_transaction" }, raw: "", ms: 1 }))));
  const first = startLabRun(rows.slice(0, 1), "first");
  await flush();
  await startLabRun(rows, "second");
  expect(getLabRun().label).toBe("first");
  release();
  await first;
});

it("saves a finished run to Scan history as an AI scan, one row per message read", async () => {
  read
    .mockResolvedValueOnce({
      outcome: { kind: "transaction", result: { type: "debit", amount: 250, merchant: "swiggy" }, warnings: [] },
      raw: "{}",
      ms: 40,
    })
    .mockResolvedValueOnce({ outcome: { kind: "rejected", problems: ["no amount"] }, raw: "{}", ms: 20 })
    .mockRejectedValueOnce(new Error("model busy"));

  await startLabRun(rows, "Last 7 days · 3 messages");

  expect(saveScanRun).toHaveBeenCalledTimes(1);
  const input = (saveScanRun as jest.Mock).mock.calls[0][0];
  expect(input).toMatchObject({ source: "ai", label: "Last 7 days · 3 messages", smsReadCount: 3, error: null });
  expect(input.details.map((d: { category: string }) => d.category)).toEqual(["ai_transaction", "ai_rejected", "ai_error"]);
  expect(input.details[0]).toMatchObject({ messageRef: "a", parsedAmount: 250, parsedMerchant: "swiggy", parsedType: "debit", aiMs: 40 });
  expect(input.details[1].filterReason).toBe("no amount");
  expect(input.details[2].filterReason).toBe("model busy");
  expect(getLabRun().historyId).toBe("run-1");
});

it("records Add to Catch Up on the saved history row", async () => {
  read.mockResolvedValue({ outcome: { kind: "not_transaction" }, raw: "{}", ms: 10 });
  await startLabRun(rows.slice(0, 1), "x");

  markLabRowAdded("a", { expenseId: "exp-1", note: null });

  expect(markScanDetailAdded).toHaveBeenCalledWith("run-1", "a", { expenseId: "exp-1", note: null });
});

it("saves nothing when a run is stopped before any message was read", async () => {
  read.mockImplementation(async () => {
    stopLabRun();
    return { outcome: { kind: "not_transaction" }, raw: "{}", ms: 10 };
  });
  await startLabRun(rows, "x");
  expect(saveScanRun).not.toHaveBeenCalled();
});
