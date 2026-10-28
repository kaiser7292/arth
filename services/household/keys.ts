import * as SecureStore from "expo-secure-store";
import { getDatabase } from "@/database";
import { fromBase64, toBase64, type MemberKeys } from "./crypto";

/**
 * Household keys, kept in SecureStore (the phone's keystore), never in the database.
 *
 * One entry per household: every household key version this phone has (old ones still open old ops
 * until they expire on the relay) and this phone's member keys. The encrypted backup carries them
 * next to the Vault key, so a restore on a new phone continues as the same member.
 */

interface StoredKeys {
  /** key version → household key (base64) */
  keys: Record<string, string>;
  member: MemberKeys;
}

const storeKey = (householdId: string) => `arth_household_${householdId.replace(/[^A-Za-z0-9_-]/g, "")}`;

async function read(householdId: string): Promise<StoredKeys | null> {
  const raw = await SecureStore.getItemAsync(storeKey(householdId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredKeys;
  } catch {
    return null;
  }
}

export async function saveHouseholdKeys(householdId: string, keys: Record<number, Uint8Array>, member: MemberKeys): Promise<void> {
  const stored: StoredKeys = {
    keys: Object.fromEntries(Object.entries(keys).map(([v, k]) => [v, toBase64(k)])),
    member,
  };
  await SecureStore.setItemAsync(storeKey(householdId), JSON.stringify(stored));
}

export async function addHouseholdKeyVersion(householdId: string, version: number, key: Uint8Array): Promise<void> {
  const stored = await read(householdId);
  if (!stored) throw new Error("This phone has no keys for the household");
  stored.keys[String(version)] = toBase64(key);
  await SecureStore.setItemAsync(storeKey(householdId), JSON.stringify(stored));
}

export async function getHouseholdKey(householdId: string, version: number): Promise<Uint8Array | null> {
  const stored = await read(householdId);
  const k = stored?.keys[String(version)];
  return k ? fromBase64(k) : null;
}

export async function getMemberKeys(householdId: string): Promise<MemberKeys | null> {
  return (await read(householdId))?.member ?? null;
}

export async function deleteHouseholdKeys(householdId: string): Promise<void> {
  await SecureStore.deleteItemAsync(storeKey(householdId));
}

/** For the backup: every household's keys, as stored. Safe: the backup file is encrypted. */
export async function exportHouseholdKeys(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const rows = await getDatabase().getAllAsync<{ id: string }>("SELECT id FROM households;");
    for (const { id } of rows) {
      const raw = await SecureStore.getItemAsync(storeKey(id));
      if (raw) out[id] = raw;
    }
  } catch {
    /* no households table on a very old schema: nothing to export */
  }
  return out;
}

export async function importHouseholdKeys(keys: Record<string, string>): Promise<void> {
  for (const [id, raw] of Object.entries(keys)) {
    try {
      JSON.parse(raw);
      await SecureStore.setItemAsync(storeKey(id), raw);
    } catch {
      /* skip a damaged entry rather than fail the restore */
    }
  }
}
