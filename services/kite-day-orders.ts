/**
 * Today's Zerodha orders, in the portfolio total. A delivery trade made today isn't in holdings yet:
 * bought shares show up there after the day ends, and sold shares stay there until then. So without
 * this the total misses today's buys and still counts today's sells, while funds have already moved.
 *
 * Only filled delivery (CNC) orders count: intraday trades close the same day, rejected and open
 * orders didn't happen. Mutual fund orders aren't counted, because they take days to be allotted and
 * then arrive in holdings by themselves. Zerodha's order book only ever holds today's orders, so these
 * drop out by themselves once holdings catch up, which is what stops them counting twice.
 */

interface DayOrder {
  tradingsymbol: string;
  transaction_type: string;
  product: string;
  status: string;
  filled_quantity: number;
  average_price: number;
}

interface Priced {
  tradingsymbol: string;
  last_price: number;
}

export interface DayOrderTally {
  /** What was bought and sold today, at the traded price. */
  bought: number;
  sold: number;
  /** What today's trades add to (or take off) holdings, at the latest price. */
  holdingsChange: number;
  count: number;
}

export const NO_DAY_ORDERS: DayOrderTally = { bought: 0, sold: 0, holdingsChange: 0, count: 0 };

export function tallyDayOrders(orders: readonly DayOrder[], priced: readonly Priced[]): DayOrderTally {
  const latest = new Map(priced.filter((p) => p.last_price > 0).map((p) => [p.tradingsymbol, p.last_price]));
  const tally = { ...NO_DAY_ORDERS };
  const netBySymbol = new Map<string, { quantity: number; traded: number }>();

  for (const o of orders) {
    if (o.status !== "COMPLETE" || o.product !== "CNC" || !(o.filled_quantity > 0)) continue;
    const value = o.filled_quantity * o.average_price;
    const isBuy = o.transaction_type === "BUY";
    if (isBuy) tally.bought += value;
    else tally.sold += value;
    tally.count += 1;
    const net = netBySymbol.get(o.tradingsymbol) ?? { quantity: 0, traded: o.average_price };
    net.quantity += isBuy ? o.filled_quantity : -o.filled_quantity;
    netBySymbol.set(o.tradingsymbol, net);
  }

  for (const [symbol, net] of netBySymbol) {
    tally.holdingsChange += net.quantity * (latest.get(symbol) ?? net.traded);
  }
  return tally;
}
