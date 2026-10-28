import { DatabaseSync } from "node:sqlite";

/**
 * Households end to end: two phones (each with its own database, keystore and settings) talk through
 * the real relay code (relay/src/worker.js over an in-memory D1). Covers start → invite → join →
 * approve → share → edit → change choices → remove, and that the relay only ever holds sealed bytes.
 */

// Each step runs migrations and several syncs on real SQLite: allow time on a slow machine.
jest.setTimeout(60000);

// ─── Phones ───

interface Phone {
  name: string;
  db: DatabaseSync;
  secure: Map<string, string>;
  mmkv: Map<string, unknown>;
}

const mockState: { phone: Phone | null } = { phone: null };
const current = () => {
  if (!mockState.phone) throw new Error("no phone selected");
  return mockState.phone;
};

function adapterFor(get: () => DatabaseSync) {
  return {
    execAsync: async (sql: string) => {
      get().exec(sql);
    },
    runAsync: async (sql: string, ...params: unknown[]) => {
      const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
      const r = get().prepare(sql).run(...(flat as never[]));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    getAllAsync: async (sql: string, ...params: unknown[]) => {
      const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
      return get().prepare(sql).all(...(flat as never[]));
    },
    getFirstAsync: async (sql: string, ...params: unknown[]) => {
      const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
      return get().prepare(sql).get(...(flat as never[])) ?? null;
    },
    withTransactionAsync: async (fn: () => Promise<void>) => {
      const db = get();
      if (db.isTransaction) return fn();
      db.exec("BEGIN");
      try {
        await fn();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

const mockAdapter = adapterFor(() => current().db);

jest.mock("../../database", () => ({
  getDatabase: () => mockAdapter,
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => current().secure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => {
    current().secure.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    current().secure.delete(k);
  },
}));

jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: (k: string) => current().mmkv.get(k) as boolean | undefined,
    getNumber: (k: string) => current().mmkv.get(k) as number | undefined,
    getString: (k: string) => current().mmkv.get(k) as string | undefined,
    set: (k: string, v: unknown) => {
      current().mmkv.set(k, v);
    },
    delete: (k: string) => {
      current().mmkv.delete(k);
    },
    contains: (k: string) => current().mmkv.has(k),
    getAllKeys: () => [...current().mmkv.keys()],
    addOnValueChangedListener: () => ({ remove: () => {} }),
  })),
}));

jest.mock("expo-crypto", () => {
  const c = require("node:crypto");
  return {
    getRandomBytes: (n: number) => new Uint8Array(c.randomBytes(n)),
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    digestStringAsync: async (_alg: string, text: string) => c.createHash("sha256").update(text).digest("hex"),
  };
});

import { runMigrations } from "../../database/migrations";
import { handle } from "../../relay/src/worker";
import {
  approveJoin,
  checkJoin,
  createInvite,
  getJoinRequests,
  leaveHousehold,
  parseInviteLink,
  removeMember,
  requestToJoin,
  setSharingChoices,
  startHousehold,
} from "../../services/household/household";
import { syncHousehold } from "../../services/household/sync";
import { getActiveHousehold, getHousehold, getItems, getMembers } from "../../services/household/store";
import { setRelayUrl } from "../../services/household/device";

// ─── Relay (real worker over node:sqlite) ───

const relayDb = new DatabaseSync(":memory:");
relayDb.exec(require("node:fs").readFileSync(require("node:path").join(__dirname, "../../relay/schema.sql"), "utf8"));
const d1stmt = (sql: string, args: unknown[] = []) => ({
  bind: (...a: unknown[]) => d1stmt(sql, a),
  first: async () => relayDb.prepare(sql).get(...(args as never[])) ?? null,
  all: async () => ({ results: relayDb.prepare(sql).all(...(args as never[])) }),
  run: async () => ({ meta: { changes: Number(relayDb.prepare(sql).run(...(args as never[])).changes) } }),
});
const relayEnv = {
  DB: {
    prepare: (sql: string) => d1stmt(sql),
    batch: async (list: { run: () => Promise<unknown> }[]) => {
      for (const s of list) await s.run();
    },
  },
};
const RELAY = "https://relay.test";

beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
  global.fetch = (async (url: string, init: RequestInit) => {
    const { signal: _signal, ...rest } = init ?? {};
    return handle(new Request(url, rest), relayEnv);
  }) as typeof fetch;
});

afterAll(() => jest.useRealTimers());

// ─── Helpers ───

async function newPhone(name: string): Promise<Phone> {
  const phone: Phone = { name, db: new DatabaseSync(":memory:"), secure: new Map(), mmkv: new Map() };
  mockState.phone = phone;
  await runMigrations(mockAdapter as never);
  phone.db.prepare("INSERT INTO users (id, name) VALUES ('default-user', ?)").run(name);
  setRelayUrl(RELAY);
  return phone;
}

const on = (p: Phone) => {
  mockState.phone = p;
};

let n = 0;
function addCategory(p: Phone, name: string): string {
  const id = `cat-${name.toLowerCase().replace(/\W/g, "")}`;
  p.db.prepare("INSERT INTO categories (id, user_id, name, icon, color, is_active) VALUES (?, 'default-user', ?, 'x', '#000', 1)").run(id, name);
  return id;
}

function addSpend(p: Phone, categoryId: string, amount: number, merchant: string, date = today(), split?: number): string {
  const id = `exp-${++n}`;
  p.db
    .prepare(
      `INSERT INTO expenses (id, user_id, amount, date, category_id, status, nature, source, merchant_name, split_original_amount, created_at, updated_at)
       VALUES (?, 'default-user', ?, ?, ?, 'approved', 'realized', 'manual', ?, ?, datetime('now'), datetime('now'))`,
    )
    .run(id, amount, date, categoryId, merchant, split ?? null);
  return id;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function sync(p: Phone) {
  on(p);
  const r = await syncHousehold();
  if (r.error) throw new Error(`${p.name} sync failed: ${r.error}`);
  return r;
}

async function othersItems(p: Phone) {
  on(p);
  const h = (await getHousehold())!;
  return (await getItems(h.id)).filter((i) => i.member_id !== h.my_member_id);
}

// ─── The story ───

let sourav: Phone;
let aastha: Phone;

test("start, invite, join with matching codes, approve", async () => {
  sourav = await newPhone("Sourav");
  const souravGroceries = addCategory(sourav, "Grocery");
  const souravShopping = addCategory(sourav, "Shopping");
  addSpend(sourav, souravGroceries, 2300, "BigBasket");
  addSpend(sourav, souravShopping, 4800, "Myntra");
  const souravRent = addCategory(sourav, "Rent");
  addSpend(sourav, souravRent, 25000, "Landlord");

  const h = await startHousehold("Home", "Sourav");
  expect(h.role).toBe("creator");
  await sync(sourav);

  const invite = await createInvite();
  expect(invite.link).toMatch(/^https:\/\/souravbaid\.com\/join#/);
  // The secret is only in the fragment, which never reaches a server.
  expect(invite.link.split("#")[0]).not.toContain("s=");

  aastha = await newPhone("Aastha");
  addCategory(aastha, "Groceries");
  const link = parseInviteLink(invite.link)!;
  expect(link.householdName).toBe("Home");
  expect(link.inviterName).toBe("Sourav");
  const joinerCode = await requestToJoin(link, "Aastha");
  expect((await checkJoin()).status).toBe("waiting");

  on(sourav);
  const [req] = await getJoinRequests();
  expect(req.name).toBe("Aastha");
  expect(req.code).toBe(joinerCode);
  await approveJoin(req);

  on(aastha);
  expect((await checkJoin()).status).toBe("joined");
  const ah = (await getActiveHousehold())!;
  expect(ah.name).toBe("Home");
  expect((await getMembers(ah.id)).map((m) => m.name).sort()).toEqual(["Aastha", "Sourav"]);
});

test("household spending is shared and split; each phone keeps its own Hisaab and budget in step", async () => {
  on(aastha);
  const groceries = aastha.db.prepare("SELECT id FROM categories WHERE name = 'Groceries'").get() as { id: string };
  addSpend(aastha, groceries.id, 1100, "Zepto");

  for (let i = 0; i < 2; i++) {
    await sync(sourav);
    await sync(aastha);
  }

  // Sourav's household-category spends were split equally with Aastha, the ordinary way.
  on(sourav);
  const bb = sourav.db.prepare("SELECT amount, split_original_amount FROM expenses WHERE merchant_name = 'BigBasket'").get() as { amount: number; split_original_amount: number };
  expect([bb.amount, bb.split_original_amount]).toEqual([1150, 2300]);

  // Aastha sees his shared transactions in full, with what she owes; the rest only as a total.
  const fromSourav = await othersItems(aastha);
  const tx = fromSourav.filter((i) => i.kind === "tx").sort((x, y) => x.paid! - y.paid!);
  expect(tx.map((t) => [t.category_name, t.merchant, t.paid, t.my_share])).toEqual([
    ["Grocery & Supplies", "BigBasket", 2300, 1150],
    ["Rent & Utilities", "Landlord", 25000, 12500],
  ]);
  const aasthaId = (await getActiveHousehold())!.my_member_id;
  void aasthaId;
  on(aastha);
  const aasthaMe = (await getActiveHousehold())!.my_member_id;
  expect(tx.map((t) => JSON.parse(t.payload_json!).owes[aasthaMe])).toEqual([1150, 12500]);
  expect(fromSourav.filter((i) => i.kind === "total").map((t) => [t.category_name, t.my_share, t.merchant])).toEqual([["Shopping", 4800, null]]);

  // On Aastha's phone: her half of his bills is in her budget ("Paid by Sourav") and her Hisaab.
  const mine = aastha.db.prepare("SELECT amount, description, category_id FROM expenses WHERE household_ref IS NOT NULL ORDER BY amount").all() as { amount: number; description: string; category_id: string | null }[];
  expect(mine.map((m) => [m.amount, m.description])).toEqual([[1150, "Paid by Sourav"], [12500, "Paid by Sourav"]]);
  expect(mine[0].category_id).toBe(groceries.id);

  const { getBalances } = require("../../services/household/settle");
  // Sourav: she owes him 1150 + 12500 - 550 (her Zepto, split) = 13100. Both phones agree.
  on(sourav);
  const [sb] = await getBalances((await getActiveHousehold())!);
  expect(sb.amount).toBe(13100);
  on(aastha);
  const [ab] = await getBalances((await getActiveHousehold())!);
  expect(ab.amount).toBe(-13100);
  expect(ab.theirs).toBe(-13100);
});

test("settling up moves both Hisaabs to zero", async () => {
  const { recordSettleUp, getBalances } = require("../../services/household/settle");
  on(aastha);
  const souravMember = (await getMembers((await getActiveHousehold())!.id)).find((m) => m.name === "Sourav")!;
  await recordSettleUp({ memberId: souravMember.id, amount: 13100, date: today(), paidBy: "me" });
  await sync(aastha);
  await sync(sourav);
  await sync(aastha);
  on(sourav);
  expect((await getBalances((await getActiveHousehold())!))[0].amount).toBe(0);
  on(aastha);
  const [ab] = await getBalances((await getActiveHousehold())!);
  expect([ab.amount, ab.theirs]).toEqual([0, 0]);
});

test("everything already in Sourav's Hisaab with her reaches Aastha: settle-ups, opening balance", async () => {
  const { getBalances } = require("../../services/household/settle");
  const { getMemberLinks } = require("../../services/household/shares");
  on(sourav);
  const sh = (await getActiveHousehold())!;
  const aasthaId = (await getMembers(sh.id)).find((m) => m.name === "Aastha")!.id;
  const personId = (await getMemberLinks(sh.id)).get(aasthaId);
  // Recorded on Sourav's phone by hand, before or outside the household: she started owing 2,000
  // and later paid him back 5,000.
  sourav.db.prepare("UPDATE hisaab_persons SET initial_balance = 2000 WHERE id = ?").run(personId);
  sourav.db
    .prepare("INSERT INTO hisaab_entries (id, hisaab_person_id, amount, description, date, type, created_at) VALUES ('manual-settle', ?, 5000, 'GPay', '2026-09-10', 'settlement', datetime('now'))")
    .run(personId);
  await sync(sourav);
  await sync(aastha);
  await sync(sourav);
  await sync(aastha);

  on(sourav);
  const [sb] = await getBalances((await getActiveHousehold())!);
  on(aastha);
  const [ab] = await getBalances((await getActiveHousehold())!);
  expect(sb.amount).toBe(-3000); // he now owes her 3,000
  expect(ab.amount).toBe(3000);
  expect(ab.theirs).toBe(3000); // both phones agree
  const mirrored = aastha.db.prepare("SELECT type, amount, description FROM hisaab_entries WHERE household_ref IS NOT NULL AND description LIKE '%GPay%'").get();
  expect(mirrored).toEqual({ type: "debit", amount: 5000, description: "GPay" });

  // Back to square for the next steps.
  sourav.db.prepare("DELETE FROM hisaab_entries WHERE id = 'manual-settle'").run();
  sourav.db.prepare("UPDATE hisaab_persons SET initial_balance = 0 WHERE id = ?").run(personId);
  await sync(sourav);
  await sync(aastha);
  on(aastha);
  expect((await getBalances((await getActiveHousehold())!))[0].amount).toBe(0);
});

test("a budget starts once the other accepts it; goals add up each person's part", async () => {
  const plans = require("../../services/household/plans");
  const month = today().slice(0, 7);
  on(sourav);
  await plans.proposeBudget({ "Grocery & Supplies": 15000, "Rent & Utilities": 25000 }, "Let's eat out less");
  await sync(sourav);
  await sync(aastha);
  on(aastha);
  let st = await plans.getBudgetState((await getActiveHousehold())!, month);
  expect(st.active).toBeNull();
  expect(st.pending.by.name).toBe("Sourav");
  await plans.acceptBudget(st.pending.id);
  await sync(aastha);
  await sync(sourav);
  on(sourav);
  st = await plans.getBudgetState((await getActiveHousehold())!, month);
  expect(st.active.amounts).toEqual({ "Grocery & Supplies": 15000, "Rent & Utilities": 25000 });
  // Rent this month: 25,000 paid by Sourav, shared.
  expect(st.lines.find((l: { category: string }) => l.category === "Rent & Utilities")).toEqual({ category: "Rent & Utilities", budget: 25000, spent: 25000 });

  const goalId = await plans.createGoal("Goa trip", 150000, `${new Date().getFullYear() + 1}-01-31`);
  await plans.setMyGoalPart(goalId, { amount: 60000 });
  await sync(sourav);
  await sync(aastha);
  on(aastha);
  await plans.setMyGoalPart(goalId, { amount: 48000 });
  await sync(aastha);
  await sync(sourav);
  on(sourav);
  const [goal] = await plans.getGoals((await getActiveHousehold())!);
  expect([goal.name, goal.target, goal.total]).toEqual(["Goa trip", 150000, 108000]);
  expect(goal.parts.map((p: { member: { name: string }; amount: number }) => [p.member.name, p.amount]).sort()).toEqual([["Aastha", 48000], ["Sourav", 60000]]);
  expect(goal.perMonthNeeded).toBeGreaterThan(0);
});

test("the relay only ever holds sealed bytes", () => {
  const blobs = (relayDb.prepare("SELECT blob FROM log").all() as { blob: string }[]).map((r) => Buffer.from(r.blob, "base64").toString("latin1"));
  const everything = JSON.stringify(relayDb.prepare("SELECT * FROM households").all()) + blobs.join("");
  for (const secret of ["BigBasket", "Zepto", "Myntra", "Aastha", "Sourav", "Groceries", "2300", "Home"]) {
    expect(everything).not.toContain(secret);
  }
});

test("deleting an expense removes it from the other phone", async () => {
  on(sourav);
  sourav.db.prepare("UPDATE expenses SET deleted_at = datetime('now') WHERE merchant_name = 'Myntra'").run();
  await sync(sourav);
  await sync(aastha);
  expect((await othersItems(aastha)).filter((i) => i.kind === "total")).toEqual([]);
});

test("making one transaction personal takes it back, on both phones", async () => {
  const { setShareChoice } = require("../../services/household/shares");
  on(sourav);
  const bbId = (sourav.db.prepare("SELECT id FROM expenses WHERE merchant_name = 'BigBasket'").get() as { id: string }).id;
  await setShareChoice((await getActiveHousehold())!, bbId, { shared: false, split: "equal", myPct: null });
  const bb = sourav.db.prepare("SELECT amount, split_original_amount FROM expenses WHERE id = ?").get(bbId) as { amount: number; split_original_amount: number | null };
  expect([bb.amount, bb.split_original_amount]).toEqual([2300, null]);
  await sync(sourav);
  await sync(aastha);
  expect((await othersItems(aastha)).filter((i) => i.kind === "tx").map((t) => t.merchant)).toEqual(["Landlord"]);
  expect((aastha.db.prepare("SELECT amount FROM expenses WHERE household_ref IS NOT NULL").all() as { amount: number }[]).map((r) => r.amount)).toEqual([12500]);
});

test("turning a choice off takes what it shared back", async () => {
  on(aastha);
  await setSharingChoices({ householdCategories: false, otherTotals: false, allTransactions: false, savingsRate: false, balances: false });
  const { setShareChoice } = require("../../services/household/shares");
  const zepto = (aastha.db.prepare("SELECT id FROM expenses WHERE merchant_name = 'Zepto'").get() as { id: string }).id;
  await setShareChoice((await getActiveHousehold())!, zepto, { shared: false, split: "equal", myPct: null });
  await sync(aastha);
  await sync(sourav);
  // Settle-ups stay: they're history between the two of them, not something one person "shares".
  expect((await othersItems(sourav)).filter((i) => i.kind === "tx" || i.kind === "total")).toEqual([]);
});

test("a removed member is told, loses everything, and can't read what comes next", async () => {
  on(sourav);
  const sh = (await getActiveHousehold())!;
  const aasthaId = (await getMembers(sh.id)).find((m) => m.name === "Aastha")!.id;
  await removeMember(aasthaId);
  expect((await getActiveHousehold())!.key_version).toBe(2);
  await sync(sourav);

  on(aastha);
  await syncHousehold();
  const ah = (await getHousehold())!;
  expect(ah.status).toBe("removed");
  expect(await getItems(ah.id)).toEqual([]);
  expect([...aastha.secure.keys()].some((k) => k.startsWith("arth_household_") && !k.includes("invites"))).toBe(false);

  // Sourav carries on under the new key.
  on(sourav);
  addSpend(sourav, "cat-grocery", 900, "DMart");
  const r = await syncHousehold();
  expect(r.error).toBeUndefined();
});

test("leaving: the leaver's data goes from the relay and the other phone", async () => {
  // Fresh pair: Sourav invites Aastha again.
  on(aastha);
  const { forgetHousehold } = require("../../services/household/household");
  await forgetHousehold();

  on(sourav);
  const invite = await createInvite();
  on(aastha);
  await requestToJoin(parseInviteLink(invite.link)!, "Aastha");
  on(sourav);
  await approveJoin((await getJoinRequests())[0]);
  on(aastha);
  expect((await checkJoin()).status).toBe("joined");
  await setSharingChoices({ householdCategories: true, otherTotals: true, allTransactions: false, savingsRate: false, balances: false });
  await sync(aastha);
  await sync(sourav);
  expect((await othersItems(sourav)).filter((i) => i.kind === "tx" || i.kind === "total").length).toBeGreaterThan(0);

  on(aastha);
  const aasthaMember = (await getActiveHousehold())!.my_member_id;
  await leaveHousehold();
  expect(await getHousehold()).toBeNull();
  const left = relayDb.prepare("SELECT seq FROM log WHERE member = ?").all(aasthaMember) as { seq: number }[];
  expect(left.length).toBe(1); // only the "left" op

  await sync(sourav);
  expect(await othersItems(sourav)).toEqual([]);
  // Their splits stay in Sourav's Hisaab (real money), just no longer tied to the household.
  const members = await getMembers((await getActiveHousehold())!.id);
  expect(members.map((m) => m.name)).toEqual(["Sourav"]);
});

test("restored on a new phone: it carries on as the same member, and the old phone stops", async () => {
  // A backup carries the database and the household keys, but not this phone's device id.
  const file = require("node:path").join(require("node:os").tmpdir(), `arth-household-${Date.now()}.db`);
  sourav.db.exec(`VACUUM INTO '${file.split(String.fromCharCode(92)).join("/")}'`);
  const newSourav: Phone = { name: "Sourav (new phone)", db: new DatabaseSync(file), secure: new Map(sourav.secure), mmkv: new Map() };
  on(newSourav);
  setRelayUrl(RELAY);

  // The old phone sent more after the backup was made.
  on(sourav);
  addSpend(sourav, "cat-grocery", 450, "Blinkit");
  await sync(sourav);
  const headBefore = (relayDb.prepare("SELECT max_seq FROM heads WHERE member = ?").get((await getActiveHousehold())!.my_member_id) as { max_seq: number }).max_seq;

  on(newSourav);
  const r = await syncHousehold();
  expect(r.error).toBeUndefined();
  const nh = (await getActiveHousehold())!;
  expect(nh.next_seq).toBeGreaterThan(headBefore);

  on(sourav);
  const old = await syncHousehold();
  expect(old.status).toBe("moved");
  expect((await getHousehold())!.status).toBe("moved");
});
