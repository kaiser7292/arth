/**
 * "Hide amounts" privacy toggle.
 *
 * Masks every money figure formatted through utils/format.ts
 * (formatAmount/formatCompact/formatNumber all check isAmountsHidden())
 * behind a fixed placeholder — independent of the real value, so the mask
 * itself never leaks the magnitude of what it's hiding, the way a password
 * field shows a fixed run of dots regardless of the password's real length.
 *
 * Reactivity: there is no dedicated subscription for this flag — it mirrors
 * every other display preference in services/locale-preferences.ts, which
 * has the same limitation (see that file's docstring). setAmountsHidden()
 * calls bumpDataVersion() so any screen using the existing useDataRefresh()
 * hook (the overwhelming majority of screens in this app) re-runs its load
 * callback and re-renders with the new value; a screen that doesn't use
 * useDataRefresh only picks up the change on its next mount/focus.
 */

import { settingsStorage } from "./storage";
import { bumpDataVersion } from "./settings";

const KEY = "privacy_hide_amounts";

let cache: boolean | null = null;

export function isAmountsHidden(): boolean {
  if (cache === null) cache = settingsStorage.getBoolean(KEY) ?? false;
  return cache;
}

export function setAmountsHidden(hidden: boolean): void {
  settingsStorage.set(KEY, hidden);
  cache = hidden;
  bumpDataVersion();
}

/** Flips the flag and returns the new value — convenient for a toggle button's onPress. */
export function toggleAmountsHidden(): boolean {
  const next = !isAmountsHidden();
  setAmountsHidden(next);
  return next;
}
