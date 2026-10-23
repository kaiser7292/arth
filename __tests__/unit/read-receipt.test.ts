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
    expect(g.party).toBe("Swiggy"); // ALL CAPS tidied
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

describe("readReceipt - real-world shapes (after expenseMonster's parser tests)", () => {
  // Real screenshots start with the status bar: the clock must not become the payment time.
  const STATUS_BAR = ["10:42", "Vo LTE 4G", "85"];

  it("Google Pay paid: payee from 'To', time from the date line, account digits from the bank line", () => {
    const g = readReceipt(
      [...STATUS_BAR, "To RAMESH KUMAR", "+91 98765 43210", "₹500", "Completed", "12 Sep 2026, 7:45 pm", "HDFC Bank 1234", "UPI transaction ID", "425612345678", "To: RAMESH KUMAR", "Google Pay • ramesh.k@okaxis", "From: PRANAV N (HDFC Bank)", "Google Pay • pranav@okhdfcbank", "Google transaction ID", "CICAgOCxx12abc", "POWERED BY UPI"],
      TODAY,
    );
    expect(g).toMatchObject({ app: "Google Pay", kind: "expense", amount: 500, party: "Ramesh Kumar", vpa: "ramesh.k@okaxis", ref: "425612345678", date: "2026-09-12", time: "19:45" });
    expect(g.account?.last4).toBe("1234");
  });

  it("Google Pay received: 'From NAME' at the top is money received, from that person", () => {
    const g = readReceipt(
      [...STATUS_BAR, "From PRIYA SHARMA", "₹1,200", "Completed", "11 Sep 2026, 8:15 am", "HDFC Bank 1234", "UPI transaction ID", "425612345679", "To: PRANAV N (HDFC Bank)", "Google Pay • pranav@okhdfcbank", "From: PRIYA SHARMA", "Google Pay • priya.s@oksbi", "Google transaction ID", "CICAgOCyy34def"],
      TODAY,
    );
    expect(g).toMatchObject({ app: "Google Pay", kind: "credit", amount: 1200, party: "Priya Sharma", vpa: "priya.s@oksbi", date: "2026-09-11", time: "08:15" });
  });

  it("PhonePe paid: the amount between 'Paid to' and the name isn't taken as the name", () => {
    const g = readReceipt(
      [...STATUS_BAR, "Transaction Successful", "07:45 pm on 12 Sep 2026", "Paid to", "₹2,350", "SHREE GANESH MEDICALS", "Q123456789@ybl", "Transfer Details", "Transaction ID", "T2609121945123456789012", "Debited from", "XXXXXXXX1234", "₹2,350", "UTR: 425612345671", "Powered by UPI"],
      TODAY,
    );
    expect(g).toMatchObject({ app: "PhonePe", kind: "expense", amount: 2350, party: "Shree Ganesh Medicals", vpa: "q123456789@ybl", date: "2026-09-12", time: "19:45" });
    expect(g.account?.last4).toBe("1234");
  });

  it("BHIM paid, with ₹ read as %", () => {
    const g = readReceipt([...STATUS_BAR, "BHIM", "%499.00", "Paid Successfully", "To", "Airtel Prepaid", "airtelprepaid@upi", "12-09-2026 19:45:12", "UPI Ref No.", "425612345673", "From", "Pranav N", "XXXX1234"], TODAY);
    expect(g).toMatchObject({ app: "BHIM", kind: "expense", amount: 499, party: "Airtel Prepaid", vpa: "airtelprepaid@upi", ref: "425612345673", date: "2026-09-12", time: "19:45" });
    expect(g.account?.last4).toBe("1234");
  });

  it("BHIM received", () => {
    const g = readReceipt([...STATUS_BAR, "BHIM", "₹ 2,000.00", "Received Successfully", "From", "SURESH BABU", "suresh@upi", "10 Sep 2026, 09:30 AM", "UPI Ref No: 425612345674", "To", "Pranav N", "pranav@upi"], TODAY);
    expect(g).toMatchObject({ app: "BHIM", kind: "credit", amount: 2000, party: "Suresh Babu", vpa: "suresh@upi", date: "2026-09-10" });
  });

  it("a payee's @paytm address doesn't make a Google Pay screenshot Paytm", () => {
    const g = readReceipt(["To Chai Point", "chaipoint@paytm", "₹60", "Completed", "12 Sep 2026, 4:10 pm", "Google transaction ID", "CICAgOCzz123"], TODAY);
    expect(g.app).toBe("Google Pay");
    expect(g.party).toBe("Chai Point");
  });

  it("with positions: drops the status bar, joins rows, and takes the biggest amount", () => {
    const L = (text: string, y: number, height = 0.02, x = 0.1) => ({ text, x, y, width: 0.5, height });
    const g = readReceipt(
      [
        L("10:42", 0.01, 0.015, 0.05),
        L("85%", 0.01, 0.015, 0.85),
        L("Paid to", 0.2),
        L("Uber India", 0.23),
        L("₹286", 0.3, 0.06),
        L("Total ₹300", 0.4),
        L("Order ID", 0.6, 0.02, 0.05),
        L("UBR-77812345", 0.6005, 0.02, 0.6),
        L("23 Oct 2026, 9:12 am", 0.65),
      ],
      TODAY,
    );
    expect(g.amount).toBe(286);
    expect(g.party).toBe("Uber India");
    expect(g.ref).toBe("UBR-77812345");
    expect(g.time).toBe("09:12");
    expect(g.text).not.toContain("10:42");
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
