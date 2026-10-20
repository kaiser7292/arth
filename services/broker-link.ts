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

export type Broker = "kite" | "angel" | "zebpay";

const BROKER_NAME: Record<Broker, string> = { kite: "Zerodha", angel: "Angel One", zebpay: "Zebpay" };

export function brokerName(broker: Broker): string {
  return BROKER_NAME[broker];
}

/**
 * The account a broker's snapshots go into, created on the spot when there's none to pick: named
 * after the broker, numbered with the client ID when there is one (Kite then finds it by itself
 * next time), and valued at market. Zebpay's is a crypto account (taxed at a flat 30%).
 */
export async function createBrokerAccount(broker: Broker, clientId: string | null): Promise<string> {
  const { createManualAccount } = await import("@/services/financial-account");
  const { createInvestmentProductForAccount } = await import("@/services/investment-accounts");
  const { DEFAULT_USER_ID } = await import("@/constants/app");
  const name = BROKER_NAME[broker];
  const id = await createManualAccount({
    userId: DEFAULT_USER_ID,
    bankName: name,
    accountType: "investment",
    accountIdentifier: clientId?.trim() || name,
    accountLabel: name,
    accountNumber: clientId?.trim() || undefined,
  });
  await createInvestmentProductForAccount(id, broker === "zebpay" ? "crypto" : "equity", "market");
  return id;
}
