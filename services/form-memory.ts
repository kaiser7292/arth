/**
 * Small conveniences for the add-transaction form: the account last used for each kind of
 * entry, so the next one starts there. Backed up with the other preferences.
 */

import { settingsStorage } from "@/services/storage";

const LAST_SPENT_ACCOUNT = "form_last_account_spent";
const LAST_RECEIVED_ACCOUNT = "form_last_account_received";
const LAST_TRANSFER_FROM = "form_last_account_transfer_from";
const LAST_TRANSFER_TO = "form_last_account_transfer_to";

export type FormAccountSlot = "spent" | "received" | "transfer_from" | "transfer_to";

const KEY: Record<FormAccountSlot, string> = {
  spent: LAST_SPENT_ACCOUNT,
  received: LAST_RECEIVED_ACCOUNT,
  transfer_from: LAST_TRANSFER_FROM,
  transfer_to: LAST_TRANSFER_TO,
};

export function getLastAccount(slot: FormAccountSlot): string | null {
  return settingsStorage.getString(KEY[slot]) ?? null;
}

export function rememberAccount(slot: FormAccountSlot, accountId: string | null): void {
  if (!accountId) return;
  if (slot === "spent") settingsStorage.set(LAST_SPENT_ACCOUNT, accountId);
  else if (slot === "received") settingsStorage.set(LAST_RECEIVED_ACCOUNT, accountId);
  else if (slot === "transfer_from") settingsStorage.set(LAST_TRANSFER_FROM, accountId);
  else settingsStorage.set(LAST_TRANSFER_TO, accountId);
}
