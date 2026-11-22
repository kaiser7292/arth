import {
  buildReadSmsPrompt,
  checkReadSmsAnswer,
  isNotYetMoney,
  maskedAccountDigits,
  numbersIn,
} from "@/services/ai/tasks/read-sms";
import { extractJsonObject } from "@/services/ai/nano";
import { buildMoneyMap, moneyMapLines, type AccountRow } from "@/services/ai/money-map";

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
      result: { type: "debit", amount: 1250.5, last4: "5678", merchant: "zomato", balance: null, event: null, from: null, to: null },
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
    expect(out).toEqual({ kind: "rejected", problems: ["Account 9999 isn't written in the SMS"] });
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

// Cases from the first Pixel run (Nov 2026), with the details changed.
describe("checkReadSmsAnswer on real-world shapes", () => {
  const SELF_TRANSFER =
    "ICICI Bank Acct XX304 debited with Rs 9,615.00 on 19-Nov-26 & Acct XX185 credited. IMPS:632418765432. Call 18002662 for dispute.";

  it("accepts a 3-digit account mask and reads the direction next to the amount", () => {
    const out = checkReadSmsAnswer('{"txn":true,"type":"debit","amount":9615,"last4":"304","merchant":null}', SELF_TRANSFER);
    expect(out).toEqual({
      kind: "transaction",
      result: { type: "debit", amount: 9615, last4: "304", merchant: null, balance: null, event: null, from: null, to: null },
      warnings: [],
    });
  });

  it("still rejects 'credit' when the money word before the amount is debited", () => {
    expect(checkReadSmsAnswer('{"txn":true,"type":"credit","amount":9615,"last4":"304"}', SELF_TRANSFER).kind).toBe("rejected");
  });

  it("uses the one masked account in the SMS when the model's digits are made up", () => {
    const body = "Dear Customer, Your A/C XXXXX903667 has a debit by transfer of Rs 30,155.00 on 16/11/26. Avl Bal Rs 0.00 -SBI";
    const out = checkReadSmsAnswer('{"txn":true,"type":"debit","amount":30155,"last4":"9096","merchant":null,"balance":0}', body);
    expect(out.kind).toBe("transaction");
    if (out.kind === "transaction") {
      expect(out.result.last4).toBe("3667");
      expect(out.warnings[0]).toMatch(/used 3667/);
    }
  });

  it("rejects made-up digits when the SMS shows two accounts", () => {
    expect(checkReadSmsAnswer('{"txn":true,"type":"debit","amount":9615,"last4":"9096"}', SELF_TRANSFER).kind).toBe("rejected");
  });

  it("drops a merchant that is really the payment channel", () => {
    const body = "You have paid Rs 9615 using ICICI Bank InstaBIZ through IMPS from your Account XXXX9304 to RAMESH TRADERS.";
    const out = checkReadSmsAnswer(
      '{"txn":true,"type":"debit","amount":9615,"last4":"9304","merchant":"ICICI Bank InstaBIZ"}',
      body,
    );
    expect(out.kind).toBe("transaction");
    if (out.kind === "transaction") expect(out.result.merchant).toBeNull();
  });

  it.each([
    "UPI-Mandate is successfully created towards APOLLO PHARMACIES LIMITED for Rs 239.00 from A/c XX0006.",
    "INR 8400.00 for LinkedIn will be debited from your Axis Bank Credit Card XX2445 on 25-11-26.",
    "Dear Swiggy customer, refund of Rs 439.0 has been initiated for order 253858993101.",
  ])("treats '%s' as not a transaction even when the model says it is", (body) => {
    const amount = numbersIn(body).find((n) => n > 100 && n < 10000)!;
    expect(checkReadSmsAnswer(`{"txn":true,"type":"debit","amount":${amount}}`, body)).toEqual({ kind: "not_transaction" });
  });

  it("keeps an autopay that was actually processed", () => {
    expect(isNotYetMoney("Autopay txn for INR 8400 was successfully processed on your Axis Bank Credit Card XX2445")).toBe(false);
  });
});

describe("maskedAccountDigits", () => {
  it("reads 3- and 4-digit masks and keeps the last 4 of longer ones", () => {
    expect(maskedAccountDigits("Acct XX304 debited & Acct XX185 credited")).toEqual(["304", "185"]);
    expect(maskedAccountDigits("A/C XXXXX903667 and card **1234")).toEqual(["3667", "1234"]);
  });
});

const row = (over: Partial<AccountRow> & { id: string; account_type: string }): AccountRow => ({
  bank_name: null,
  account_label: null,
  account_identifier: null,
  closed_at: null,
  instrument: null,
  source_account_id: null,
  product_status: null,
  ...over,
});

const MAP = buildMoneyMap([
  row({ id: "sav", account_type: "savings", bank_name: "SBI", account_identifier: "20019274821" }),
  row({ id: "fd", account_type: "investment", bank_name: "SBI", account_identifier: "40903667", instrument: "fd", source_account_id: "sav" }),
  row({ id: "mf", account_type: "investment", bank_name: "Zerodha", instrument: "mutual_fund" }),
  row({ id: "old", account_type: "credit_card", bank_name: "HDFC", account_identifier: "9527", closed_at: "2026-01-01" }),
  row({ id: "cc", account_type: "credit_card", bank_name: "HDFC", account_identifier: "4111111111119528" }),
]);

describe("buildMoneyMap", () => {
  it("lists open accounts first, skips funds and shares, and links an FD to the account that funds it", () => {
    expect(moneyMapLines(MAP)).toEqual([
      "A1 | savings | SBI | ••4821",
      "A2 | FD | SBI | ••3667 | funded from A1",
      "A3 | credit card | HDFC | ••9528",
      "A4 | credit card | HDFC | ••9527 | closed",
    ]);
  });

  it("caps the list", () => {
    const rows = Array.from({ length: 40 }, (_, i) => row({ id: `a${i}`, account_type: "savings", bank_name: "X" }));
    expect(buildMoneyMap(rows).accounts).toHaveLength(25);
  });
});

describe("checkReadSmsAnswer with the money map", () => {
  const FD_CLOSE = "Dear Customer, Your A/C XXXXX903667 has a debit by transfer of Rs 30,155.00 on 16/11/26. Avl Bal Rs 0.00 -SBI";

  it("keeps an FD closure between two known accounts", () => {
    const out = checkReadSmsAnswer(
      '{"txn":true,"type":"debit","amount":30155,"last4":"3667","balance":0,"event":"fd_close","from":"A2","to":"A1"}',
      FD_CLOSE,
      MAP,
    );
    expect(out.kind).toBe("transaction");
    if (out.kind === "transaction") {
      expect(out.result.event).toBe("fd_close");
      expect(out.result.from).toMatchObject({ ref: "A2", inSms: true, account: { accountId: "fd" } });
      expect(out.result.to).toMatchObject({ ref: "A1", inSms: false, account: { accountId: "sav" } });
      expect(out.warnings).toEqual([]);
    }
  });

  it("drops an account id that isn't in the map and an unknown event, but keeps the reading", () => {
    const out = checkReadSmsAnswer(
      '{"txn":true,"type":"debit","amount":30155,"last4":"3667","event":"fd_burn","from":"A9","to":"A1"}',
      FD_CLOSE,
      MAP,
    );
    expect(out.kind).toBe("transaction");
    if (out.kind === "transaction") {
      expect(out.result.event).toBeNull();
      expect(out.result.from).toBeNull();
      expect(out.warnings.join(" ")).toMatch(/fd_burn/);
      expect(out.warnings.join(" ")).toMatch(/A9/);
      expect(out.warnings.join(" ")).toMatch(/names A2/);
    }
  });

  it("reads 'new' as an account Arth doesn't know yet", () => {
    const out = checkReadSmsAnswer(
      '{"txn":true,"type":"debit","amount":30155,"last4":"3667","event":"fd_close","from":"new","to":null}',
      FD_CLOSE,
      buildMoneyMap([]),
    );
    if (out.kind !== "transaction") throw new Error(out.kind);
    expect(out.result.from).toEqual({ ref: "new", inSms: true });
  });

  it("treats event not_txn as not a transaction", () => {
    expect(checkReadSmsAnswer('{"txn":true,"type":"debit","amount":30155,"event":"not_txn"}', FD_CLOSE, MAP)).toEqual({
      kind: "not_transaction",
    });
  });

  it("puts the user's accounts after the examples, just before the message", () => {
    const p = buildReadSmsPrompt(FD_CLOSE, "VM-SBIINB", MAP);
    expect(p).toContain("The user's accounts:\nA1 | savings | SBI | ••4821\nA2 | FD | SBI | ••3667 | funded from A1");
    expect(p.indexOf("The user's accounts:")).toBeGreaterThan(p.lastIndexOf("JSON: {"));
  });
});
