import { amountsIn, checkReadPictureAnswer, fillGuess, needsAiHelp } from "@/services/ai/tasks/read-picture";
import type { ReceiptGuess } from "@/services/receipt/read-receipt";

// Made-up screenshot text: no real names, amounts or references.
const PAID = "Payment successful ₹ 1,450.00 Paid to Test Kitchen Pvt Ltd 24 Nov 2026, 7:42 pm UPI transaction ID 612345678901";
const RECEIVED = "Received from Test Person ₹ 2,000 Credited to your account 12 Nov 2026";
const today = new Date(2026, 10, 26);

function guess(over: Partial<ReceiptGuess> = {}): ReceiptGuess {
  return {
    kind: "expense",
    amount: null,
    date: null,
    time: null,
    party: null,
    vpa: null,
    ownVpa: null,
    note: null,
    account: null,
    toAccount: null,
    ref: null,
    app: null,
    notCompleted: false,
    text: PAID,
    ...over,
  };
}

describe("checkReadPictureAnswer", () => {
  it("keeps what's written on the picture", () => {
    const r = checkReadPictureAnswer(
      '{"amount":1450,"party":"Test Kitchen Pvt Ltd","date":"24 Nov 2026","ref":"612345678901","kind":"paid"}',
      PAID,
      today,
    );
    expect(r).toEqual({ amount: 1450, party: "Test Kitchen Pvt Ltd", date: "2026-11-24", ref: "612345678901", kind: "expense" });
  });
  it("drops what isn't on the picture", () => {
    const r = checkReadPictureAnswer('{"amount":1540,"party":"Other Cafe","date":"25 Nov 2026","ref":"999999999","kind":"received"}', PAID, today);
    expect(r).toEqual({ amount: null, party: null, date: null, ref: null, kind: null });
  });
  it("never takes the app as the merchant", () => {
    expect(checkReadPictureAnswer('{"party":"UPI"}', PAID + " UPI", today).party).toBeNull();
  });
  it("money received only when the picture says so", () => {
    expect(checkReadPictureAnswer('{"amount":2000,"kind":"received"}', RECEIVED, today).kind).toBe("credit");
    expect(checkReadPictureAnswer('{"amount":1450,"kind":"received"}', PAID, today).kind).toBeNull();
  });
  it("returns nothing for an answer with no JSON", () => {
    expect(checkReadPictureAnswer("Sorry, I can't read that.", PAID, today).amount).toBeNull();
  });
});

describe("fillGuess", () => {
  it("fills only what the reader left empty", () => {
    const g = guess({ amount: 1450, party: null });
    const { guess: out, filled } = fillGuess(g, { amount: 9999, party: "Test Kitchen Pvt Ltd", date: null, ref: null, kind: null });
    expect(out.amount).toBe(1450);
    expect(out.party).toBe("Test Kitchen Pvt Ltd");
    expect(filled).toEqual(["merchant"]);
  });
  it("turns a default expense into money in only for a picture that says received", () => {
    const g = guess({ text: RECEIVED });
    const { guess: out } = fillGuess(g, { amount: 2000, party: "Test Person", date: null, ref: null, kind: "credit" });
    expect(out.kind).toBe("credit");
  });
});

describe("needsAiHelp", () => {
  it("asks only when the amount or merchant is missing on a completed payment", () => {
    expect(needsAiHelp(guess())).toBe(true);
    expect(needsAiHelp(guess({ amount: 10, party: "X" }))).toBe(false);
    expect(needsAiHelp(guess({ notCompleted: true }))).toBe(false);
    expect(needsAiHelp(guess({ kind: "transfer" }))).toBe(false);
  });
});

describe("what counts as an amount on the picture", () => {
  it("not the year, the time, an account's digits or the reference", () => {
    for (const n of [2026, 7, 42, 612345678901]) {
      expect(checkReadPictureAnswer(`{"amount":${n}}`, PAID, today).amount).toBeNull();
    }
    expect(checkReadPictureAnswer('{"amount":4321}', "Paid to Test Shop from A/c XX4321 on 24 Nov 2026", today).amount).toBeNull();
  });
  it("amounts with ₹, Rs or paise or grouping", () => {
    expect(amountsIn("₹ 1,450.00 · Rs.500 · INR 75 · 1,23,456 · 2026 · 612345678901")).toEqual([1450, 500, 75, 123456]);
  });
});

describe("money in needs the picture to say so", () => {
  const CASHBACK = "Payment successful ₹ 299 Test Store ₹5 cashback credited";
  it("a bare 'credited' (cashback) never makes a payment money in", () => {
    expect(checkReadPictureAnswer('{"amount":299,"kind":"received"}', CASHBACK, today).kind).toBeNull();
  });
  it("a date or reference alone doesn't flip the type", () => {
    const g = guess({ amount: 2000, party: "Test Person", text: RECEIVED });
    const { guess: out } = fillGuess(g, { amount: null, party: null, date: "2026-11-12", ref: null, kind: "credit" });
    expect(out.kind).toBe("expense");
  });
});
