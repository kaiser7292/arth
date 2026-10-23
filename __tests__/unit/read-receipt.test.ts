import { parseDate, readReceipt } from "../../services/receipt/read-receipt";

/**
 * Payment screenshots as the phone's text recognition returns them (one block per line, ₹ often
 * misread). Modelled on Amazon Pay, Google Pay, PhonePe, Paytm and bank app receipts.
 */
const TODAY = new Date(2026, 9, 23);

describe("readReceipt", () => {
  it("Amazon Pay paid to Zomato from gift cards", () => {
    const g = readReceipt(
      [
        "amazon pay",
        "Transaction Details",
        "Paid successfully",
        "₹361.04",
        "Please connect with merchant in case of any issues",
        "Paid to",
        "Zomato Limited",
        "Paid from",
        "Gift Cards",
        "Order ID P04-2664993-4464137",
        "Date and time 18 Oct 2026, 1:05 PM",
      ],
      TODAY,
    );
    expect(g).toMatchObject({
      kind: "expense",
      amount: 361.04,
      party: "Zomato Limited",
      date: "2026-10-18",
      time: "13:05",
      ref: "P04-2664993-4464137",
      app: "Amazon Pay",
      notCompleted: false,
    });
    expect(g.account).toMatchObject({ label: "Gift Cards", wallet: true });
  });

  it("Google Pay with ₹ read as 7, paid from an HDFC account", () => {
    const g = readReceipt(
      ["G Pay", "7450.00", "Paid to", "SWIGGY", "Completed", "21 Oct 2026, 8:42 pm", "UPI transaction ID", "629412345678", "To: SWIGGY", "From: HDFC Bank •••• 0221"],
      TODAY,
    );
    expect(g.amount).toBe(450);
    expect(g.party).toBe("SWIGGY");
    expect(g.account).toMatchObject({ last4: "0221" });
    expect(g.ref).toBe("629412345678");
    expect(g.app).toBe("Google Pay");
    expect(g.date).toBe("2026-10-21");
  });

  it("PhonePe money received is a credit", () => {
    const g = readReceipt(["PhonePe", "Received from", "Rahul Sharma", "₹2,500", "Credited to", "ICICI Bank XX9304", "Transaction ID", "T2610231045123", "23 Oct 2026, 10:45 am"], TODAY);
    expect(g.kind).toBe("credit");
    expect(g.amount).toBe(2500);
    expect(g.party).toBe("Rahul Sharma");
    expect(g.account).toMatchObject({ last4: "9304" });
  });

  it("a self transfer names both accounts", () => {
    const g = readReceipt(["Self transfer", "₹25,000", "From", "HDFC Bank XX0221", "To", "SBI XX0006", "Successful", "20/10/2026"], TODAY);
    expect(g.kind).toBe("transfer");
    expect(g.amount).toBe(25000);
    expect(g.account?.last4).toBe("0221");
    expect(g.toAccount?.last4).toBe("0006");
    expect(g.date).toBe("2026-10-20");
  });

  it("an autopay SIP is committed", () => {
    const g = readReceipt(["Paytm", "AutoPay successful", "Rs. 5,000", "Paid to", "Zerodha Coin SIP", "05 Oct 2026"], TODAY);
    expect(g.kind).toBe("committed");
    expect(g.amount).toBe(5000);
    expect(g.party).toBe("Zerodha Coin SIP");
  });

  it("ignores balances and cashback when finding the amount, and flags a failed payment", () => {
    const g = readReceipt(["Payment failed", "₹1,299.00", "Paid to", "Netflix", "Cashback ₹50", "Available balance ₹9,876.00"], TODAY);
    expect(g.amount).toBe(1299);
    expect(g.notCompleted).toBe(true);
  });

  it("doesn't take a long reference number for the amount", () => {
    const g = readReceipt(["Paid to", "Uber", "629412345678", "₹286"], TODAY);
    expect(g.amount).toBe(286);
  });
});

describe("parseDate", () => {
  it.each([
    ["18 Oct 2026, 1:05 PM", "2026-10-18"],
    ["Oct 18, 2026", "2026-10-18"],
    ["18/10/2026", "2026-10-18"],
    ["18-10-26", "2026-10-18"],
    ["Today, 9:10 am", "2026-10-23"],
    ["Yesterday", "2026-10-22"],
  ])("%s", (text, want) => expect(parseDate(text, TODAY)).toBe(want));
});
