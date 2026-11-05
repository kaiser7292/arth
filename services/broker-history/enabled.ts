import { customiseChanged, isPartOn } from "@/services/customise";
import { getFlag } from "@/services/feature-flags";
import { settingsStorage } from "@/services/storage";

/**
 * Broker historic records are optional, and off until switched on in Customise Arth. Switching on
 * adds uploading past reports, and shows gains. Nothing Arth saved or detected is ever removed: a
 * report overwrites it only for the period the report covers.
 *
 * Off: no reminders, uploads or gains. The demat page's History shows money in and out from the
 * transfers Arth detected.
 *
 * Trades are saved each day either way. They can't be fetched later, so switching this on one day finds
 * them already there. Off only hides.
 *
 * The build flag can withdraw the whole feature, saving included. So does switching off Investments.
 */
const KEY = "broker_history_on";

/** Whether today's trades are kept. Doesn't depend on the switch: see above. */
export function isBrokerCaptureOn(): boolean {
  return getFlag("broker_history") && isPartOn("investments");
}

export function isBrokerHistoryOn(): boolean {
  return getFlag("broker_history") && settingsStorage.getBoolean(KEY) === true && isPartOn("investments");
}

export function setBrokerHistoryOn(on: boolean): void {
  settingsStorage.set(KEY, on);
  customiseChanged();
}

