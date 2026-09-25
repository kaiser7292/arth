import { settingsStorage } from "@/services/storage";

/**
 * Which Arth account a broker's "Update snapshot" writes to, remembered on this device.
 *
 * Kite keeps its own (services/kite-connect.ts); Angel One and Zebpay held theirs only in screen
 * state, so the link was forgotten on every visit and each snapshot asked for the account again.
 */
export type LinkedBroker = "angel" | "zebpay";

const KEY: Record<LinkedBroker, string> = {
  angel: "angel_linked_account_id",
  zebpay: "zebpay_linked_account_id",
};

export function getBrokerLinkedAccount(broker: LinkedBroker): string | null {
  return settingsStorage.getString(KEY[broker]) ?? null;
}

export function setBrokerLinkedAccount(broker: LinkedBroker, accountId: string | null): void {
  if (accountId) settingsStorage.set(KEY[broker], accountId);
  else settingsStorage.delete(KEY[broker]);
}
