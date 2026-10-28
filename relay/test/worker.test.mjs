// Relay tests: `node --test relay/test` (Node 22.5+, uses the built-in node:sqlite in place of D1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handle, cleanUp, sha256Hex, LIMITS } from "../src/worker.js";

/** The slice of the D1 API the worker uses, over an in-memory SQLite database. */
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes) } };
    },
  });
  return {
    db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      for (const s of list) await s.run();
    },
  };
}

const HH = "hh_aaaaaaaaaaaaaaaa";
const M1 = "m1_aaaaaaaaaaaaaaaa";
const M2 = "m2_bbbbbbbbbbbbbbbb";
const TOKEN = "tok_aaaaaaaaaaaaaaaaaaaaaaaa";
const T0 = Date.UTC(2026, 9, 28);

function setup() {
  const env = { DB: fakeD1() };
  const call = (method, path, { body, token = TOKEN, headers = {}, now = T0 } = {}) =>
    handle(
      new Request(`https://sync.example.com${path}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
      now,
    ).then(async (r) => ({ status: r.status, body: await r.json() }));
  return { env, call };
}

async function withHousehold() {
  const s = setup();
  const r = await s.call("POST", "/v1/households", { body: { id: HH, tokenHash: await sha256Hex(TOKEN) }, token: null });
  assert.equal(r.status, 201);
  return s;
}

test("creates a household once; the token is checked on every call", async () => {
  const { call } = await withHousehold();
  const again = await call("POST", "/v1/households", { body: { id: HH, tokenHash: await sha256Hex(TOKEN) }, token: null });
  assert.equal(again.status, 409);
  assert.equal((await call("GET", `/v1/h/${HH}/log`, { token: "tok_wrongwrongwrongwrongwrong" })).status, 401);
  assert.equal((await call("GET", `/v1/h/${HH}/log`, { token: null })).status, 401);
  assert.equal((await call("GET", `/v1/h/hh_doesnotexist000000/log`)).status, 404);
  assert.equal((await call("GET", `/v1/h/${HH}/log`)).status, 200);
});

test("stores only the token's hash", async () => {
  const { env } = await withHousehold();
  const row = env.DB.db.prepare("SELECT * FROM households").get();
  assert.notEqual(row.token_hash, TOKEN);
  assert.equal(row.token_hash, await sha256Hex(TOKEN));
});

test("uploads ops idempotently and returns them after a cursor", async () => {
  const { call } = await withHousehold();
  for (const seq of [1, 2, 3]) {
    const r = await call("PUT", `/v1/h/${HH}/log/${M1}/${seq}`, { body: { blob: `AAA${seq}` } });
    assert.deepEqual(r.body, { ok: true, duplicate: false });
  }
  const dup = await call("PUT", `/v1/h/${HH}/log/${M1}/2`, { body: { blob: "CHANGED" } });
  assert.equal(dup.body.duplicate, true);
  await call("PUT", `/v1/h/${HH}/log/${M2}/1`, { body: { blob: "BBB1" } });

  const all = await call("GET", `/v1/h/${HH}/log`);
  assert.equal(all.body.ops.length, 4);
  assert.equal(all.body.ops.find((o) => o.m === M1 && o.seq === 2).blob, "AAA2");

  const after = await call("GET", `/v1/h/${HH}/log?since=${M1}:2,${M2}:1`);
  assert.deepEqual(after.body.ops, [{ m: M1, seq: 3, blob: "AAA3" }]);
  assert.deepEqual(after.body.ranges[M1], { min: 1, max: 3 });
});

test("pages large results", async () => {
  const { call } = await withHousehold();
  for (let seq = 1; seq <= 12; seq++) await call("PUT", `/v1/h/${HH}/log/${M1}/${seq}`, { body: { blob: "QQ" } });
  const first = await call("GET", `/v1/h/${HH}/log?limit=5`);
  assert.equal(first.body.ops.length, 5);
  assert.equal(first.body.more, true);
  const next = await call("GET", `/v1/h/${HH}/log?limit=5&since=${M1}:5`);
  assert.equal(next.body.ops[0].seq, 6);
});

test("rejects bad input", async () => {
  const { call } = await withHousehold();
  assert.equal((await call("PUT", `/v1/h/${HH}/log/${M1}/0`, { body: { blob: "AA" } })).status, 400);
  assert.equal((await call("PUT", `/v1/h/${HH}/log/short/1`, { body: { blob: "AA" } })).status, 400);
  assert.equal((await call("PUT", `/v1/h/${HH}/log/${M1}/1`, { body: { blob: "not base64!" } })).status, 400);
  const big = "A".repeat(LIMITS.maxOpBytes * 2);
  assert.equal((await call("PUT", `/v1/h/${HH}/log/${M1}/1`, { body: { blob: big } })).status, 413);
  assert.equal((await call("GET", `/v1/h/${HH}/log?since=bad`)).status, 400);
});

test("prunes ops once every other member has acknowledged them", async () => {
  const { call, env } = await withHousehold();
  for (const seq of [1, 2, 3]) await call("PUT", `/v1/h/${HH}/log/${M1}/${seq}`, { body: { blob: "AA" } });
  const count = () => env.DB.db.prepare("SELECT COUNT(*) AS n FROM log").get().n;

  // The author acknowledging its own ops changes nothing.
  await call("POST", `/v1/h/${HH}/ack`, { body: { member: M1, cursors: { [M1]: 3 } } });
  assert.equal(count(), 3);

  await call("POST", `/v1/h/${HH}/ack`, { body: { member: M2, cursors: { [M1]: 2 } } });
  assert.equal(count(), 1);
  // The highest seq survives pruning.
  const after = await call("GET", `/v1/h/${HH}/log?since=${M1}:3`);
  assert.deepEqual(after.body.heads, { [M1]: 3 });
});

test("enforces the daily quota", async () => {
  const { call, env } = await withHousehold();
  const day = new Date(T0).toISOString().slice(0, 10);
  env.DB.db.prepare("INSERT INTO quota (hh, day, count) VALUES (?, ?, ?)").run(HH, day, LIMITS.opsPerDay);
  assert.equal((await call("PUT", `/v1/h/${HH}/log/${M1}/1`, { body: { blob: "AA" } })).status, 429);
});

test("leaving deletes that member's ops and cursor straight away", async () => {
  const { call, env } = await withHousehold();
  await call("PUT", `/v1/h/${HH}/log/${M1}/1`, { body: { blob: "AA" } });
  await call("PUT", `/v1/h/${HH}/log/${M2}/1`, { body: { blob: "BB" } });
  await call("POST", `/v1/h/${HH}/ack`, { body: { member: M2, cursors: {} } });
  assert.equal((await call("DELETE", `/v1/h/${HH}/member/${M2}`)).status, 200);
  assert.deepEqual(env.DB.db.prepare("SELECT member FROM log").all().map((r) => r.member), [M1]);
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM cursors").get().n, 0);
});

test("rekey swaps the token; the old one stops working", async () => {
  const { call } = await withHousehold();
  const newToken = "tok_bbbbbbbbbbbbbbbbbbbbbbbb";
  assert.equal((await call("POST", `/v1/h/${HH}/token`, { body: { tokenHash: await sha256Hex(newToken) } })).status, 200);
  assert.equal((await call("GET", `/v1/h/${HH}/log`, { token: newToken })).status, 200);
  // The old token may still read for a while (to fetch the rekey op), but not write.
  assert.equal((await call("GET", `/v1/h/${HH}/log`)).status, 200);
  assert.equal((await call("PUT", `/v1/h/${HH}/log/${M1}/1`, { body: { blob: "AA" } })).status, 401);
  assert.equal((await call("POST", `/v1/h/${HH}/ack`, { body: { member: M1, cursors: {} } })).status, 401);
  const later = T0 + LIMITS.oldTokenGraceMs + 1;
  assert.equal((await call("GET", `/v1/h/${HH}/log`, { now: later })).status, 401);
  assert.equal((await call("GET", `/v1/h/${HH}/log`, { token: newToken, now: later })).status, 200);
});

test("a closed household answers 404", async () => {
  const { call } = await withHousehold();
  await call("DELETE", `/v1/h/${HH}`);
  assert.equal((await call("GET", `/v1/h/${HH}/log`)).status, 404);
});

test("closing deletes everything for the household", async () => {
  const { call, env } = await withHousehold();
  await call("PUT", `/v1/h/${HH}/log/${M1}/1`, { body: { blob: "AA" } });
  assert.equal((await call("DELETE", `/v1/h/${HH}`)).status, 200);
  for (const t of ["households", "log", "cursors", "heads", "quota", "invites"]) {
    assert.equal(env.DB.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, t);
  }
});

test("invite: request, approve, collect once", async () => {
  const { call } = await withHousehold();
  const INV = "inv_aaaaaaaaaaaaaaaa";
  const PROOF = "proof_aaaaaaaaaaaaaaaaaaaa";
  const proofHeaders = { "x-invite-proof": PROOF };
  assert.equal(
    (await call("POST", "/v1/invites", { body: { id: INV, hh: HH, proofHash: await sha256Hex(PROOF) } })).status,
    201,
  );

  // Joiner, wrong proof / no proof
  assert.equal((await call("POST", `/v1/invites/${INV}/request`, { token: null, body: { blob: "RQ" } })).status, 401);
  assert.equal(
    (await call("POST", `/v1/invites/${INV}/request`, { token: null, headers: { "x-invite-proof": "proof_wrongwrongwrongwrong" }, body: { blob: "RQ" } })).status,
    401,
  );
  // Approving before a request is refused
  assert.equal((await call("POST", `/v1/invites/${INV}/accept`, { body: { blob: "AC" } })).status, 409);

  assert.equal((await call("POST", `/v1/invites/${INV}/request`, { token: null, headers: proofHeaders, body: { blob: "RQ" } })).status, 200);
  // Only one join request per invite
  assert.equal((await call("POST", `/v1/invites/${INV}/request`, { token: null, headers: proofHeaders, body: { blob: "RQ2" } })).status, 409);

  assert.deepEqual((await call("GET", `/v1/invites/${INV}/request`)).body, { blob: "RQ" });
  assert.deepEqual((await call("GET", `/v1/invites/${INV}/accept`, { token: null, headers: proofHeaders })).body, { blob: null });
  assert.equal((await call("POST", `/v1/invites/${INV}/accept`, { body: { blob: "AC" } })).status, 200);
  assert.deepEqual((await call("GET", `/v1/invites/${INV}/accept`, { token: null, headers: proofHeaders })).body, { blob: "AC" });
  // Gone after collection
  assert.equal((await call("GET", `/v1/invites/${INV}/accept`, { token: null, headers: proofHeaders })).status, 404);
});

test("invite: declined and expired invites are gone", async () => {
  const { call } = await withHousehold();
  const PROOF = "proof_aaaaaaaaaaaaaaaaaaaa";
  const proofHeaders = { "x-invite-proof": PROOF };
  await call("POST", "/v1/invites", { body: { id: "inv_declined000000000", hh: HH, proofHash: await sha256Hex(PROOF) } });
  await call("POST", "/v1/invites/inv_declined000000000/decline");
  assert.equal((await call("GET", "/v1/invites/inv_declined000000000/accept", { token: null, headers: proofHeaders })).status, 404);

  await call("POST", "/v1/invites", { body: { id: "inv_expired0000000000", hh: HH, proofHash: await sha256Hex(PROOF) } });
  const later = T0 + LIMITS.inviteTtlMs + 1;
  assert.equal(
    (await call("POST", "/v1/invites/inv_expired0000000000/request", { token: null, headers: proofHeaders, body: { blob: "RQ" }, now: later })).status,
    404,
  );
});

test("an invite can't be made for a household without its token", async () => {
  const { call } = await withHousehold();
  const r = await call("POST", "/v1/invites", {
    token: "tok_wrongwrongwrongwrongwrong",
    body: { id: "inv_aaaaaaaaaaaaaaaa", hh: HH, proofHash: await sha256Hex("x") },
  });
  assert.equal(r.status, 401);
});

test("clean-up removes old ops, expired invites and idle households", async () => {
  const { call, env } = await withHousehold();
  await call("PUT", `/v1/h/${HH}/log/${M1}/1`, { body: { blob: "AA" } });
  await cleanUp(env, T0 + LIMITS.opTtlMs + 1);
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM log").get().n, 0);
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM households").get().n, 1);
  await cleanUp(env, T0 + LIMITS.idleHouseholdMs + 1);
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM households").get().n, 0);
});

test("never stores the caller's IP address", async () => {
  const { env } = setup();
  const ip = "203.0.113.77";
  await handle(
    new Request("https://sync.example.com/v1/households", {
      method: "POST",
      headers: { "cf-connecting-ip": ip, "content-type": "application/json" },
      body: JSON.stringify({ id: HH, tokenHash: await sha256Hex(TOKEN) }),
    }),
    env,
    T0,
  );
  for (const t of ["households", "log", "cursors", "quota", "invites"]) {
    const rows = JSON.stringify(env.DB.db.prepare(`SELECT * FROM ${t}`).all());
    assert.ok(!rows.includes(ip), t);
  }
});

test("rate-limits household creation through the binding", async () => {
  const env = { DB: fakeD1(), CREATE_LIMITER: { limit: async () => ({ success: false }) } };
  const r = await handle(
    new Request("https://sync.example.com/v1/households", {
      method: "POST",
      body: JSON.stringify({ id: HH, tokenHash: await sha256Hex(TOKEN) }),
    }),
    env,
    T0,
  );
  assert.equal(r.status, 429);
});
