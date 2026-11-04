import type { Href } from "expo-router";

import { getAngelLastSynced, getCachedAngelHoldings } from "@/services/angel-connect";
import { brokerName, getBrokerLinkedAccount, type Broker } from "@/services/broker-link";
import { getCachedHoldings, getCachedMFHoldings, getLastSynced, getLinkedAccountId } from "@/services/kite-connect";
import {
  DEFAULT_SORT,
  angelHoldingRow,
  kiteHoldingRow,
  kiteMFRow,
  sortRows,
  zebpayBalanceRow,
  type PortfolioRow,
} from "@/services/portfolio-rows";
import { getZebpayCache, getZebpayLastSynced } from "@/services/zebpay-connect";

export interface AccountHoldings {
  broker: Broker;
  brokerLabel: string;
  /** Every holding, biggest first. */
  rows: PortfolioRow[];
  /** What the rows are worth now. */
  current: number;
  /** What they cost; null when the broker doesn't report buy prices (Zebpay). */
  invested: number | null;
  /** When the broker last synced (ISO), so the values aren't taken for live prices. */
  lastSynced: string | null;
  /** The broker's own screen, which has the full list and Sync. */
  route: Href;
}

function holdings(broker: Broker, rows: PortfolioRow[], invested: number | null, lastSynced: string | null, route: Href): AccountHoldings {
  return {
    broker,
    brokerLabel: brokerName(broker),
    rows: sortRows(rows, DEFAULT_SORT),
    current: rows.reduce((sum, r) => sum + (r.value ?? 0), 0),
    invested,
    lastSynced,
    route,
  };
}

/**
 * What the brokers linked to this account held at their last sync. Read from the saved sync data,
 * so opening an account never calls a broker. Empty for an account no broker is linked to: such
 * accounts only have snapshot totals, with no per-stock data.
 */
export function getHoldingsForAccount(accountId: string): AccountHoldings[] {
  const out: AccountHoldings[] = [];
  if (getLinkedAccountId() === accountId) {
    const stocks = getCachedHoldings();
    const funds = getCachedMFHoldings();
    // Same sum as the Kite screen's summary: shares still settling (T1) are held too.
    const invested =
      stocks.reduce((sum, h) => sum + (h.quantity + (h.t1_quantity ?? 0)) * h.average_price, 0) +
      funds.reduce((sum, h) => sum + h.quantity * h.average_price, 0);
    out.push(
      holdings("kite", [...stocks.map(kiteHoldingRow), ...funds.map(kiteMFRow)], invested, getLastSynced(), "/settings/kite-connect"),
    );
  }
  if (getBrokerLinkedAccount("angel") === accountId) {
    const stocks = getCachedAngelHoldings();
    const invested = stocks.reduce((sum, h) => sum + h.quantity * h.averageprice, 0);
    out.push(holdings("angel", stocks.map(angelHoldingRow), invested, getAngelLastSynced(), "/settings/angel-connect"));
  }
  if (getBrokerLinkedAccount("zebpay") === accountId) {
    out.push(holdings("zebpay", getZebpayCache().balances.map(zebpayBalanceRow), null, getZebpayLastSynced(), "/settings/zebpay-connect"));
  }
  return out.filter((h) => h.rows.length > 0);
}
