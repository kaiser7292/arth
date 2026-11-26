import { DatabaseSync } from "node:sqlite";

/** ai_jobs (migration 098) and the category runner, on the real schema, with the model faked. */
let mockDb: DatabaseSync;
const flat = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params);
const mockAdapter = {
  execAsync: async (sql: string) => {
    mockDb.exec(sql);
  },
  runAsync: async (sql: string, ...params: unknown[]) => {
    const r = mockDb.prepare(sql).run(...(flat(params) as never[]));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).all(...(flat(params) as never[])),
  getFirstAsync: async (sql: string, ...params: unknown[]) => mockDb.prepare(sql).get(...(flat(params) as never[])) ?? null,
  withTransactionAsync: async (fn: () => Promise<void>) => fn(),
};
const mockStore = new Map<string, string | number | boolean>();
jest.mock("../../database", () => ({ getDatabase: () => mockAdapter }));
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: (k: string) => mockStore.get(k) as boolean | undefined,
    getNumber: (k: string) => mockStore.get(k) as number | undefined,
    getString: (k: string) => mockStore.get(k) as string | undefined,
    set: (k: string, v: string | number | boolean) => mockStore.set(k, v),
    delete: (k: string) => mockStore.delete(k),
    getAllKeys: () => [...mockStore.keys()],
    contains: (k: string) => mockStore.has(k),
  })),
}));
jest.mock("../../services/ai/ai-reading", () => ({ isAiJobOn: () => true, isAiReadingOn: () => true }));
jest.mock("../../services/ai/tasks/merchant-category", () => ({ MERCHANTS_PER_PROMPT: 8, fileMerchantsWithNano: jest.fn() }));
jest.mock("../../services/ai/tasks/merchant-merge", () => ({ runMergeJobs: jest.fn(async () => 0) }));
jest.mock("../../services/ai/tasks/payment-context", () => ({ runContextJobs: jest.fn(async () => 0) }));

import { runMigrations } from "../../database/migrations";
import { seedDefaultUser } from "../../database/seed";
import { aiSuggestions, answerAiJob, queueAiJob } from "../../services/ai/jobs";
import { runAiJobs } from "../../services/ai/job-runner";
import { fileMerchantsWithNano } from "../../services/ai/tasks/merchant-category";

const file = fileMerchantsWithNano as jest.Mock;
const hooks = { shouldStop: () => false, untilActive: async () => {} };
let U = "";

function spend(id: string, merchant: string, categoryId: string | null = null) {
  mockDb
    .prepare(
      `INSERT INTO expenses (id, user_id, amount, currency, date, nature, status, source, merchant_name, category_id) VALUES (?, ?, 100, 'INR', '2026-11-01', 'realized', 'pending_review', 'sms_auto', ?, ?)`,
    )
    .run(id, U, merchant, categoryId);
}

beforeEach(async () => {
  mockDb = new DatabaseSync(":memory:");
  mockStore.clear();
  await runMigrations(mockAdapter as never);
  U = await seedDefaultUser(mockAdapter as never);
  mockDb.prepare(`INSERT INTO categories (id, user_id, name, icon, color, sort_order, is_active, is_unavoidable) VALUES ('c-food', ?, 'Food', 'x', '#000', 1, 1, 0)`).run(U);
  file.mockReset();
});

it("a question is asked once; a dismissed suggestion is never asked again", async () => {
  expect(await queueAiJob("category", "e1")).toBe(true);
  expect(await queueAiJob("category", "e1")).toBe(false);
  await answerAiJob("category", "e2", "dismissed");
  expect(await queueAiJob("category", "e2")).toBe(false);
});

it("files uncategorised spends, one question per merchant, and skips ones categorised meanwhile", async () => {
  spend("e1", "Test Cafe");
  spend("e2", "Test Cafe");
  spend("e3", "Done Shop", "c-food");
  for (const id of ["e1", "e2", "e3"]) await queueAiJob("category", id);
  file.mockResolvedValue(new Map([["Test Cafe", "Food"]]));

  await runAiJobs(hooks);

  expect(file).toHaveBeenCalledTimes(1);
  expect(file.mock.calls[0][0]).toEqual(["Test Cafe"]);
  const s = await aiSuggestions<{ categoryId: string }>("category", ["e1", "e2", "e3"]);
  expect(s.get("e1")).toEqual({ categoryId: "c-food", categoryName: "Food" });
  expect(s.get("e2")).toEqual({ categoryId: "c-food", categoryName: "Food" });
  expect(s.has("e3")).toBe(false);
});

it("a model that doesn't answer leaves the questions for another try", async () => {
  spend("e1", "Test Cafe");
  await queueAiJob("category", "e1");
  file.mockRejectedValue(new Error("No answer in 8 s"));
  await runAiJobs(hooks);
  expect(mockDb.prepare(`SELECT status FROM ai_jobs WHERE ref_id = 'e1'`).get()).toEqual({ status: "retry" });
});
