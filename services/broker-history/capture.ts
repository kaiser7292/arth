import { getDatabase } from "@/database";
import { getAngelCredentials, getAngelDayRecords, isAngelConnected } from "@/services/angel-connect";
import { getBrokerLinkedAccount } from "@/services/broker-link";
import { getKiteCredentials, getKiteDayRecords, getLinkedAccountId, isKiteTokenExpired } from "@/services/kite-connect";
import { bumpDataVersion } from "@/services/settings";
import { isBrokerCaptureOn } from "./enabled";
import { getZebpayCache, getZebpayOrderFills, isZebpayConnected } from "@/services/zebpay-connect";
import { todayIso } from "@/utils/local-date";
import { logger } from "@/utils/logger";
import { holdingsMap, mapAngelTrades, mapKiteMfOrders, mapKiteTrades, mapZebpayOrders } from "./api-map";
import { saveCaptureDay, saveDayMove, saveTrades } from "./store";
import type { ApiBroker } from "./types";

/**
 * Saves each day's trades, which Zerodha and Angel One only hold for that day. Safe to run any number
 * of times: the same trade is only ever kept once. A failure here never gets in the way of anything
 * else, because the day can still be filled from a report.
 */

export type CaptureResult =
  | { broker: ApiBroker; status: "saved"; newTrades: number }
  | { broker: ApiBroker; status: "off" | "needs_login" | "needs_account" | "not_connected" }
  | { broker: ApiBroker; status: "failed"; message: string };

const isConnected: Record<ApiBroker, () => Promise<boolean>> = {
  kite: async () => !!(await getKiteCredentials().catch(() => null))?.apiKey,
  angel: async () => isAngelConnected() || !!(await getAngelCredentials().catch(() => null)),
  zebpay: async () => isZebpayConnected(),
};

export function linkedAccountFor(broker: ApiBroker): string | null {
  return broker === "kite" ? getLinkedAccountId() : getBrokerLinkedAccount(broker);
}

export async function captureBroker(broker: ApiBroker, today: string = todayIso()): Promise<CaptureResult> {
  if (!isBrokerCaptureOn()) return { broker, status: "off" };
  try {
    if (!(await isConnected[broker]())) return { broker, status: "not_connected" };
    const accountId = linkedAccountFor(broker);
    if (!accountId) return { broker, status: "needs_account" };

    if (broker === "kite") {
      if (isKiteTokenExpired()) return { broker, status: "needs_login" };
      const d = await getKiteDayRecords();
      const trades = [...mapKiteTrades(d.trades, today), ...mapKiteMfOrders(d.mfOrders)];
      const newTrades = await saveTrades(accountId, broker, trades, "api");
      await saveDayMove(accountId, broker, today, "in", d.payin);
      await saveDayMove(accountId, broker, today, "out", d.payout);
      await saveCaptureDay(accountId, broker, today, trades.length, holdingsMap(d.holdings, "tradingsymbol", "t1_quantity"));
      if (newTrades > 0) bumpDataVersion();
      return { broker, status: "saved", newTrades };
    }

    if (broker === "angel") {
      const d = await getAngelDayRecords();
      const trades = mapAngelTrades(d.trades, today);
      const newTrades = await saveTrades(accountId, broker, trades, "api");
      await saveCaptureDay(accountId, broker, today, trades.length, holdingsMap(d.holdings, "tradingsymbol", "t1quantity"));
      if (newTrades > 0) bumpDataVersion();
      return { broker, status: "saved", newTrades };
    }

    // ZebPay answers by coin: those held now, and any traded before (a coin sold off isn't held any more).
    const db = getDatabase();
    const past = await db.getAllAsync<{ symbol: string; order_id: string | null }>(
      `SELECT DISTINCT symbol, order_id FROM broker_trades WHERE account_id = ? AND broker = 'zebpay';`,
      accountId,
    );
    const coins = new Set([...getZebpayCache().balances.map((b) => b.currency), ...past.map((p) => p.symbol)]);
    const known = new Set(past.map((p) => p.order_id).filter((o): o is string => !!o));
    const items = await getZebpayOrderFills([...coins].map((c) => `${c}-INR`), known);
    const trades = mapZebpayOrders(items);
    const newTrades = await saveTrades(accountId, broker, trades, "api");
    await saveCaptureDay(accountId, broker, today, trades.length, null);
    if (newTrades > 0) bumpDataVersion();
    return { broker, status: "saved", newTrades };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't save today's trades.";
    if (broker === "kite" && /TOKEN_EXPIRED|access token|invalid token|token expired/i.test(message)) {
      return { broker, status: "needs_login" };
    }
    logger.warn(`[broker-history] ${broker} capture failed`, e);
    return { broker, status: "failed", message };
  }
}

/** One at a time: each save writes to the database. */
export async function captureAllBrokers(today: string = todayIso()): Promise<CaptureResult[]> {
  const out: CaptureResult[] = [];
  for (const broker of ["kite", "angel", "zebpay"] as const) out.push(await captureBroker(broker, today));
  return out;
}

export async function isCapturedToday(broker: ApiBroker, today: string = todayIso()): Promise<boolean> {
  const row = await getDatabase().getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM broker_capture_days WHERE broker = ? AND capture_date = ?;`,
    broker,
    today,
  );
  return (row?.n ?? 0) > 0;
}

/** The brokers to save trades for. */
export async function connectedApiBrokers(): Promise<ApiBroker[]> {
  const out: ApiBroker[] = [];
  if (!isBrokerCaptureOn()) return out;
  for (const broker of ["kite", "angel", "zebpay"] as const) if (await isConnected[broker]()) out.push(broker);
  return out;
}
