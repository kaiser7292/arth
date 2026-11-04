import { customiseChanged, isPartOn } from "@/services/customise";
import { getFlag } from "@/services/feature-flags";
import { settingsStorage } from "@/services/storage";

/**
 * Broker records are optional, and off until switched on in Customise Arth. Off means no daily saves,
 * no reminders, no imports and no gains anywhere: the demat page's History only shows money in and out
 * from the transfers Arth detected. Off only hides: saved records stay and return when it's back on.
 *
 * The build flag can withdraw the whole feature. It also goes when Investments is switched off.
 */
const KEY = "broker_history_on";

export function isBrokerHistoryOn(): boolean {
  return getFlag("broker_history") && settingsStorage.getBoolean(KEY) === true && isPartOn("investments");
}

export function setBrokerHistoryOn(on: boolean): void {
  settingsStorage.set(KEY, on);
  customiseChanged();
}

