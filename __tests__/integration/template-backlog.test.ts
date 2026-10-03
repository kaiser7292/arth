import { DatabaseSync } from "node:sqlite";

/**
 * Flexible "Auto" templates end to end on the real schema: save one from a sample, count and
 * preview what it reads in the Unrecognised backlog, read the backlog (skipping unticked
 * messages), and use it on a live scan. Real formats, names and digits replaced.
 */
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

import { runMigrations } from "../../database/migrations";
import { seedDefaultUser } from "../../database/seed";
import { createManualAccount } from "../../services/financial-account";
import { tryTemplateMatch } from "../../services/public-data/sms-template-matcher";
import { setSelfNames } from "../../services/self-names";
import { applyTemplateToBacklog, findBacklogMatches, getBacklogDays, setBacklogDays } from "../../services/sms/template-backlog";
import type { TaggedSpan } from "../../services/sms/template-compiler";
import { createUserTemplate, parseSamples } from "../../services/sms/user-sms-templates";

// A made-up bank format (no built-in parser), so only the template can read it.
const SENDER = "VM-NEWBNK-S";
const sample = (verb: string, amount: string, date: string, extra: string) =>
  `Dear Customer, A/c XX8812 ${verb} INR ${amount} on ${date} ${extra}. Bal INR 1,000.00 - NewBank`;
const S1 = sample("credited with", "50,079.00", "30-09-26", "by transfer from RAHULVERMA");
const S2 = sample("credited with", "5,000.00", "02-10-26", "via IMPS by transfer from PRIYA SHAH");
const S3 = sample("debited for", "1,250.00", "01-10-26", "towards rent by transfer from RAHULVERMA");
const OTHER = "Your OTP is 123456 - NewBank";

function span(body: string, text: string, field: TaggedSpan["field"]): TaggedSpan {
  const start = body.indexOf(text);
  return { field, start, end: start + text.length };
}

let U = "";
let seq = 0;
function unrecognised(body: string, daysAgo = 1): string {
  const id = `p${++seq}`;
  mockDb
    .prepare(
      `INSERT INTO pending_sms (id, user_id, sms_id, address, body, sms_date, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, 'failed', 'unrecognised')`,
    )
    .run(id, U, `s${seq}`, SENDER, body, Date.now() - daysAgo * 86400000);
  return id;
}

beforeEach(async () => {
  mockDb = new DatabaseSync(":memory:");
  mockStore.clear();
  seq = 0;
  await runMigrations(mockAdapter as never);
  U = await seedDefaultUser(mockAdapter as never);
  await createManualAccount({ userId: U, bankName: "NewBank", accountType: "savings", accountIdentifier: "8812" });
});

async function saveTemplate() {
  return createUserTemplate({
    bankName: "NewBank",
    txType: "auto",
    sampleSms: S1,
    spans: [
      span(S1, "8812", "account"),
      span(S1, "50,079.00", "amount"),
      span(S1, "30-09-26", "date"),
      span(S1, "RAHULVERMA", "counterparty"),
    ],
    senderPattern: "NEWBNK",
    senderMatchMode: "code",
  });
}

it("saves flexible by default, with its taps", async () => {
  const t = await saveTemplate();
  expect(t.match_style).toBe("flexible");
  expect(parseSamples(t.samples)[0].spans).toHaveLength(4);
});

it("counts and previews what it would read, within the look-back window", async () => {
  unrecognised(S2);
  unrecognised(S3);
  unrecognised(OTHER);
  unrecognised(S2.replace("5,000.00", "7,000.00"), 120); // older than 90 days
  const t = await saveTemplate();
  const tpl = { id: t.id, patternRegex: t.pattern_regex, txType: t.tx_type, bankName: t.bank_name, senderMatchMode: t.sender_match_mode, senderPattern: t.sender_pattern };

  expect(getBacklogDays()).toBe(90);
  const r = await findBacklogMatches(tpl);
  expect(r.total).toBe(3);
  expect(r.matches.map((m) => [m.parsed.amount, m.parsed.type])).toEqual(
    expect.arrayContaining([
      [5000, "credit"],
      [1250, "debit"],
    ]),
  );
  expect(r.matches.find((m) => m.parsed.amount === 5000)?.parsed.counterpartyName).toBe("priya shah");

  setBacklogDays(180);
  expect((await findBacklogMatches(tpl)).matches).toHaveLength(3);
});

it("reads the backlog into the review queue, skipping unticked messages", async () => {
  setSelfNames(["Rahul Verma"]);
  const keep = unrecognised(S3);
  const skip = unrecognised(S2);
  const t = await saveTemplate();
  const tpl = { id: t.id, patternRegex: t.pattern_regex, txType: t.tx_type, bankName: t.bank_name, senderMatchMode: t.sender_match_mode, senderPattern: t.sender_pattern };

  expect(await applyTemplateToBacklog(tpl, [skip])).toBe(1);
  const rows = mockDb.prepare(`SELECT amount, nature, status, money_event FROM expenses`).all() as Record<string, unknown>[];
  expect(rows).toEqual([{ amount: 1250, nature: "realized", status: "pending_review", money_event: "self_transfer" }]);
  const states = mockDb.prepare(`SELECT id, status FROM pending_sms ORDER BY id`).all() as { id: string; status: string }[];
  expect(states.find((s) => s.id === keep)?.status).toBe("processed");
  expect(states.find((s) => s.id === skip)?.status).toBe("failed");
});

it("is used for new SMS from that sender", async () => {
  await saveTemplate();
  const parsed = await tryTemplateMatch(S2, SENDER);
  expect(parsed?.amount).toBe(5000);
  expect(parsed?.type).toBe("credit");
  expect(await tryTemplateMatch(S2, "VM-OTHERB-S")).toBeNull();
});
