import { checkAccountTypeAnswer, buildAccountTypePrompt } from "@/services/ai/tasks/account-type";
import { buildMerchantCategoryPrompt, checkMerchantCategoryAnswer } from "@/services/ai/tasks/merchant-category";
import { buildLocalReply } from "@/services/ai/local-setup";
import { findSuggestionObjects } from "@/services/ai-suggestions";
import { roundBudget, wholeMonths } from "@/services/budget-suggest";
import { aiReadToParsed } from "@/services/ai/add-ai-read";

// Made-up messages: no real account digits, amounts or references.
const CARD = "Rs 450.00 spent on your Credit Card XX4321 at TEST CAFE on 02-11-26.";
const DEBIT_CARD = "Rs 450.00 spent on Debit Card XX4321 at TEST CAFE. Avl bal Rs 1,000.00";
const WALLET = "Rs 120 paid from your Paytm Wallet to TEST SHOP.";

describe("checkAccountTypeAnswer", () => {
  it("keeps a type the messages carry a word for", () => {
    expect(checkAccountTypeAnswer('{"type":"credit_card"}', [CARD])).toBe("credit_card");
    expect(checkAccountTypeAnswer('{"type":"wallet"}', [WALLET])).toBe("wallet");
    expect(checkAccountTypeAnswer('{"type":"bank"}', [DEBIT_CARD.replace("Debit Card", "A/c")])).toBe("savings");
  });
  it("drops a type the messages don't support", () => {
    expect(checkAccountTypeAnswer('{"type":"wallet"}', [CARD])).toBeNull();
    // A debit card is a bank account's card.
    expect(checkAccountTypeAnswer('{"type":"credit_card"}', [DEBIT_CARD])).toBeNull();
  });
  it("drops unsure, unknown types and non-answers", () => {
    expect(checkAccountTypeAnswer('{"type":"unsure"}', [CARD])).toBeNull();
    expect(checkAccountTypeAnswer('{"type":"loan"}', [CARD])).toBeNull();
    expect(checkAccountTypeAnswer("I think it's a card", [CARD])).toBeNull();
  });
  it("prompt names the bank and digits and carries the messages", () => {
    const p = buildAccountTypePrompt([CARD], "Test Bank", "4321");
    expect(p).toContain("at Test Bank, the one ending 4321");
    expect(p).toContain("SMS 1: Rs 450.00 spent");
  });
});

describe("checkMerchantCategoryAnswer", () => {
  const cats = ["Food", "Travel & Going Out", "Shopping & Gifts"];
  const merchants = ["TEST CAFE", "TEST AIRLINE", "TEST SHOP", "XYZ123"];
  it("keeps only names from the list, matched without case", () => {
    const out = checkMerchantCategoryAnswer('{"1":"food","2":"Travel & Going Out","3":"Gadgets","4":"unsure"}', merchants, cats);
    expect([...out]).toEqual([
      ["TEST CAFE", "Food"],
      ["TEST AIRLINE", "Travel & Going Out"],
    ]);
  });
  it("returns nothing for an answer with no JSON", () => {
    expect(checkMerchantCategoryAnswer("Sorry", merchants, cats).size).toBe(0);
  });
  it("prompt numbers the merchants and lists the categories", () => {
    const p = buildMerchantCategoryPrompt(["A", "B"], cats);
    expect(p).toContain("Categories: Food | Travel & Going Out | Shopping & Gifts");
    expect(p).toContain("1. A\n2. B");
  });
});

describe("buildLocalReply", () => {
  it("is a reply the suggestions reader recognises", () => {
    const reply = buildLocalReply(new Map([["TEST CAFE", "Food"]]))!;
    const found = findSuggestionObjects(reply);
    expect(found.recognised).toBe(true);
    expect(found.objects).toHaveLength(1);
    expect(JSON.parse(found.objects[0])).toMatchObject({ type: "merchant_category", merchant: "TEST CAFE", category: "Food" });
  });
  it("is null when nothing was filed", () => {
    expect(buildLocalReply(new Map())).toBeNull();
  });
});

describe("budget suggestions", () => {
  const today = new Date(2026, 10, 24); // 24 Nov 2026
  it("averages only whole months, up to last month", () => {
    expect(wholeMonths("2026-08-24", today)).toEqual(["2026-09", "2026-10"]);
    expect(wholeMonths("2026-08-01", today)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(wholeMonths("2026-02-10", today)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });
  it("has nothing to average with no whole month yet", () => {
    expect(wholeMonths("2026-10-15", today)).toEqual([]);
    expect(wholeMonths("2026-11-24", today)).toEqual([]);
    expect(wholeMonths(null, today)).toEqual([]);
  });
  it("rounds up to the next ₹500", () => {
    expect(roundBudget(4120)).toBe(4500);
    expect(roundBudget(5000)).toBe(5000);
    expect(roundBudget(1)).toBe(500);
    expect(roundBudget(0)).toBe(0);
  });
});

describe("aiReadToParsed", () => {
  it("marks the parse as read by AI, so no Smart Rule can approve it on its own", () => {
    const parsed = aiReadToParsed(
      { type: "debit", amount: 100, last4: "1234", merchant: "TEST", balance: null, event: "spend", from: null, to: null, channel: null, auto: null, ref: null, scheme: null, time: null, fx: null },
      "AX-TESTBK",
      Date.UTC(2026, 10, 1, 6),
    );
    expect(parsed.parseSource).toBe("ai");
  });
});
