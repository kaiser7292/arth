/** On-device AI Phase 2 (docs/ON_DEVICE_AI_PHASE2_PROPOSAL.md): the pure checks. Made-up data only. */
import { candidatePairs, checkMergeAnswer, pairKey } from "@/services/ai/tasks/merchant-merge";
import { checkContextAnswer, contextAction, worthAsking } from "@/services/ai/tasks/payment-context";
import { amountSpan, draftTemplate } from "@/services/ai/tasks/graduate-template";
import { checkHeadline, sentenceHolds } from "@/services/ai/tasks/month-note";
import { checkVoiceAnswer } from "@/services/ai/tasks/read-voice";
import { anyFilter, checkSearchAnswer, worthAskingSearch } from "@/services/ai/tasks/read-search";
import { normalizeSms } from "@/services/sms/sms-normalize";

describe("merchant variants", () => {
  it("one key per pair, whichever way round", () => {
    expect(pairKey("Beta Cafe", "Alpha Cafe")).toBe(pairKey("Alpha Cafe", "Beta Cafe"));
  });
  it("finds pairs by first word and by a shared UPI ID, not common words", () => {
    const pairs = candidatePairs(
      ["Testmart Express", "Testmart Fresh", "The Shop", "The Bakery", "Office Canteen", "Neo Group"],
      new Map([
        ["Office Canteen", new Set(["canteen@okbank"])],
        ["Neo Group", new Set(["canteen@okbank"])],
      ]),
    );
    const keys = pairs.map((p) => `${p.why}:${pairKey(p.a, p.b)}`);
    expect(keys.some((k) => k.endsWith(pairKey("Testmart Express", "Testmart Fresh")))).toBe(true);
    expect(keys).toContain(`same_upi:${pairKey("Office Canteen", "Neo Group")}`);
    expect(keys.some((k) => k.includes("The Shop") && k.includes("The Bakery"))).toBe(false);
  });
  it("only an explicit 'same' counts", () => {
    expect(checkMergeAnswer('{"1":"same","2":"unsure","3":"different"}', 3)).toEqual([true, false, false]);
    expect(checkMergeAnswer("no idea", 2)).toEqual([false, false]);
  });
});

describe("what a payment was", () => {
  const NACH = "Rs 1,500 debited from A/c XX1234 towards NACH mandate for TEST FUND SIP folio 12345";
  it("asks only when the message hints at more and nothing settled it", () => {
    expect(worthAsking(NACH, null)).toBe(true);
    expect(worthAsking(NACH, "sip")).toBe(false);
    expect(worthAsking("Rs 200 spent at TEST CAFE", null)).toBe(false);
  });
  it("keeps an event the message says in its own words", () => {
    expect(checkContextAnswer('{"event":"sip","scheme":"TEST FUND"}', NACH, false)).toEqual({ event: "sip", scheme: "TEST FUND" });
    expect(checkContextAnswer('{"event":"card_payment"}', NACH, false)).toBeNull();
  });
  it("never an EMI without a loan, nor a made-up scheme", () => {
    const EMI = "EMI of Rs 9,000 for loan a/c XX5555 debited";
    expect(checkContextAnswer('{"event":"loan_emi"}', EMI, false)).toBeNull();
    expect(checkContextAnswer('{"event":"loan_emi","scheme":"Other Bank Home Loan"}', EMI, true)).toEqual({ event: "loan_emi", scheme: null });
  });
  it("each event opens its action", () => {
    expect(contextAction({ event: "autopay", scheme: null }).act).toBe("recurring");
    expect(contextAction({ event: "card_payment", scheme: null }).act).toBe("transfer");
  });
});

describe("learning a message format", () => {
  const a = { id: "1", amount: 250, nature: "realized", merchant: "TEST CAFE", address: "AX-TESTBK", body: "Rs 250.00 spent on card XX1234 at TEST CAFE on 02-11-26. Avl bal Rs 5,000.00" };
  const b = { id: "2", amount: 1200, nature: "realized", merchant: "OTHER SHOP", address: "AX-TESTBK", body: "Rs 1,200.00 spent on card XX1234 at OTHER SHOP on 05-11-26. Avl bal Rs 3,800.00" };
  it("finds the amount as written", () => {
    expect(amountSpan(b.body, 1200)).toEqual({ field: "amount", start: 3, end: 11 });
    expect(amountSpan(b.body, 999)).toBeNull();
  });
  it("drafts a template that reads both approved messages with their amounts", () => {
    const d = draftTemplate(a, b);
    expect(d).not.toBeNull();
    const rx = new RegExp(d!.pattern, "i");
    expect(Number(rx.exec(normalizeSms(b.body).text)!.groups!.amount.replace(/,/g, ""))).toBe(1200);
    expect(d!.kind).toBe("debit");
  });
});

describe("month headline", () => {
  const facts = ["Spent ₹84K in November so far (day 27 of 30)", "That is ₹6.2K less than October by the same day", "Most visited place: Testmart Cafe, 14 times, ₹4.1K"];
  it("a sentence keeps only the facts' numbers and names", () => {
    const all = facts.join(" | ");
    expect(sentenceHolds("You're ₹6.2K under October's pace, with Testmart Cafe 14 times.", all)).toBe(true);
    expect(sentenceHolds("You're ₹7K under October's pace.", all)).toBe(false);
    expect(sentenceHolds("Testmart Cafe and Zomato kept you fed.", all)).toBe(false);
    // 84L is not 84K, and "less" never becomes "more".
    expect(sentenceHolds("₹84L gone in November.", all)).toBe(false);
    expect(sentenceHolds("₹6.2K more than October, wow.", all)).toBe(false);
  });
  it("takes one clean line and drops quotes and labels", () => {
    expect(checkHeadline(['Headline: "Testmart Cafe 14 times, and still ₹6.2K under October!"', "more"].join(String.fromCharCode(10)), facts)).toBe("Testmart Cafe 14 times, and still ₹6.2K under October!");
  });
  it("drops a headline with a made-up number, or one too long", () => {
    expect(checkHeadline("You saved ₹9,999 in November.", facts)).toBeNull();
    expect(checkHeadline("Hi", facts)).toBeNull();
    expect(checkHeadline("word ".repeat(30), facts)).toBeNull();
  });
});

describe("voice in plain words", () => {
  const said = "spent 300 on chai at office canteen by upi";
  it("keeps what was said and names from your lists", () => {
    expect(checkVoiceAnswer('{"amount":300,"merchant":"office canteen","category":"food","mode":"UPI"}', said, ["Food", "Travel"], ["UPI", "Cash"])).toEqual({
      amount: 300,
      merchant: "office canteen",
      category: "Food",
      mode: "UPI",
    });
  });
  it("drops what wasn't said or isn't yours", () => {
    expect(checkVoiceAnswer('{"amount":3000,"merchant":"Starbucks","category":"Coffee"}', said, ["Food"], ["UPI"])).toEqual({
      amount: null,
      merchant: null,
      category: null,
      mode: null,
    });
  });
});

describe("search in plain words", () => {
  it("asks only for three or more words", () => {
    expect(worthAskingSearch("swiggy")).toBe(false);
    expect(worthAskingSearch("swiggy over 500 food")).toBe(true);
  });
  it("maps onto your merchants, categories and the numbers you typed", () => {
    const f = checkSearchAnswer('{"merchant":"testmart","min":500,"type":"debits"}', "spent at testmart over 500", ["Testmart Fresh", "Other"], ["Food"]);
    expect(f).toEqual({ merchant: "Testmart Fresh", category: null, min: 500, max: null, type: "debits" });
    expect(anyFilter(f)).toBe(true);
  });
  it("ignores amounts and merchants you didn't type", () => {
    const f = checkSearchAnswer('{"merchant":"Other","min":900}', "spent at testmart over 500", ["Testmart Fresh", "Other"], ["Food"]);
    expect(f.merchant).toBeNull();
    expect(f.min).toBeNull();
  });
});

describe("review fixes", () => {
  const CARD_SPEND = "Rs 450.00 spent on your Credit Card XX4321 at TEST CAFE. Convert to EMI: reply EMI. Avl limit Rs 50,000";
  it("an ordinary card spend isn't a question, nor a card bill or an EMI", () => {
    expect(worthAsking(CARD_SPEND, null)).toBe(false);
    expect(checkContextAnswer('{"event":"card_payment"}', CARD_SPEND, true)).toBeNull();
    expect(checkContextAnswer('{"event":"loan_emi"}', CARD_SPEND, true)).toBeNull();
  });
  it("a real card bill payment from savings is, but never a debit on the card itself", () => {
    const BILL = "Rs 12,000 debited from A/c XX1234 towards your credit card bill XX4321";
    expect(worthAsking(BILL, null)).toBe(true);
    expect(checkContextAnswer('{"event":"card_payment"}', BILL, false)).toEqual({ event: "card_payment", scheme: null });
    expect(checkContextAnswer('{"event":"card_payment"}', BILL, false, true)).toBeNull();
  });
});
