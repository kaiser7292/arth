import { settingsStorage } from "@/services/storage";
import { newId } from "./crypto";
import { DEFAULT_RELAY_URL } from "./types";

/**
 * Per-phone household settings (MMKV, not backed up: they describe this phone, not the data).
 */

const DEVICE_ID_KEY = "household_device_id";
const RELAY_URL_KEY = "household_relay_url";

/** A random ID for this phone, so a restored copy can tell itself apart from the old phone. */
export function getDeviceId(): string {
  let id = settingsStorage.getString(DEVICE_ID_KEY);
  if (!id) {
    id = newId();
    settingsStorage.set(DEVICE_ID_KEY, id);
  }
  return id;
}

/** The relay new households use. Only changed for testing against a local relay. */
export function getRelayUrl(): string {
  return settingsStorage.getString(RELAY_URL_KEY) || DEFAULT_RELAY_URL;
}

export function setRelayUrl(url: string | null): void {
  if (url) settingsStorage.set(RELAY_URL_KEY, url);
  else settingsStorage.delete(RELAY_URL_KEY);
}
