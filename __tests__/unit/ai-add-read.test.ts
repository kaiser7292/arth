import { aiReadToParsed } from "@/services/ai/add-ai-read";
import type { MapAccount } from "@/services/ai/money-map";
import type { AiReadSms } from "@/services/ai/tasks/read-sms";

// Made-up accounts and messages (the repo is public).
const card: MapAccount = { ref: "A2", accountId: "cc", kind: "credit card", name: "Axis", digits: "5806", fundedFrom: null, closed: false, ignored: false };
const savings: MapAccount = { ref: "A1", accountId: "sv", kind: "savings", name: "SBI", digits: "4821", fundedFrom: null, closed: false, ignored: false };
const fd: MapAccount = { ref: "A3", accountId: "fd", kind: "FD", name: "SBI", digits: "8142", fundedFrom: "A1", closed: false, ignored: false };

const base: AiReadSms = {
  type: "debit",
  amount: 6150,
  last4: "5806",
  merchant: "IND*Streamflix",
  balance: null,
  event: "spend",
  from: { ref: "A2", account: card, inSms: true },
  to: null,
  channel: "card",
  auto: { sure: true },
  ref: "418236905517",
  scheme: null,
  time: "01:12",
  fx: null,
};
const DATE = new Date(2026, 10, 21, 1, 12).getTime();

describe("aiReadToParsed", () => {
  it("turns an autopay on a credit card into the shape a bank pattern gives", () => {
    expect(aiReadToParsed(base, "AX-AXISBK-S", DATE)).toMatchObject({
      amount: 6150,
      merchant: "IND*Streamflix",
      cardLast4: "5806",
      date: "2026-11-21",
      bank: "Axis",
      type: "debit",
      skip: false,
      isForecast: false,
      upiRef: "418236905517",
      accountType: "credit_card",
      paymentMode: "auto_debit",
      transactionTime: "01:12:00",
      fdEvent: null,
    });
  });

  it("marks an FD closing back into savings as an FD closure between the two accounts", () => {
    const p = aiReadToParsed(
      { ...base, type: "credit", amount: 41260, last4: "4821", merchant: null, event: "fd_close", channel: null, auto: null, from: { ref: "A3", account: fd, inSms: true }, to: { ref: "A1", account: savings, inSms: false } },
      "VM-SBIINB",
      DATE,
    );
    expect(p).toMatchObject({ type: "credit", cardLast4: "4821", bank: "SBI", accountType: "savings", fdEvent: "closure", declaredTransfer: true, counterpartyAcctLast4: "8142" });
  });

  it("falls back to the sender's bank when the account isn't one Arth knows", () => {
    const p = aiReadToParsed({ ...base, from: null, last4: "7788", channel: "upi", auto: null }, "AX-HDFCBK", DATE);
    expect(p.bank).toMatch(/HDFC/i);
    expect(p.cardLast4).toBe("7788");
    expect(p.paymentMode).toBe("upi");
  });
});
