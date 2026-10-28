/**
 * Arth household relay: a locked mailbox for household sync.
 *
 * Phones in a household send each other end-to-end encrypted changes ("ops") through here. The relay
 * stores them as opaque base64 envelopes under random IDs and hands them out to the other phones;
 * it has no key and can't read them. Design: docs/HOUSEHOLD_PHASE1_DESIGN.md (section 5).
 *
 * Privacy rules this file must keep (they back the Play Data safety answers):
 *   - never store or log an IP address, or anything derived from one (rate limiting by IP uses
 *     Cloudflare's rate-limiting binding, which counts in memory);
 *   - never log request bodies; no analytics;
 *   - delete what a phone no longer needs: acknowledged ops, anything after 90 days, invites after
 *     24 hours, households idle for a year, a member's log as soon as they leave.
 *
 * Auth: every household route needs `Authorization: Bearer <relay token>`. The token is derived on
 * the phones from the household key; the relay keeps only its SHA-256. Invite routes for the joining
 * phone use `X-Invite-Proof`, derived from the invite secret, likewise stored only as a hash.
 */

export const LIMITS = {
  maxOpBytes: 64 * 1024,
  opsPerDay: 2000,
  pageSize: 500,
  opTtlMs: 90 * 24 * 60 * 60 * 1000,
  inviteTtlMs: 24 * 60 * 60 * 1000,
  idleHouseholdMs: 365 * 24 * 60 * 60 * 1000,
  maxBodyBytes: 96 * 1024,
};

const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function checkId(value) {
  if (typeof value !== "string" || !ID_RE.test(value)) throw new HttpError(400, "bad_id");
  return value;
}

function checkHash(value) {
  if (typeof value !== "string" || !HASH_RE.test(value)) throw new HttpError(400, "bad_hash");
  return value;
}

function checkBlob(value) {
  if (typeof value !== "string" || value.length === 0 || !/^[A-Za-z0-9+/=]+$/.test(value)) {
    throw new HttpError(400, "bad_blob");
  }
  if (value.length > Math.ceil((LIMITS.maxOpBytes * 4) / 3) + 4) throw new HttpError(413, "too_large");
  return value;
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > LIMITS.maxBodyBytes) throw new HttpError(413, "too_large");
  try {
    const body = JSON.parse(text || "{}");
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, "bad_json");
  }
}

function bearer(request) {
  const header = request.headers.get("authorization") || "";
  const m = /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(header);
  if (!m) throw new HttpError(401, "unauthorized");
  return m[1];
}

/** Checks the relay token for household `hh`; bumps its activity at most once a day. */
async function authHousehold(env, request, hh, now) {
  const tokenHash = await sha256Hex(bearer(request));
  const row = await env.DB.prepare("SELECT token_hash, last_active_at FROM households WHERE id = ?1")
    .bind(hh)
    .first();
  // Same answer whether the household doesn't exist or the token is wrong.
  if (!row || row.token_hash !== tokenHash) throw new HttpError(401, "unauthorized");
  if (now - row.last_active_at > DAY_MS) {
    await env.DB.prepare("UPDATE households SET last_active_at = ?2 WHERE id = ?1").bind(hh, now).run();
  }
}

async function authInvite(env, request, inviteId, now) {
  const proof = request.headers.get("x-invite-proof") || "";
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(proof)) throw new HttpError(401, "unauthorized");
  const row = await env.DB.prepare("SELECT * FROM invites WHERE id = ?1").bind(inviteId).first();
  if (!row || row.expires_at < now) throw new HttpError(404, "gone");
  if (row.proof_hash !== (await sha256Hex(proof))) throw new HttpError(401, "unauthorized");
  return row;
}

/** Parses `since=m1:12,m2:40` into { m1: 12, m2: 40 }. */
function parseSince(value) {
  const out = {};
  if (!value) return out;
  for (const part of value.split(",")) {
    const [m, s] = part.split(":");
    checkId(m);
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0) throw new HttpError(400, "bad_since");
    out[m] = n;
  }
  if (Object.keys(out).length > 16) throw new HttpError(400, "bad_since");
  return out;
}

/**
 * Deletes ops every reader has acknowledged. Readers are the members with a cursor row; an author
 * never needs its own ops back. A phone that joins later catches up from snapshots, not old ops.
 */
async function prune(env, hh) {
  const { results: cursorRows } = await env.DB.prepare("SELECT member, acked_json FROM cursors WHERE hh = ?1")
    .bind(hh)
    .all();
  const { results: authors } = await env.DB.prepare("SELECT DISTINCT member FROM log WHERE hh = ?1").bind(hh).all();
  for (const { member: author } of authors) {
    let floor = Infinity;
    for (const row of cursorRows) {
      if (row.member === author) continue;
      let acked = {};
      try {
        acked = JSON.parse(row.acked_json);
      } catch {
        /* treat as nothing acked */
      }
      floor = Math.min(floor, Number(acked[author]) || 0);
    }
    if (floor === Infinity || floor <= 0) continue;
    await env.DB.prepare("DELETE FROM log WHERE hh = ?1 AND member = ?2 AND seq <= ?3").bind(hh, author, floor).run();
  }
}

async function deleteHousehold(env, hh) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM log WHERE hh = ?1").bind(hh),
    env.DB.prepare("DELETE FROM cursors WHERE hh = ?1").bind(hh),
    env.DB.prepare("DELETE FROM heads WHERE hh = ?1").bind(hh),
    env.DB.prepare("DELETE FROM quota WHERE hh = ?1").bind(hh),
    env.DB.prepare("DELETE FROM invites WHERE hh = ?1").bind(hh),
    env.DB.prepare("DELETE FROM households WHERE id = ?1").bind(hh),
  ]);
}

/** Daily clean-up (cron), also safe to call any time. */
export async function cleanUp(env, now = Date.now()) {
  await env.DB.prepare("DELETE FROM log WHERE created_at < ?1").bind(now - LIMITS.opTtlMs).run();
  await env.DB.prepare("DELETE FROM invites WHERE expires_at < ?1").bind(now).run();
  await env.DB.prepare("DELETE FROM quota WHERE day < ?1")
    .bind(new Date(now - 2 * DAY_MS).toISOString().slice(0, 10))
    .run();
  const { results: idle } = await env.DB.prepare("SELECT id FROM households WHERE last_active_at < ?1")
    .bind(now - LIMITS.idleHouseholdMs)
    .all();
  for (const { id } of idle) await deleteHousehold(env, id);
}

async function route(request, env, now) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const method = request.method;

  if (parts[0] !== "v1") throw new HttpError(404, "not_found");
  const p = parts.slice(1);

  if (method === "GET" && p.length === 1 && p[0] === "health") return json({ ok: true });

  // ── Households ──
  if (method === "POST" && p.length === 1 && p[0] === "households") {
    if (env.CREATE_LIMITER) {
      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      const { success } = await env.CREATE_LIMITER.limit({ key: ip });
      if (!success) throw new HttpError(429, "slow_down");
    }
    const body = await readJson(request);
    const id = checkId(body.id);
    const tokenHash = checkHash(body.tokenHash);
    const existing = await env.DB.prepare("SELECT 1 FROM households WHERE id = ?1").bind(id).first();
    if (existing) throw new HttpError(409, "exists");
    await env.DB.prepare("INSERT INTO households (id, token_hash, created_at, last_active_at) VALUES (?1, ?2, ?3, ?3)")
      .bind(id, tokenHash, now)
      .run();
    return json({ ok: true }, 201);
  }

  if (p[0] === "h" && p.length >= 2) {
    const hh = checkId(p[1]);
    await authHousehold(env, request, hh, now);
    const rest = p.slice(2);

    // PUT /v1/h/:hh/log/:member/:seq
    if (method === "PUT" && rest.length === 3 && rest[0] === "log") {
      const member = checkId(rest[1]);
      const seq = Number(rest[2]);
      if (!Number.isInteger(seq) || seq < 1) throw new HttpError(400, "bad_seq");
      const blob = checkBlob((await readJson(request)).blob);
      const day = new Date(now).toISOString().slice(0, 10);
      const q = await env.DB.prepare("SELECT count FROM quota WHERE hh = ?1 AND day = ?2").bind(hh, day).first();
      if (q && q.count >= LIMITS.opsPerDay) throw new HttpError(429, "quota");
      const res = await env.DB.prepare(
        "INSERT OR IGNORE INTO log (hh, member, seq, blob, size, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      )
        .bind(hh, member, seq, blob, blob.length, now)
        .run();
      const inserted = (res.meta && res.meta.changes) > 0;
      if (inserted) {
        await env.DB.prepare(
          "INSERT INTO heads (hh, member, max_seq) VALUES (?1, ?2, ?3) ON CONFLICT (hh, member) DO UPDATE SET max_seq = MAX(max_seq, ?3)",
        )
          .bind(hh, member, seq)
          .run();
        await env.DB.prepare(
          "INSERT INTO quota (hh, day, count) VALUES (?1, ?2, 1) ON CONFLICT (hh, day) DO UPDATE SET count = count + 1",
        )
          .bind(hh, day)
          .run();
      }
      return json({ ok: true, duplicate: !inserted });
    }

    // GET /v1/h/:hh/log?since=m1:12,m2:40
    if (method === "GET" && rest.length === 1 && rest[0] === "log") {
      const since = parseSince(url.searchParams.get("since"));
      const limit = Math.min(Number(url.searchParams.get("limit")) || LIMITS.pageSize, LIMITS.pageSize);
      const binds = [hh];
      let cond = "";
      for (const [m, s] of Object.entries(since)) {
        binds.push(m, s);
        cond += ` WHEN ?${binds.length - 1} THEN seq > ?${binds.length}`;
      }
      const where = cond ? `AND (CASE member${cond} ELSE 1 END)` : "";
      binds.push(limit + 1);
      const { results } = await env.DB.prepare(
        `SELECT member, seq, blob FROM log WHERE hh = ?1 ${where} ORDER BY member, seq LIMIT ?${binds.length}`,
      )
        .bind(...binds)
        .all();
      const { results: ranges } = await env.DB.prepare(
        "SELECT member, MIN(seq) AS min, MAX(seq) AS max FROM log WHERE hh = ?1 GROUP BY member",
      )
        .bind(hh)
        .all();
      const { results: headRows } = await env.DB.prepare("SELECT member, max_seq FROM heads WHERE hh = ?1")
        .bind(hh)
        .all();
      const more = results.length > limit;
      return json({
        ops: results.slice(0, limit).map((r) => ({ m: r.member, seq: r.seq, blob: r.blob })),
        more,
        // Lets a phone notice it fell behind ops the relay has already deleted (min > its cursor + 1).
        ranges: Object.fromEntries(ranges.map((r) => [r.member, { min: r.min, max: r.max }])),
        // Highest seq each member has ever written, kept after its ops are pruned: a phone restored
        // from a backup continues after it, and the old phone sees someone else now writes as it.
        heads: Object.fromEntries(headRows.map((r) => [r.member, r.max_seq])),
      });
    }

    // POST /v1/h/:hh/ack { member, cursors: { m: seq } }
    if (method === "POST" && rest.length === 1 && rest[0] === "ack") {
      const body = await readJson(request);
      const member = checkId(body.member);
      const cursors = {};
      for (const [m, s] of Object.entries(body.cursors || {})) {
        checkId(m);
        if (!Number.isInteger(s) || s < 0) throw new HttpError(400, "bad_cursor");
        cursors[m] = s;
      }
      if (Object.keys(cursors).length > 16) throw new HttpError(400, "bad_cursor");
      await env.DB.prepare(
        "INSERT INTO cursors (hh, member, acked_json, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (hh, member) DO UPDATE SET acked_json = ?3, updated_at = ?4",
      )
        .bind(hh, member, JSON.stringify(cursors), now)
        .run();
      await prune(env, hh);
      return json({ ok: true });
    }

    // POST /v1/h/:hh/token { tokenHash }  (rekey after removing a member)
    if (method === "POST" && rest.length === 1 && rest[0] === "token") {
      const tokenHash = checkHash((await readJson(request)).tokenHash);
      await env.DB.prepare("UPDATE households SET token_hash = ?2 WHERE id = ?1").bind(hh, tokenHash).run();
      return json({ ok: true });
    }

    // DELETE /v1/h/:hh/member/:member  (leave / remove: delete that member's data now)
    if (method === "DELETE" && rest.length === 2 && rest[0] === "member") {
      const member = checkId(rest[1]);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM log WHERE hh = ?1 AND member = ?2").bind(hh, member),
        env.DB.prepare("DELETE FROM cursors WHERE hh = ?1 AND member = ?2").bind(hh, member),
        env.DB.prepare("DELETE FROM heads WHERE hh = ?1 AND member = ?2").bind(hh, member),
      ]);
      return json({ ok: true });
    }

    // DELETE /v1/h/:hh  (close)
    if (method === "DELETE" && rest.length === 0) {
      await deleteHousehold(env, hh);
      return json({ ok: true });
    }

    throw new HttpError(404, "not_found");
  }

  // ── Invites ──
  if (p[0] === "invites") {
    // POST /v1/invites { id, hh, proofHash }  (auth: household token)
    if (method === "POST" && p.length === 1) {
      const body = await readJson(request);
      const id = checkId(body.id);
      const hh = checkId(body.hh);
      const proofHash = checkHash(body.proofHash);
      await authHousehold(env, request, hh, now);
      const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM invites WHERE hh = ?1 AND expires_at >= ?2")
        .bind(hh, now)
        .all();
      if (results[0].n >= 10) throw new HttpError(429, "too_many_invites");
      await env.DB.prepare(
        "INSERT INTO invites (id, hh, proof_hash, expires_at) VALUES (?1, ?2, ?3, ?4)",
      )
        .bind(id, hh, proofHash, now + LIMITS.inviteTtlMs)
        .run();
      return json({ ok: true, expiresAt: now + LIMITS.inviteTtlMs }, 201);
    }

    if (p.length === 3) {
      const id = checkId(p[1]);
      const action = p[2];

      // Joining phone (auth: invite proof)
      if (action === "request" && method === "POST") {
        const invite = await authInvite(env, request, id, now);
        if (invite.request_blob) throw new HttpError(409, "already_requested");
        const blob = checkBlob((await readJson(request)).blob);
        await env.DB.prepare("UPDATE invites SET request_blob = ?2 WHERE id = ?1").bind(id, blob).run();
        return json({ ok: true });
      }
      if (action === "accept" && method === "GET") {
        const invite = await authInvite(env, request, id, now);
        if (!invite.accept_blob) return json({ blob: null });
        // One use: the key bundle is handed over once, then the invite is gone.
        await env.DB.prepare("DELETE FROM invites WHERE id = ?1").bind(id).run();
        return json({ blob: invite.accept_blob });
      }

      // Inviting phone (auth: household token)
      const invite = await env.DB.prepare("SELECT * FROM invites WHERE id = ?1").bind(id).first();
      if (!invite || invite.expires_at < now) throw new HttpError(404, "gone");
      await authHousehold(env, request, invite.hh, now);
      if (action === "request" && method === "GET") return json({ blob: invite.request_blob || null });
      if (action === "accept" && method === "POST") {
        if (!invite.request_blob) throw new HttpError(409, "no_request");
        const blob = checkBlob((await readJson(request)).blob);
        await env.DB.prepare("UPDATE invites SET accept_blob = ?2 WHERE id = ?1").bind(id, blob).run();
        return json({ ok: true });
      }
      if (action === "decline" && method === "POST") {
        await env.DB.prepare("DELETE FROM invites WHERE id = ?1").bind(id).run();
        return json({ ok: true });
      }
    }
    throw new HttpError(404, "not_found");
  }

  throw new HttpError(404, "not_found");
}

export async function handle(request, env, now = Date.now()) {
  try {
    return await route(request, env, now);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code }, e.status);
    // Never echo internals (or anything from the request) back.
    return json({ error: "server" }, 500);
  }
}

export default {
  fetch: (request, env) => handle(request, env),
  scheduled: (_event, env, ctx) => ctx.waitUntil(cleanUp(env)),
};
