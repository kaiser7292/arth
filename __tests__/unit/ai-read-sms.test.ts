import { buildReadSmsPrompt, checkReadSmsAnswer, numbersIn } from "@/services/ai/tasks/read-sms";
import { extractJsonObject } from "@/services/ai/nano";

const DEBIT =
  "Sent Rs.1,250.50 from Kotak Bank AC X5678 to zomato.payu@hdfcbank on 14-11-26. UPI Ref 631812345678. Not you? Call 18602662666";
const CREDIT = "Your a/c no. XXXXXXXX4455 is credited by Rs.12,000.00 on 03-11-2026 by a/c linked to VPA raj@okaxis. Avl Bal: Rs 1,02,345.67";

describe("extractJsonObject", () => {
  it("reads an object out of surrounding text and code fences", () => {
    expect(extractJsonObject('Here you go:\n```json\n{"txn":true,"amount":5}\n```')).toEqual({ txn: true, amount: 5 });
  });
  it("handles curly quotes, a trailing comma and braces inside strings", () => {
    expect(extractJsonObject("{\u201Cmerchant\u201D:\u201Ca}b\u201D,}")).toEqual({ merchant: "a}b" });
  });
  it("returns null when there's no object", () => {
    expect(extractJsonObject("I can't help with that")).toBeNull();
    expect(extractJsonObject('{"txn":true')).toBeNull();
  });
});

describe("numbersIn", () => {
  it("reads Indian digit grouping", () => {
    expect(numbersIn("Rs 1,02,345.67 and 250")).toEqual([102345.67, 250]);
  });
});

describe("checkReadSmsAnswer", () => {
  it("keeps a correct debit", () => {
    const out = checkReadSmsAnswer(
      '{"txn":true,"type":"debit","amount":1250.5,"last4":"5678","merchant":"zomato","balance":null}',
      DEBIT,
    );
    expect(out).toEqual({
      kind: "transaction",
      result: { type: "debit", amount: 1250.5, last4: "5678", merchant: "zomato", balance: null },
      warnings: [],
    });
  });

  it("keeps a correct credit with balance, amounts given as strings", () => {
    const out = checkReadSmsAnswer(
      '{"txn":true,"type":"credit","amount":"12,000.00","last4":"XX4455","merchant":"raj@okaxis","balance":"1,02,345.67"}',
      CREDIT,
    );
    expect(out.kind).toBe("transaction");
    if (out.kind === "transaction") expect(out.result).toMatchObject({ amount: 12000, last4: "4455", balance: 102345.67 });
  });

  it("rejects an amount that isn't in the SMS", () => {
    const out = checkReadSmsAnswer('{"txn":true,"type":"debit","amount":1520.5,"last4":"5678"}', DEBIT);
    expect(out.kind).toBe("rejected");
  });

  it("rejects last 4 digits that aren't in the SMS", () => {
    const out = checkReadSmsAnswer('{"txn":true,"type":"debit","amount":1250.5,"last4":"9999"}', DEBIT);
    expect(out).toEqual({ kind: "rejected", problems: ["Last 4 9999 isn't written in the SMS"] });
  });

  it("rejects a direction the SMS contradicts", () => {
    const out = checkReadSmsAnswer('{"txn":true,"type":"debit","amount":12000,"last4":"4455"}', CREDIT);
    expect(out.kind).toBe("rejected");
  });

  it("drops a made-up merchant and a balance that isn't there, but keeps the rest", () => {
    const out = checkReadSmsAnswer(
      '{"txn":true,"type":"debit","amount":1250.5,"last4":"5678","merchant":"Swiggy","balance":4000}',
      DEBIT,
    );
    expect(out.kind).toBe("transaction");
    if (out.kind === "transaction") {
      expect(out.result.merchant).toBeNull();
      expect(out.result.balance).toBeNull();
      expect(out.warnings).toHaveLength(2);
    }
  });

  it("passes through 'not a transaction'", () => {
    expect(checkReadSmsAnswer('{"txn":false}', "123456 is your OTP")).toEqual({ kind: "not_transaction" });
  });

  it("rejects an answer without JSON", () => {
    expect(checkReadSmsAnswer("Sorry, I can't", DEBIT).kind).toBe("rejected");
  });
});

describe("buildReadSmsPrompt", () => {
  it("ends with the message to read, on one line", () => {
    const p = buildReadSmsPrompt("Rs 5 debited\nfrom A/c XX1111", "AX-TESTBK");
    expect(p.endsWith("From: AX-TESTBK\nSMS: Rs 5 debited from A/c XX1111\nJSON:")).toBe(true);
  });
});
