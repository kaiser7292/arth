import { getBrokerLinkedAccount } from "@/services/broker-link";
import { getAngelCredentials, isAngelConnected, syncAngelData } from "@/services/angel-connect";
import { saveBrokerSnapshot } from "@/services/financial-account";
import { getKiteCredentials, isKiteTokenExpired, syncKiteData } from "@/services/kite-connect";
import { isZebpayConnected, syncZebpayData } from "@/services/zebpay-connect";

/**
 * One tap in Investments: fetch each connected broker and save today's snapshot. A broker's trouble
 * stays its own, so the others still save. Zerodha's login ends every day and can only be renewed on
 * its own page, so that one comes back asking for a login rather than failing.
 */
export type SyncBroker = "kite" | "angel" | "zebpay";

export const SYNC_BROKER_NAMES: Record<SyncBroker, string> = { kite: "Zerodha", angel: "Angel One", zebpay: "Zebpay" };

export const SYNC_BROKER_ROUTES: Record<SyncBroker, string> = {
  kite: "/settings/kite-connect",
  angel: "/settings/angel-connect",
  zebpay: "/settings/zebpay-connect",
};

export type BrokerSyncResult =
  | { broker: SyncBroker; status: "saved"; portfolio: number; fund: number }
  | { broker: SyncBroker; status: "needs_login" }
  | { broker: SyncBroker; status: "needs_account" }
  | { broker: SyncBroker; status: "failed"; message: string };

const money = (v: string | number | null | undefined) => (typeof v === "number" ? v : parseFloat(v ?? "") || 0);

export async function getConnectedBrokers(): Promise<SyncBroker[]> {
  const [kite, angel] = await Promise.all([
    getKiteCredentials().catch(() => null),
    isAngelConnected() ? Promise.resolve(true) : getAngelCredentials().then((c) => !!c).catch(() => false),
  ]);
  const out: SyncBroker[] = [];
  if (kite?.apiKey) out.push("kite");
  if (angel) out.push("angel");
  if (isZebpayConnected()) out.push("zebpay");
  return out;
}

const looksLikeExpiredLogin = (message: string) => {
  const m = message.toLowerCase().replace(/_/g, " ");
  return message === "TOKEN_EXPIRED" || m.includes("access token") || m.includes("api key") || m.includes("invalid token") || m.includes("token expired");
};

export async function syncBroker(broker: SyncBroker): Promise<BrokerSyncResult> {
  try {
    if (broker === "kite") {
      if (isKiteTokenExpired()) return { broker, status: "needs_login" };
      const r = await syncKiteData();
      if (!r.linkedAccountId) return { broker, status: "needs_account" };
      const saved = await saveBrokerSnapshot(r.linkedAccountId, r.portfolioTotal, r.fundsAvailable);
      return { broker, status: "saved", ...saved };
    }

    const accountId = getBrokerLinkedAccount(broker);
    if (!accountId) return { broker, status: "needs_account" };

    if (broker === "angel") {
      const r = await syncAngelData();
      // Holdings without a total would save a false ₹0 over the real value.
      if (r.holdings.length > 0 && !r.totalHolding) {
        return { broker, status: "failed", message: "Angel One didn't send your portfolio total. Try again in a moment." };
      }
      const saved = await saveBrokerSnapshot(accountId, money(r.totalHolding?.totalholdingvalue), money(r.funds?.availablecash ?? r.funds?.net));
      return { broker, status: "saved", ...saved };
    }

    const r = await syncZebpayData();
    const saved = await saveBrokerSnapshot(accountId, r.totalInr, r.inrBalance);
    return { broker, status: "saved", ...saved };
  } catch (e) {
    const message = e instanceof Error && e.message ? e.message : "Couldn't sync.";
    if (message === "NO_ACCOUNT_LINKED") return { broker, status: "needs_account" };
    if (broker === "kite" && looksLikeExpiredLogin(message)) return { broker, status: "needs_login" };
    return { broker, status: "failed", message };
  }
}

export async function syncAllBrokers(): Promise<BrokerSyncResult[]> {
  const brokers = await getConnectedBrokers();
  return Promise.all(brokers.map(syncBroker));
}
