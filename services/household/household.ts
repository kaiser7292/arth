import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import {
  checkCode,
  fromBase64,
  inviteSecrets,
  newHouseholdKey,
  newId,
  newMemberKeys,
  openFrom,
  openWithSecret,
  randomBytes,
  relayToken,
  sealTo,
  sealWithSecret,
  sha256Hex,
  toBase64,
  toBase64Url,
  type MemberKeys,
} from "./crypto";
import { getRelayUrl } from "./device";
import { getHouseholdKey, getMemberKeys, saveHouseholdKeys, deleteHouseholdKeys } from "./keys";
import { relay, RelayError } from "./relay-client";
import {
  addEvent,
  autoMapCategories,
  choicesOf,
  deleteHouseholdData,
  enqueue,
  getActiveHousehold,
  getHousehold,
  getHouseholdCategories,
  getMembers,
  insertHousehold,
  markMemberRemoved,
  setHouseholdCategories,
  toMemberPublic,
  updateHousehold,
  upsertMember,
} from "./store";
import { endHousehold, pushOutbox, rekey, requestSync, syncHousehold } from "./sync";
import {
  DEFAULT_HOUSEHOLD_CATEGORIES,
  DEFAULT_RELAY_URL,
  INVITE_PAGE_URL,
  MAX_MEMBERS,
  MEMBER_COLOURS,
  type Household,
  type MemberPublic,
  type SharingChoices,
} from "./types";

/**
 * Starting, inviting, joining and leaving a household. Design: docs/HOUSEHOLD_PHASE1_DESIGN.md §2
 * and §4 ("Invite and join, in detail").
 */

const PENDING_INVITES = "arth_household_invites";
const PENDING_JOIN = "arth_household_join";

const clean = (s: string, max = 40) => s.replace(/\s+/g, " ").trim().slice(0, max);

// ─── Start ───

export async function startHousehold(householdName: string, myName: string): Promise<Household> {
  if (await getActiveHousehold()) throw new Error("You're already in a household");
  const name = clean(householdName) || "Home";
  const me = clean(myName) || "Me";
  const relayUrl = getRelayUrl();
  const id = newId();
  const memberId = newId();
  const key = newHouseholdKey();
  const keys = newMemberKeys();

  await relay.createHousehold(relayUrl, id, await sha256Hex(relayToken(key)));
  await saveHouseholdKeys(id, { 1: key }, keys);

  await insertHousehold({ id, name, my_member_id: memberId, role: "creator", relay_url: relayUrl });
  const meMember: MemberPublic = {
    id: memberId,
    name: me,
    colour: MEMBER_COLOURS[0],
    boxPublic: keys.boxPublic,
    signPublic: keys.signPublic,
    role: "creator",
  };
  await upsertMember(id, meMember);
  const categories = DEFAULT_HOUSEHOLD_CATEGORIES.map((n) => ({ id: newId(), name: n }));
  await setHouseholdCategories(id, categories);
  await autoMapCategories(id, DEFAULT_USER_ID);
  await enqueue(id, [{ kind: "household.categories", categories }]);
  await addEvent(id, memberId, "created", { name });
  bumpDataVersion();
  requestSync(0);
  return (await getActiveHousehold()) as Household;
}

// ─── Invite (the inviting phone) ───

interface PendingInvite {
  id: string;
  secret: string;
  expiresAt: number;
}

async function readPendingInvites(): Promise<PendingInvite[]> {
  try {
    const list = JSON.parse((await SecureStore.getItemAsync(PENDING_INVITES)) ?? "[]") as PendingInvite[];
    return list.filter((i) => i.expiresAt > Date.now());
  } catch {
    return [];
  }
}

async function writePendingInvites(list: PendingInvite[]): Promise<void> {
  await SecureStore.setItemAsync(PENDING_INVITES, JSON.stringify(list));
}

export interface Invite {
  id: string;
  link: string;
  expiresAt: number;
}

/** A one-time invite (24 hours). The secret only lives in the link and on this phone. */
export async function createInvite(): Promise<Invite> {
  const h = await requireActive();
  if ((await getMembers(h.id)).length >= MAX_MEMBERS) throw new Error(`A household can have up to ${MAX_MEMBERS} people`);
  const key = await getHouseholdKey(h.id, h.key_version);
  const mine = await getMemberKeys(h.id);
  if (!key || !mine) throw new Error("This phone has no keys for the household");
  const me = (await getMembers(h.id)).find((m) => m.id === h.my_member_id);

  const id = newId();
  const secret = randomBytes(32);
  const { proof } = inviteSecrets(secret);
  const { expiresAt } = await relay.createInvite(h.relay_url, relayToken(key), id, h.id, await sha256Hex(proof));
  await writePendingInvites([...(await readPendingInvites()), { id, secret: toBase64(secret), expiresAt }]);

  const params = new URLSearchParams({
    v: "1",
    i: id,
    s: toBase64Url(secret),
    k: mine.boxPublic.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    h: h.name,
    b: me?.name ?? "",
  });
  if (h.relay_url !== DEFAULT_RELAY_URL) params.set("r", h.relay_url);
  return { id, link: `${INVITE_PAGE_URL}#${params.toString()}`, expiresAt };
}

export interface JoinRequest {
  inviteId: string;
  name: string;
  device: string;
  code: string;
  boxPublic: string;
  signPublic: string;
}

/** Checks whether someone has asked to join through any of this phone's open invites. */
export async function getJoinRequests(): Promise<JoinRequest[]> {
  const h = await getActiveHousehold();
  if (!h) return [];
  const key = await getHouseholdKey(h.id, h.key_version);
  const mine = await getMemberKeys(h.id);
  if (!key || !mine) return [];
  const out: JoinRequest[] = [];
  const keep: PendingInvite[] = [];
  for (const inv of await readPendingInvites()) {
    try {
      const { blob } = await relay.getJoinRequest(h.relay_url, relayToken(key), inv.id);
      keep.push(inv);
      if (!blob) continue;
      const secret = fromBase64(inv.secret);
      const req = openWithSecret<{ name: string; device: string; boxPublic: string; signPublic: string }>(
        blob,
        inviteSecrets(secret).key,
      );
      if (!req?.boxPublic || !req.signPublic) continue;
      out.push({
        inviteId: inv.id,
        name: clean(String(req.name ?? "")) || "Someone",
        device: clean(String(req.device ?? ""), 60),
        code: checkCode(mine.boxPublic, req.boxPublic, secret),
        boxPublic: req.boxPublic,
        signPublic: req.signPublic,
      });
    } catch (e) {
      // Gone (expired / declined / collected): drop it. Offline: keep it for next time.
      if (!(e instanceof RelayError && (e.status === 404 || e.status === 401))) keep.push(inv);
    }
  }
  await writePendingInvites(keep);
  return out;
}

export async function approveJoin(req: JoinRequest): Promise<void> {
  const h = await requireActive();
  if (h.role !== "creator") throw new Error("Only the person who started the household can approve");
  const members = await getMembers(h.id);
  if (members.length >= MAX_MEMBERS) throw new Error(`A household can have up to ${MAX_MEMBERS} people`);
  const key = await getHouseholdKey(h.id, h.key_version);
  const mine = await getMemberKeys(h.id);
  if (!key || !mine) throw new Error("This phone has no keys for the household");

  const newMember: MemberPublic = {
    id: newId(),
    name: req.name,
    colour: MEMBER_COLOURS[members.length % MEMBER_COLOURS.length],
    boxPublic: req.boxPublic,
    signPublic: req.signPublic,
    role: "member",
  };
  const bundle = {
    v: 1,
    hh: h.id,
    name: h.name,
    relayUrl: h.relay_url,
    keyVersion: h.key_version,
    key: toBase64(key),
    memberId: newMember.id,
    members: [...members.map(toMemberPublic), newMember],
    categories: (await getHouseholdCategories(h.id)).map((c) => ({ id: c.id, name: c.name })),
  };
  await relay.postAccept(h.relay_url, relayToken(key), req.inviteId, sealTo(bundle, req.boxPublic, mine.boxSecret));

  await upsertMember(h.id, newMember);
  await enqueue(h.id, [{ kind: "member.approve", member: newMember }]);
  await updateHousehold(h.id, { needs_snapshot: 1 });
  await addEvent(h.id, newMember.id, "joined");
  await writePendingInvites((await readPendingInvites()).filter((i) => i.id !== req.inviteId));
  bumpDataVersion();
  requestSync(0);
}

export async function declineJoin(inviteId: string): Promise<void> {
  const h = await requireActive();
  const key = await getHouseholdKey(h.id, h.key_version);
  if (key) await relay.declineInvite(h.relay_url, relayToken(key), inviteId).catch(() => undefined);
  await writePendingInvites((await readPendingInvites()).filter((i) => i.id !== inviteId));
}

// ─── Join (the joining phone) ───

export interface InviteLink {
  inviteId: string;
  secret: string;
  inviterBoxPublic: string;
  householdName: string;
  inviterName: string;
  relayUrl: string;
}

/** Reads an invite from a scanned QR or a tapped link (the part after #). Null if it isn't one. */
export function parseInviteLink(text: string): InviteLink | null {
  const hash = text.includes("#") ? text.slice(text.indexOf("#") + 1) : "";
  if (!hash) return null;
  const p = new URLSearchParams(hash);
  const inviteId = p.get("i");
  const secret = p.get("s");
  const k = p.get("k");
  if (p.get("v") !== "1" || !inviteId || !secret || !k) return null;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(inviteId)) return null;
  const relayUrl = p.get("r") || DEFAULT_RELAY_URL;
  if (!/^https?:\/\//.test(relayUrl)) return null;
  return {
    inviteId,
    secret,
    inviterBoxPublic: toBase64(fromBase64(k)),
    householdName: clean(p.get("h") ?? "") || "a household",
    inviterName: clean(p.get("b") ?? ""),
    relayUrl,
  };
}

interface PendingJoin {
  link: InviteLink;
  myName: string;
  keys: MemberKeys;
  code: string;
}

export interface JoinState {
  status: "waiting" | "joined" | "declined";
  code?: string;
  householdName?: string;
}

/** Asks to join. Returns the check code to compare with the inviting phone. */
export async function requestToJoin(link: InviteLink, myName: string): Promise<string> {
  if (await getActiveHousehold()) throw new Error("You're already in a household. Leave it first.");
  const keys = newMemberKeys();
  const secret = fromBase64(link.secret);
  const { proof, key } = inviteSecrets(secret);
  const name = clean(myName) || "Me";
  const device = clean(deviceName(), 60);
  try {
    await relay.postJoinRequest(
      link.relayUrl,
      proof,
      link.inviteId,
      sealWithSecret({ name, device, boxPublic: keys.boxPublic, signPublic: keys.signPublic }, key),
    );
  } catch (e) {
    if (e instanceof RelayError && e.status === 404) throw new Error("This invite has expired or was already used. Ask for a new one.");
    if (e instanceof RelayError && e.status === 409) throw new Error("Someone has already used this invite. Ask for a new one.");
    throw e;
  }
  const code = checkCode(link.inviterBoxPublic, keys.boxPublic, secret);
  const pending: PendingJoin = { link, myName: name, keys, code };
  await SecureStore.setItemAsync(PENDING_JOIN, JSON.stringify(pending));
  return code;
}

export async function getPendingJoin(): Promise<{ code: string; householdName: string; inviterName: string } | null> {
  try {
    const raw = await SecureStore.getItemAsync(PENDING_JOIN);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingJoin;
    return { code: p.code, householdName: p.link.householdName, inviterName: p.link.inviterName };
  } catch {
    return null;
  }
}

export async function cancelPendingJoin(): Promise<void> {
  await SecureStore.deleteItemAsync(PENDING_JOIN);
}

interface AcceptBundle {
  v: 1;
  hh: string;
  name: string;
  relayUrl: string;
  keyVersion: number;
  key: string;
  memberId: string;
  members: MemberPublic[];
  categories: { id: string; name: string }[];
}

/** Checks whether the inviting phone approved; on approval sets the household up on this phone. */
export async function checkJoin(): Promise<JoinState> {
  const raw = await SecureStore.getItemAsync(PENDING_JOIN);
  if (!raw) return { status: (await getActiveHousehold()) ? "joined" : "declined" };
  const p = JSON.parse(raw) as PendingJoin;
  const { proof } = inviteSecrets(fromBase64(p.link.secret));
  let blob: string | null;
  try {
    ({ blob } = await relay.getAccept(p.link.relayUrl, proof, p.link.inviteId));
  } catch (e) {
    if (e instanceof RelayError && (e.status === 404 || e.status === 401)) {
      await cancelPendingJoin();
      return { status: "declined", householdName: p.link.householdName };
    }
    throw e;
  }
  if (!blob) return { status: "waiting", code: p.code, householdName: p.link.householdName };

  const bundle = openFrom<AcceptBundle>(blob, p.link.inviterBoxPublic, p.keys.boxSecret);
  if (!bundle?.hh || !bundle.key || !bundle.memberId) throw new Error("The invite answer couldn't be read");

  await saveHouseholdKeys(bundle.hh, { [bundle.keyVersion]: fromBase64(bundle.key) }, p.keys);
  await insertHousehold({
    id: bundle.hh,
    name: clean(bundle.name) || "Home",
    my_member_id: bundle.memberId,
    role: "member",
    relay_url: bundle.relayUrl || p.link.relayUrl,
  });
  await updateHousehold(bundle.hh, { key_version: bundle.keyVersion });
  for (const m of bundle.members ?? []) {
    if (m.id === bundle.memberId) {
      await upsertMember(bundle.hh, { ...m, name: p.myName, boxPublic: p.keys.boxPublic, signPublic: p.keys.signPublic, role: "member" });
    } else {
      await upsertMember(bundle.hh, m);
    }
  }
  await setHouseholdCategories(bundle.hh, bundle.categories ?? []);
  await autoMapCategories(bundle.hh, DEFAULT_USER_ID);
  await addEvent(bundle.hh, bundle.memberId, "joined");
  await cancelPendingJoin();
  bumpDataVersion();
  requestSync(0);
  return { status: "joined", householdName: bundle.name };
}

// ─── Sharing choices ───

export async function setSharingChoices(choices: SharingChoices): Promise<void> {
  const h = await requireActive();
  const before = choicesOf(h);
  await updateHousehold(h.id, {
    share_household_categories: choices.householdCategories ? 1 : 0,
    share_other_totals: choices.otherTotals ? 1 : 0,
    share_all_transactions: choices.allTransactions ? 1 : 0,
    share_savings_rate: choices.savingsRate ? 1 : 0,
    share_balances: choices.balances ? 1 : 0,
    // Re-send everything so what was turned off disappears from the others' phones too.
    needs_snapshot: JSON.stringify(before) === JSON.stringify(choices) ? h.needs_snapshot : 1,
  });
  bumpDataVersion();
  requestSync(1000);
}

export async function renameHousehold(name: string): Promise<void> {
  const h = await requireActive();
  if (h.role !== "creator") throw new Error("Only the person who started the household can rename it");
  const n = clean(name);
  if (!n) return;
  await updateHousehold(h.id, { name: n });
  await enqueue(h.id, [{ kind: "household.rename", name: n }]);
  bumpDataVersion();
  requestSync(0);
}

export async function saveHouseholdCategories(list: { id?: string; name: string }[]): Promise<void> {
  const h = await requireActive();
  if (h.role !== "creator") throw new Error("Only the person who started the household can change its categories");
  const categories = list
    .map((c) => ({ id: c.id ?? newId(), name: clean(c.name) }))
    .filter((c) => c.name)
    .slice(0, 30);
  await setHouseholdCategories(h.id, categories);
  await autoMapCategories(h.id, DEFAULT_USER_ID);
  await enqueue(h.id, [{ kind: "household.categories", categories }]);
  await updateHousehold(h.id, { needs_snapshot: 1 });
  bumpDataVersion();
  requestSync(0);
}

/** After changing which of my categories count as which household category. */
export async function categoriesRemapped(): Promise<void> {
  bumpDataVersion();
  requestSync(1000);
}

// ─── Leave, remove, close ───

/**
 * Leaves. Your ops are deleted from the relay at once; a single "left" op tells the others to delete
 * what you shared. The creator leaving closes the household for everyone (closeHousehold).
 */
export async function leaveHousehold(): Promise<void> {
  const h = await requireActive();
  if (h.role === "creator") return closeHousehold();
  const key = await getHouseholdKey(h.id, h.key_version);
  if (key) {
    const token = relayToken(key);
    try {
      await relay.deleteMember(h.relay_url, token, h.id, h.my_member_id);
      const fresh = (await getActiveHousehold()) ?? h;
      // Only the "left" op goes out: anything still queued is dropped.
      await getDatabase().runAsync("DELETE FROM household_outbox WHERE household_id = ? AND sent_at IS NULL;", fresh.id);
      await enqueue(fresh.id, [{ kind: "member.leave" }]);
      await pushOutbox((await getActiveHousehold()) ?? fresh);
    } catch (e) {
      if (!(e instanceof RelayError && e.status === 404)) throw e;
    }
  }
  await endHousehold(h, "left");
  await forgetHousehold();
}

/** Creator only: removes someone, deletes their data from the relay and changes the key. */
export async function removeMember(memberId: string): Promise<void> {
  const h = await requireActive();
  if (h.role !== "creator") throw new Error("Only the person who started the household can remove someone");
  if (memberId === h.my_member_id) throw new Error("Use Leave instead");
  const key = await getHouseholdKey(h.id, h.key_version);
  if (!key) throw new Error("This phone has no keys for the household");
  await enqueue(h.id, [{ kind: "member.remove", memberId }]);
  await pushOutbox(h);
  await relay.deleteMember(h.relay_url, relayToken(key), h.id, memberId);
  await markMemberRemoved(h.id, memberId);
  await addEvent(h.id, memberId, "removed");
  await rekey(h);
  bumpDataVersion();
}

/** Creator only: closes the household for everyone and deletes it from the relay. */
export async function closeHousehold(): Promise<void> {
  const h = await requireActive();
  if (h.role !== "creator") throw new Error("Only the person who started the household can close it");
  const key = await getHouseholdKey(h.id, h.key_version);
  if (key) {
    try {
      await relay.closeHousehold(h.relay_url, relayToken(key), h.id);
    } catch (e) {
      if (!(e instanceof RelayError && e.status === 404)) throw e;
    }
  }
  await endHousehold(h, "closed");
  await forgetHousehold();
}

/** Clears an ended household's row (after the "you were removed" / "closed" message). */
export async function forgetHousehold(): Promise<void> {
  const h = await getHousehold();
  if (h && h.status !== "active") {
    await deleteHouseholdData(h.id);
    await deleteHouseholdKeys(h.id);
  }
  bumpDataVersion();
}

/** "Google Pixel 8", "iPhone": shown to the inviter next to the check code. */
function deviceName(): string {
  if (Platform.OS === "ios") return "iPhone";
  const c = Platform.constants as { Manufacturer?: string; Model?: string };
  const make = c.Manufacturer ? c.Manufacturer[0].toUpperCase() + c.Manufacturer.slice(1) : "";
  return `${make} ${c.Model ?? "Android phone"}`;
}

async function requireActive(): Promise<Household> {
  const h = await getActiveHousehold();
  if (!h) throw new Error("You're not in a household");
  return h;
}

export { syncHousehold };
