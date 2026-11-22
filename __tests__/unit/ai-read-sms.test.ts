import {
  buildReadSmsPrompt,
  checkReadSmsAnswer,
  isNotYetMoney,
  maskedAccountDigits,
  numbersIn,
} from "@/services/ai/tasks/read-sms";
import { extractJsonObject } from "@/services/ai/nano";
import { accountDigitsIn, buildMoneyMap, moneyMapLines, namedAccounts, type AccountRow } from "@/services/ai/money-map";

const NO_CONTEXT = { channel: null, auto: null, ref: null, scheme: null, time: null, fx: null };

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
      result: { type: "debit", amount: 1250.5, last4: "5678", merchant: "zomato", balance: null, event: null, from: null, to: null, ...NO_CONTEXT },
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
    expect(p.endsWith("From: AX-TESTBK\nSMS: Rs 5 debited from A/c XX1111\nSMS names: none\nJSON:")).toBe(true);
  });
});

// Cases from the first Pixel run (Nov 2026), with the details changed.
describe("checkReadSmsAnswer on real-world shapes", () => {
  const SELF_TRANSFER =
    "ICICI Bank Acct XX702 debited with Rs 7,340.00 on 19-Nov-26 & Acct XX419 credited. IMPS:632418765432. Call 18002662 for dispute.";

  it("accepts a 3-digit account mask and reads the direction next to the amount", () => {
    const out = checkReadSmsAnswer('{"txn":true,"type":"debit","amount":7340,"last4":"702","merchant":null}', SELF_TRANSFER);
    expect(out).toEqual({
      kind: "transaction",
      result: { type: "debit", amount: 7340, last4: "702", merchant: null, balance: null, event: null, from: null, to: null, ...NO_CONTEXT },
      warnings: [],
    });
  });

  it("still rejects 'credit' when the money word before the amount is debited", () => {
    expect(checkReadSmsAnswer('{"txn":true,"type":"credit","amount":7340,"last4":"702"}', SELF_TRANSFER).kind).toBe("rejected");
  });

  it("uses the one masked account in the SMS when the model's digits are made up", () => {
    const body = "Dear Customer, Your A/C XXXXX708142 has a debit by transfer of Rs 41,260.00 on 16/11/26. Avl Bal Rs 0.00 -SBI";
    const out = checkReadSmsAnswer('{"txn":true,"type":"debit","amount":41260,"last4":"9096","merchant":null,"balance":0}', body);
    expect(out.kind).toBe("transaction");
    if (out.kind === "transaction") {
      expect(out.result.last4).toBe("8142");
      expect(out.warnings[0]).toMatch(/used 8142/);
    }
  });

  it("rejects made-up digits when the SMS shows two accounts", () => {
    expect(checkReadSmsAnswer('{"txn":true,"type":"debit","amount":7340,"last4":"9096"}', SELF_TRANSFER).kind).toBe("rejected");
  });

  it("drops a merchant that is really the payment channel", () => {
    const body = "You have paid Rs 7340 using ICICI Bank InstaBIZ through IMPS from your Account XXXX6702 to RAMESH TRADERS.";
    const out = checkReadSmsAnswer(
      '{"txn":true,"type":"debit","amount":7340,"last4":"6702","merchant":"ICICI Bank InstaBIZ"}',
      body,
    );
    expect(out.kind).toBe("transaction");
    if (out.kind === "transaction") expect(out.result.merchant).toBeNull();
  });

  it.each([
    "UPI-Mandate is successfully created towards CITY PHARMACY for Rs 312.00 from A/c XX0451.",
    "INR 6150.00 for Streamflix will be debited from your Axis Bank Credit Card XX5806 on 25-11-26.",
    "Dear Swiggy customer, refund of Rs 512.0 has been initiated for order 400000000001.",
  ])("treats '%s' as not a transaction even when the model says it is", (body) => {
    const amount = numbersIn(body).find((n) => n > 100 && n < 10000)!;
    expect(checkReadSmsAnswer(`{"txn":true,"type":"debit","amount":${amount}}`, body)).toEqual({ kind: "not_transaction" });
  });

  it("keeps an autopay that was actually processed", () => {
    expect(isNotYetMoney("Autopay txn for INR 6150 was successfully processed on your Axis Bank Credit Card XX5806")).toBe(false);
  });
});

describe("maskedAccountDigits", () => {
  it("reads 3- and 4-digit masks and keeps the last 4 of longer ones", () => {
    expect(maskedAccountDigits("Acct XX702 debited & Acct XX419 credited")).toEqual(["702", "419"]);
    expect(maskedAccountDigits("A/C XXXXX708142 and card **1234")).toEqual(["8142", "1234"]);
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
  row({ id: "fd", account_type: "investment", bank_name: "SBI", account_identifier: "40708142", instrument: "fd", source_account_id: "sav" }),
  row({ id: "mf", account_type: "investment", bank_name: "Zerodha", instrument: "mutual_fund" }),
  row({ id: "old", account_type: "credit_card", bank_name: "HDFC", account_identifier: "7731", closed_at: "2026-01-01" }),
  row({ id: "cc", account_type: "credit_card", bank_name: "HDFC", account_identifier: "4111111111117732" }),
]);

describe("buildMoneyMap", () => {
  it("lists open accounts first, skips funds and shares, and links an FD to the account that funds it", () => {
    expect(moneyMapLines(MAP)).toEqual([
      "A1 | savings | SBI | ••4821",
      "A2 | FD | SBI | ••8142 | funded from A1",
      "A3 | credit card | HDFC | ••7732",
      "A4 | credit card | HDFC | ••7731 | closed",
    ]);
  });

  it("caps the list", () => {
    const rows = Array.from({ length: 40 }, (_, i) => row({ id: `a${i}`, account_type: "savings", bank_name: "X" }));
    expect(buildMoneyMap(rows).accounts).toHaveLength(25);
  });
});

describe("checkReadSmsAnswer with the money map", () => {
  const FD_CLOSE = "Dear Customer, Your A/C XXXXX708142 has a debit by transfer of Rs 41,260.00 on 16/11/26. Avl Bal Rs 0.00 -SBI";

  it("keeps an FD closure between two known accounts", () => {
    const out = checkReadSmsAnswer(
      '{"txn":true,"type":"debit","amount":41260,"last4":"8142","balance":0,"event":"fd_close","from":"A2","to":"A1"}',
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
      '{"txn":true,"type":"debit","amount":41260,"last4":"8142","event":"fd_burn","from":"A9","to":"A1"}',
      FD_CLOSE,
      MAP,
    );
    expect(out.kind).toBe("transaction");
    if (out.kind === "transaction") {
      expect(out.result.event).toBeNull();
      // A9 is dropped; the SMS itself names the FD, so that's the side the money left.
      expect(out.result.from).toMatchObject({ ref: "A2", inSms: true });
      expect(out.warnings.join(" ")).toMatch(/fd_burn/);
      expect(out.warnings.join(" ")).toMatch(/A9/);
    }
  });

  it("reads 'new' as an account Arth doesn't know yet", () => {
    const out = checkReadSmsAnswer(
      '{"txn":true,"type":"debit","amount":41260,"last4":"8142","event":"fd_close","from":"new","to":null}',
      FD_CLOSE,
      buildMoneyMap([]),
    );
    if (out.kind !== "transaction") throw new Error(out.kind);
    expect(out.result.from).toEqual({ ref: "new", inSms: true });
  });

  it("treats event not_txn as not a transaction", () => {
    expect(checkReadSmsAnswer('{"txn":true,"type":"debit","amount":41260,"event":"not_txn"}', FD_CLOSE, MAP)).toEqual({
      kind: "not_transaction",
    });
  });

  it("puts the user's accounts after the examples, just before the message", () => {
    const p = buildReadSmsPrompt(FD_CLOSE, "VM-SBIINB", MAP);
    expect(p).toContain("The user's accounts:\nA1 | savings | SBI | ••4821\nA2 | FD | SBI | ••8142 | funded from A1");
    expect(p.indexOf("The user's accounts:")).toBeGreaterThan(p.lastIndexOf("JSON: {"));
  });
});

// Second Pixel run (Nov 2026): accounts named in code, account types settle the event, ignored
// accounts are skipped, and the deeper context fields.
describe("accounts, context and ignored accounts", () => {
  const MINE = buildMoneyMap(
    [
      row({ id: "hdfc-cc", account_type: "credit_card", bank_name: "HDFC", account_identifier: "7731" }),
      row({ id: "axis-cc", account_type: "credit_card", bank_name: "Axis", account_identifier: "5806" }),
      row({ id: "icici-cur", account_type: "savings", bank_name: "ICICI", account_identifier: "000405006702" }),
      row({ id: "icici-sav", account_type: "savings", bank_name: "ICICI", account_identifier: "6419" }),
    ],
    25,
    new Set(["icici-cur"]),
  );

  it("finds the digits banks write, masked or after a word", () => {
    expect(accountDigitsIn("credited to your card ending 7731 On 17/NOV")).toEqual(["7731"]);
    expect(accountDigitsIn("Acct XX702 debited & Acct XX419 credited")).toEqual(["702", "419"]);
    expect(accountDigitsIn("from your Account XXXX6702 to")).toEqual(["6702"]);
    expect(accountDigitsIn("spent on HDFC Bank Card x7732 at")).toEqual(["7732"]);
  });

  it("matches ICICI's 3 digits to the account Arth holds as ••6702, and marks it ignored", () => {
    const named = namedAccounts("ICICI Bank Acct XX702 debited with Rs 7,340.00 & Acct XX419 credited.", MINE);
    expect(named.map((n) => [n.digits, n.account.accountId, n.account.ignored])).toEqual([
      ["702", "icici-cur", true],
      ["419", "icici-sav", false],
    ]);
    expect(moneyMapLines(MINE).at(-1)).toMatch(/••6702 \| ignored$/);
  });

  it("skips a message on an ignored account", () => {
    const body = "You have paid Rs 7340 using ICICI Bank InstaBIZ through IMPS from your Account XXXX6702.";
    expect(checkReadSmsAnswer('{"txn":true,"type":"debit","amount":7340,"last4":"6702","event":"card_payment"}', body, MINE)).toMatchObject({
      kind: "ignored",
      account: { accountId: "icici-cur" },
    });
  });

  it("calls money into a credit card a card bill payment, whatever the model said", () => {
    const body = "HDFC Bank Cardmember, Online Payment of Rs.3286 vide Ref# 7KQ2M4XPA was credited to your card ending 7731 On 17/NOV/2026";
    const out = checkReadSmsAnswer('{"txn":true,"type":"credit","amount":3286,"last4":"7731","event":"income","ref":"7KQ2M4XPA"}', body, MINE);
    if (out.kind !== "transaction") throw new Error(out.kind);
    expect(out.result.event).toBe("card_payment");
    expect(out.result.to).toMatchObject({ account: { accountId: "hdfc-cc" }, inSms: true });
    expect(out.result.ref).toBe("7KQ2M4XPA");
  });

  it("reads an autopay charged on a card as a spend with Autopay, not a mandate notice", () => {
    const body =
      "Autopay txn for INR 6150 was successfully processed on your Axis Bank Credit Card no. XX5806 as per the e-mandate set up by you at IND*Streamflix on 21-11-26 01:12:58 IST. SI ref no.: Qm4TzK8pWn. Transaction ID: 418236905517.";
    expect(isNotYetMoney(body)).toBe(false);
    const out = checkReadSmsAnswer(
      '{"txn":true,"type":"debit","amount":6150,"last4":"5806","merchant":"IND*Streamflix","event":"card_payment","channel":"card","auto":true,"ref":"418236905517","time":"01:12","from":"A2","to":"A2"}',
      body,
      MINE,
    );
    if (out.kind !== "transaction") throw new Error(out.kind);
    expect(out.result).toMatchObject({ event: "spend", channel: "card", auto: { sure: true }, ref: "418236905517", time: "01:12" });
    expect(out.result.from).toMatchObject({ account: { accountId: "axis-cc" } });
  });

  it("drops context that isn't written in the SMS", () => {
    const body = "Rs.250.00 debited from A/c XX6419 on 12-11-26 to VPA swiggy@icici. Avl Bal Rs 5,000.00";
    const out = checkReadSmsAnswer(
      '{"txn":true,"type":"debit","amount":250,"last4":"6419","event":"salary","channel":"neft","auto":true,"ref":"999999999","scheme":"Axis Bluechip","time":"10:30","fx":{"amount":3,"currency":"USD"}}',
      body,
      MINE,
    );
    if (out.kind !== "transaction") throw new Error(out.kind);
    expect(out.result).toMatchObject({ event: null, channel: null, auto: { sure: false }, ref: null, scheme: null, time: null, fx: null });
  });

  it("still treats a mandate being set up as not a transaction", () => {
    expect(isNotYetMoney("UPI-Mandate is successfully created towards CITY PHARMACY for Rs 312.00 from A/c XX0451.")).toBe(true);
  });
});
