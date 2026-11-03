import { NO_DAY_ORDERS, tallyDayOrders } from "../../services/kite-day-orders";

const order = (over: Partial<Parameters<typeof tallyDayOrders>[0][number]> = {}) => ({
  tradingsymbol: "ABC",
  transaction_type: "BUY",
  product: "CNC",
  status: "COMPLETE",
  filled_quantity: 10,
  average_price: 100,
  ...over,
});

describe("tallyDayOrders", () => {
  it("no orders changes nothing", () => {
    expect(tallyDayOrders([], [])).toEqual(NO_DAY_ORDERS);
  });

  it("a buy adds to holdings at the latest price, and shows what was paid", () => {
    expect(tallyDayOrders([order()], [{ tradingsymbol: "ABC", last_price: 110 }])).toEqual({ bought: 1000, sold: 0, holdingsChange: 1100, count: 1 });
  });

  it("a sell takes off holdings", () => {
    expect(tallyDayOrders([order({ transaction_type: "SELL" })], [{ tradingsymbol: "ABC", last_price: 110 }])).toEqual({ bought: 0, sold: 1000, holdingsChange: -1100, count: 1 });
  });

  it("buying and selling the same stock nets out", () => {
    const r = tallyDayOrders(
      [order({ filled_quantity: 10 }), order({ transaction_type: "SELL", filled_quantity: 4, average_price: 120 })],
      [{ tradingsymbol: "ABC", last_price: 110 }],
    );
    expect(r).toEqual({ bought: 1000, sold: 480, holdingsChange: 660, count: 2 });
  });

  it("leaves out intraday, rejected, cancelled and unfilled orders", () => {
    const r = tallyDayOrders(
      [order({ product: "MIS" }), order({ status: "REJECTED" }), order({ status: "CANCELLED" }), order({ status: "OPEN" }), order({ filled_quantity: 0 })],
      [{ tradingsymbol: "ABC", last_price: 110 }],
    );
    expect(r).toEqual(NO_DAY_ORDERS);
  });

  it("counts a part-filled quantity only", () => {
    expect(tallyDayOrders([order({ filled_quantity: 3 })], [{ tradingsymbol: "ABC", last_price: 100 }]).holdingsChange).toBe(300);
  });

  it("with no latest price, it uses the traded price rather than zero", () => {
    expect(tallyDayOrders([order()], []).holdingsChange).toBe(1000);
    expect(tallyDayOrders([order()], [{ tradingsymbol: "ABC", last_price: 0 }]).holdingsChange).toBe(1000);
  });
});
