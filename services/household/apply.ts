import { fromBase64, openFrom } from "./crypto";
import { addHouseholdKeyVersion, getMemberKeys } from "./keys";
import {
  addEvent,
  deleteItem,
  deleteMemberItems,
  getMember,
  markMemberRemoved,
  setHouseholdCategories,
  setMemberSettings,
  updateHousehold,
  updateMemberProfile,
  upsertItem,
  upsertMember,
} from "./store";
import { CREATOR_ONLY, type Household, type HouseholdMember, type Op } from "./types";

/**
 * Applies one verified op from another member (or this member on another phone) to this phone's
 * database. Called inside a transaction by sync.ts, after the envelope was opened with the author's
 * signing key, so `op.m` is genuinely the author.
 *
 * Rules: a member only ever changes their own items; only the creator renames, changes categories,
 * approves, removes and rekeys. Anything else is ignored rather than failing the sync.
 */

export interface ApplyResult {
  /** This phone was removed, or the household closed: stop syncing. */
  stop?: "removed";
  /** Items changed that screens show. */
  changed: boolean;
  /** A new household key was received: the relay token changes. */
  rekeyed?: boolean;
  /** Someone joined: this phone re-sends everything for them. */
  needsSnapshot?: boolean;
  /** The creator must rekey (a member left), so the leaver can't read what comes next. */
  creatorShouldRekey?: boolean;
}

export async function applyOp(h: Household, author: HouseholdMember, op: Op): Promise<ApplyResult> {
  const body = op.body;
  const isCreator = author.role === "creator";
  if (CREATOR_ONLY.includes(body.kind) && !isCreator) return { changed: false };

  switch (body.kind) {
    case "member.profile":
      await updateMemberProfile(h.id, author.id, String(body.name).slice(0, 40), body.colour ?? null);
      return { changed: true };

    case "member.settings":
      await setMemberSettings(h.id, author.id, body.choices);
      return { changed: true };

    case "items.upsert": {
      // An item from yourself on another phone is only possible after a move; take it as-is.
      for (const it of body.items ?? []) {
        if (!it || typeof it.id !== "string") continue;
        await upsertItem(h.id, author.id, it);
      }
      return { changed: true };
    }

    case "items.delete":
      for (const id of body.ids ?? []) await deleteItem(h.id, author.id, id);
      return { changed: true };

    case "snapshot.begin":
      await deleteMemberItems(h.id, author.id);
      return { changed: true };

    case "snapshot.end":
      return { changed: false };

    case "resync.request":
      return { changed: false, needsSnapshot: body.from === h.my_member_id };

    case "household.rename":
      await updateHousehold(h.id, { name: String(body.name).slice(0, 40) });
      await addEvent(h.id, author.id, "renamed", { name: body.name });
      return { changed: true };

    case "household.categories":
      await setHouseholdCategories(
        h.id,
        (body.categories ?? []).slice(0, 30).map((c) => ({ id: String(c.id), name: String(c.name).slice(0, 40) })),
      );
      return { changed: true, needsSnapshot: true };

    case "member.approve": {
      const m = body.member;
      if (!m?.id || !m.boxPublic || !m.signPublic) return { changed: false };
      const existing = await getMember(h.id, m.id);
      await upsertMember(h.id, { ...m, role: m.role === "creator" ? "creator" : "member" });
      if (!existing || existing.removed_at) await addEvent(h.id, m.id, "joined");
      // Everyone re-sends their state so the newcomer starts with the full picture.
      return { changed: true, needsSnapshot: m.id !== h.my_member_id };
    }

    case "member.remove":
      if (body.memberId === h.my_member_id) return { changed: true, stop: "removed" };
      await markMemberRemoved(h.id, body.memberId);
      await addEvent(h.id, body.memberId, "removed");
      return { changed: true };

    case "member.leave":
      await markMemberRemoved(h.id, author.id);
      await addEvent(h.id, author.id, "left");
      return { changed: true, creatorShouldRekey: h.role === "creator" };

    case "household.rekey": {
      const sealed = body.sealed?.[h.my_member_id];
      // Not in the list: this phone was left out of the new key (removed). member.remove says so.
      if (!sealed || !(body.version > h.key_version)) return { changed: false };
      const mine = await getMemberKeys(h.id);
      if (!mine) return { changed: false };
      const opened = openFrom<{ version: number; key: string }>(sealed, author.box_public, mine.boxSecret);
      if (!opened || opened.version !== body.version) return { changed: false };
      await addHouseholdKeyVersion(h.id, body.version, fromBase64(opened.key));
      await updateHousehold(h.id, { key_version: body.version });
      await addEvent(h.id, author.id, "rekeyed");
      return { changed: false, rekeyed: true };
    }

    default:
      return { changed: false };
  }
}
