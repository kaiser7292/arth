import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { bumpDataVersion } from "@/services/settings";
import { logger } from "@/utils/logger";
import {
  envelopeKeyVersion,
  newHouseholdKey,
  openOp,
  relayToken,
  sealOp,
  sealTo,
  sha256Hex,
  toBase64,
} from "./crypto";
import { getDeviceId } from "./device";
import { addHouseholdKeyVersion, deleteHouseholdKeys, getHouseholdKey, getMemberKeys } from "./keys";
import { applyOp, type ApplyResult } from "./apply";
import { publish } from "./publisher";
import { relay, RelayError } from "./relay-client";
import {
  enqueue,
  getActiveHousehold,
  getCursors,
  getMembers,
  getUnsent,
  markSent,
  pruneOutbox,
  renumberUnsent,
  setCursor,
  updateHousehold,
} from "./store";
import type { Household, HouseholdMember, HouseholdStatus, Op, OpBody } from "./types";

/**
 * One household sync: fetch and apply the others' changes, queue this phone's, send them, and tell
 * the relay what this phone has (so it can delete it). Design: docs/HOUSEHOLD_PHASE1_DESIGN.md §3.3.
 *
 * Runs when Arth opens, a few seconds after a change, from the background task and on pull to
 * refresh. Never throws: the outcome lands in households.last_sync_error, which the screens show.
 */

export interface SyncResult {
  ran: boolean;
  changed: boolean;
  error?: string;
  status?: HouseholdStatus;
}

let inFlight: Promise<SyncResult> | null = null;

/** Runs a sync, or joins the one already running. */
export function syncHousehold(): Promise<SyncResult> {
  if (!inFlight) {
    inFlight = run().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

let debounce: ReturnType<typeof setTimeout> | null = null;
/** A sync's own "data changed" signal must not schedule another sync. */
let quietUntil = 0;

/** For the app-wide data-change listener: sync soon after the person changes something. */
export function requestSyncAfterChange(): void {
  if (Date.now() < quietUntil) return;
  requestSync();
}

/** Sync a few seconds from now; repeated calls push it back (a burst of edits = one sync). */
export function requestSync(delayMs = 5000): void {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void syncHousehold();
  }, delayMs);
}

const errorText = (e: unknown) =>
  e instanceof RelayError
    ? e.status === 0
      ? "offline"
      : `relay ${e.status}`
    : e instanceof Error
      ? e.message
      : String(e);

async function run(): Promise<SyncResult> {
  let h = await getActiveHousehold();
  if (!h) return { ran: false, changed: false };
  try {
    const result = await syncOnce(h);
    h = (await getActiveHousehold()) ?? h;
    if (result.status && result.status !== "active") return result;
    await updateHousehold(h.id, { last_sync_at: new Date().toISOString(), last_sync_error: null });
    quietUntil = Date.now() + 1500;
    bumpDataVersion();
    return result;
  } catch (e) {
    if (e instanceof RelayError && e.status === 404) {
      await endHousehold(h, "closed");
      quietUntil = Date.now() + 1500;
      bumpDataVersion();
      return { ran: true, changed: true, status: "closed" };
    }
    const error = errorText(e);
    if (error !== "offline") logger.warn("[household] sync failed", e);
    try {
      await updateHousehold(h.id, { last_sync_error: error });
    } catch {
      /* ignore */
    }
    return { ran: true, changed: false, error };
  }
}

async function tokenFor(h: Household): Promise<string> {
  const key = await getHouseholdKey(h.id, h.key_version);
  if (!key) throw new Error("no_keys");
  return relayToken(key);
}

async function syncOnce(start: Household): Promise<SyncResult> {
  let h = start;
  const mine = await getMemberKeys(h.id);
  if (!mine || !(await getHouseholdKey(h.id, h.key_version))) {
    await updateHousehold(h.id, { status: "no_keys" });
    return { ran: true, changed: true, status: "no_keys" };
  }
  const device = getDeviceId();
  let changed = false;
  let snapshotNeeded = false;
  let creatorShouldRekey = false;

  // ── 1. Pull ──
  let headChecked = false;
  for (let page = 0; page < 50; page++) {
    const cursors = await getCursors(h.id);
    const members = await getMembers(h.id, true);
    const since: Record<string, number> = {};
    for (const m of members) if (m.id !== h.my_member_id) since[m.id] = cursors[m.id] ?? 0;
    since[h.my_member_id] = 999_999_999_999; // never fetch my own ops back
    const log = await relay.getLog(h.relay_url, await tokenFor(h), h.id, since);

    if (!headChecked) {
      headChecked = true;
      const head = log.heads[h.my_member_id] ?? 0;
      if (head >= h.next_seq) {
        if (h.last_device_id === device) {
          // Someone else now writes as this member: the household moved to another phone.
          await updateHousehold(h.id, { status: "moved" });
          return { ran: true, changed: true, status: "moved" };
        }
        // Restored here from a backup: carry on after what the old phone sent, and re-send everything.
        await renumberUnsent(h.id, head + 1);
        await updateHousehold(h.id, { needs_snapshot: 1, last_device_id: device });
        h = (await getActiveHousehold()) ?? h;
      }
    }

    let progressed = false;
    const byMember = new Map<string, { seq: number; blob: string }[]>();
    for (const o of log.ops) {
      if (o.m === h.my_member_id) continue;
      const list = byMember.get(o.m) ?? [];
      list.push({ seq: o.seq, blob: o.blob });
      byMember.set(o.m, list);
    }
    // The creator first: approvals and new keys come from there.
    const order = [...byMember.keys()].sort((a, b) => {
      const ra = members.find((m) => m.id === a)?.role === "creator" ? 0 : 1;
      const rb = members.find((m) => m.id === b)?.role === "creator" ? 0 : 1;
      return ra - rb;
    });

    for (const memberId of order) {
      for (const { seq, blob } of byMember.get(memberId) ?? []) {
        const author = (await getMembers(h.id, true)).find((m) => m.id === memberId);
        // Not known yet (approved in an op not applied yet) - try again next sync.
        if (!author) break;
        progressed = true;
        let version: number;
        try {
          version = envelopeKeyVersion(blob);
        } catch {
          await setCursor(h.id, memberId, seq);
          continue;
        }
        const key = await getHouseholdKey(h.id, version);
        if (!key) {
          progressed = false; // a newer key this phone doesn't have yet (its rekey op comes later)
          break;
        }
        const op = openOp<Op>(blob, key, author.sign_public);
        if (!op || op.m !== memberId || op.hh !== h.id || op.seq !== seq) {
          // Tampered or forged: skip it for good.
          logger.warn("[household] dropped an op that failed verification", { memberId, seq });
          await setCursor(h.id, memberId, seq);
          continue;
        }
        // A removed member's later ops don't count.
        if (author.removed_at && op.body.kind !== "member.leave") {
          await setCursor(h.id, memberId, seq);
          continue;
        }
        let res: ApplyResult = { changed: false };
        const db = getDatabase();
        await db.withTransactionAsync(async () => {
          res = await applyOp(h, author as HouseholdMember, op);
          await setCursor(h.id, memberId, seq);
        });
        if (res.stop === "removed") {
          await endHousehold(h, "removed");
          return { ran: true, changed: true, status: "removed" };
        }
        changed = changed || res.changed;
        snapshotNeeded = snapshotNeeded || !!res.needsSnapshot;
        creatorShouldRekey = creatorShouldRekey || !!res.creatorShouldRekey;
        if (res.rekeyed) h = (await getActiveHousehold()) ?? h;
      }
    }

    // Fell behind ops the relay already deleted: ask that member to re-send everything.
    const cursorsAfter = await getCursors(h.id);
    const gaps: OpBody[] = [];
    for (const [m, r] of Object.entries(log.ranges)) {
      if (m === h.my_member_id) continue;
      const c = cursorsAfter[m] ?? 0;
      if (r.min > c + 1) {
        gaps.push({ kind: "resync.request", from: m });
        await setCursor(h.id, m, r.min - 1);
      }
    }
    if (gaps.length) await enqueue(h.id, gaps);

    // Stop when nothing more can be applied this time (waiting for an approval or a key).
    if (!log.more || !progressed) break;
  }

  // ── 2. Queue this phone's changes ──
  if (snapshotNeeded) {
    await updateHousehold(h.id, { needs_snapshot: 1 });
    h = (await getActiveHousehold()) ?? h;
  }
  await publish(h, DEFAULT_USER_ID);

  // ── 3. Send ──
  await pushOutbox(h, device);

  // ── 4. Tell the relay what this phone has, so it can delete it ──
  const cursors = await getCursors(h.id);
  await relay.ack(h.relay_url, await tokenFor(h), h.id, h.my_member_id, cursors);
  await pruneOutbox(h.id);

  if (creatorShouldRekey && h.role === "creator") await rekey(h);

  return { ran: true, changed };
}

/** Seals and sends every queued op, in order. */
export async function pushOutbox(h: Household, device: string = getDeviceId()): Promise<void> {
  const mine = await getMemberKeys(h.id);
  const key = await getHouseholdKey(h.id, h.key_version);
  if (!mine || !key) throw new Error("no_keys");
  const token = relayToken(key);
  for (;;) {
    const batch = await getUnsent(h.id, 100);
    if (batch.length === 0) break;
    for (const row of batch) {
      const op: Op = {
        v: 1,
        hh: h.id,
        m: h.my_member_id,
        dev: device,
        seq: row.seq,
        at: Date.now(),
        body: JSON.parse(row.op_json) as OpBody,
      };
      await relay.putOp(h.relay_url, token, h.id, h.my_member_id, row.seq, sealOp(op, key, h.key_version, mine.signSecret));
      await markSent(h.id, row.seq);
    }
  }
  if (h.last_device_id !== device) await updateHousehold(h.id, { last_device_id: device });
}

/**
 * Creator only: a new household key for everyone still in it, so whoever left or was removed can't
 * read anything sent from now on. The rekey op itself goes out under the old key (that's how the
 * others read it); the relay keeps accepting the old token for reading for a while.
 */
export async function rekey(start: Household): Promise<void> {
  const h = (await getActiveHousehold()) ?? start;
  if (h.role !== "creator") return;
  const mine = await getMemberKeys(h.id);
  if (!mine) throw new Error("no_keys");
  const oldToken = await tokenFor(h);
  const version = h.key_version + 1;
  const key = newHouseholdKey();
  const sealed: Record<string, string> = {};
  for (const m of await getMembers(h.id)) {
    if (m.id === h.my_member_id) continue;
    sealed[m.id] = sealTo({ version, key: toBase64(key) }, m.box_public, mine.boxSecret);
  }
  await enqueue(h.id, [{ kind: "household.rekey", version, sealed }]);
  await pushOutbox(h);
  await relay.swapToken(h.relay_url, oldToken, h.id, await sha256Hex(relayToken(key)));
  await addHouseholdKeyVersion(h.id, version, key);
  await updateHousehold(h.id, { key_version: version });
}

/**
 * This phone is no longer in the household (left, removed, closed, moved away): forget what others
 * shared and the keys. The household row stays with its status so the screen can say what happened;
 * dismissing that message removes it (forgetHousehold).
 */
export async function endHousehold(h: Household, status: HouseholdStatus): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    for (const table of [
      "household_cursors",
      "household_outbox",
      "household_items",
      "household_balance_accounts",
      "household_category_map",
      "household_categories",
      "household_members",
    ]) {
      await db.runAsync(`DELETE FROM ${table} WHERE household_id = ?;`, h.id);
    }
    await db.runAsync(
      "UPDATE households SET status = ?, left_at = datetime('now'), last_sync_error = NULL WHERE id = ?;",
      status,
      h.id,
    );
  });
  await deleteHouseholdKeys(h.id);
}
