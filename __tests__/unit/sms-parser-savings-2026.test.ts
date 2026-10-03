/**
 * HDFC / SBI savings-account SMS in the formats the banks send in 2026, plus
 * FD-event and counterparty extraction. Bodies are real formats with the
 * name and account digits replaced.
 */

import { parseBankSMS } from "../../services/sms/bank-patterns";

const HDFC_FD_1 =
  "UPDATE: INR 19,980.00 debited from HDFC Bank XX4417 on 08-SEP-26. Info: FD through MOBILE-XXXXXXXXXX1234:RAHUL VERMA. Avl bal:INR 0.00";
const HDFC_FD_2 =
  "UPDATE: INR 20,000.00 debited from HDFC Bank XX4417 on 03-SEP-26. Info: FD through MOBILE-XXXXXXXXXX5678:RAHUL VERMA. Avl bal:INR 1,50,000.00";
const HDFC_IMPS =
  "IMPS INR 30,000.00\nsent from HDFC Bank A/c XX4417 on 03-09-26\nTo A/c xxxxxxxxxx8812\nRef-624633402819\nNot you?Call 18002586161/SMS BLOCK OB to 7308080808";
const HDFC_CC_REFUND =
  "Alert! Rs. 2759.39 refunded by RSP*NYKAA VIA SMARTBU  MUMBRA        MAH on 20/SEP/2026 & adjusted against HDFC Bank Credit Card 9628 View updated balance here: https://1.hdfc.bank.in/HDFCBK/s/WlMldLwp";
const SBI_IMPS_CREDIT =
  "Dear Customer, Your a/c no. XXXXXXXX8812 is credited by Rs.20013.00 on 30-09-26 by a/c linked to mobile 9XXXXXX963-RAHUL VER (IMPS Ref# 627344741256)-SBI";
const SBI_TRANSFER_CREDIT =
  "Your A/C XXXXX798812 Credited INR 50,079.00 on 30/09/26 -Deposit by transfer from Mr. RAHULVERMA. Avl Bal INR 62,305.01-SBI";
const SBI_TD_CLOSURE =
  "Dear Customer, Your A/C XXXXX798812 Credited. INR 50,029.00 on 15/09/26 on account of Closure of TD A/c XXXXX031705.-SBI";
const SBI_TRANSFER_DEBIT =
  "Your A/C XXXXX798812 Debited INR 50,000.00 on 11/09/26 -Transferred to Mr. RAHULVERMA. Avl Balance INR 20,326.76-SBI";

describe("HDFC savings debit (UPDATE format)", () => {
  it("parses an FD-funding debit", () => {
    const r = parseBankSMS(HDFC_FD_1)!;
    expect(r).not.toBeNull();
    expect(r.bank).toBe("HDFC Bank");
    expect(r.type).toBe("debit");
    expect(r.amount).toBe(19980);
    expect(r.cardLast4).toBe("4417");
    expect(r.date).toBe("2026-09-08");
    expect(r.merchant).toBe("FD through MOBILE");
    expect(r.availableBalance).toBe(0);
    expect(r.accountType).toBe("savings");
    expect(r.counterpartyName).toBe("RAHUL VERMA");
    expect(r.fdEvent).toBe("open");
  });

  it("reads Indian-format balances", () => {
    const r = parseBankSMS(HDFC_FD_2)!;
    expect(r.amount).toBe(20000);
    expect(r.date).toBe("2026-09-03");
    expect(r.availableBalance).toBe(150000);
    expect(r.fdEvent).toBe("open");
  });
});

describe("HDFC IMPS sent", () => {
  it("captures the destination account", () => {
    const r = parseBankSMS(HDFC_IMPS)!;
    expect(r.type).toBe("debit");
    expect(r.amount).toBe(30000);
    expect(r.cardLast4).toBe("4417");
    expect(r.date).toBe("2026-09-03");
    expect(r.counterpartyAcctLast4).toBe("8812");
    expect(r.paymentMode).toBe("net_banking");
    expect(r.fdEvent).toBeNull();
  });
});

describe("HDFC CC refund (unchanged)", () => {
  it("still parses as a refund", () => {
    const r = parseBankSMS(HDFC_CC_REFUND)!;
    expect(r.type).toBe("refund");
    expect(r.amount).toBe(2759.39);
    expect(r.cardLast4).toBe("9628");
  });
});

describe("SBI IMPS credit (linked mobile)", () => {
  it("extracts the sender name", () => {
    const r = parseBankSMS(SBI_IMPS_CREDIT)!;
    expect(r.bank).toBe("SBI");
    expect(r.type).toBe("credit");
    expect(r.amount).toBe(20013);
    expect(r.cardLast4).toBe("8812");
    expect(r.date).toBe("2026-09-30");
    expect(r.counterpartyName).toBe("RAHUL VER");
  });
});

describe("SBI Credited/Debited INR (DD/MM/YY)", () => {
  it("parses a transfer credit with sender and balance", () => {
    const r = parseBankSMS(SBI_TRANSFER_CREDIT)!;
    expect(r.type).toBe("credit");
    expect(r.amount).toBe(50079);
    expect(r.cardLast4).toBe("8812");
    expect(r.date).toBe("2026-09-30");
    expect(r.availableBalance).toBe(62305.01);
    expect(r.counterpartyName).toBe("RAHULVERMA");
    expect(r.fdEvent).toBeNull();
  });

  it("flags a TD closure with the deposit number", () => {
    const r = parseBankSMS(SBI_TD_CLOSURE)!;
    expect(r.type).toBe("credit");
    expect(r.amount).toBe(50029);
    expect(r.date).toBe("2026-09-15");
    expect(r.fdEvent).toBe("closure");
    expect(r.fdNumber).toBe("031705");
    expect(r.merchant).toBe("Closure of TD A/c");
  });

  it("parses a transfer debit", () => {
    const r = parseBankSMS(SBI_TRANSFER_DEBIT)!;
    expect(r.type).toBe("debit");
    expect(r.amount).toBe(50000);
    expect(r.date).toBe("2026-09-11");
    expect(r.availableBalance).toBe(20326.76);
    expect(r.counterpartyName).toBe("RAHULVERMA");
    expect(r.paymentMode).toBe("net_banking");
  });
});

describe("cross-bank guards", () => {
  it("HDFC patterns don't claim SBI bodies and vice versa", () => {
    expect(parseBankSMS(SBI_TRANSFER_CREDIT)!.bank).toBe("SBI");
    expect(parseBankSMS(SBI_IMPS_CREDIT)!.bank).toBe("SBI");
    expect(parseBankSMS(HDFC_IMPS)!.bank).toBe("HDFC Bank");
    expect(parseBankSMS(HDFC_FD_1)!.bank).toBe("HDFC Bank");
  });
});
