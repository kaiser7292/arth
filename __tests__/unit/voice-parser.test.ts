/** Spoken entries (docs/SPEED_AND_VOICE_PROPOSAL.md §2.2 B). Made-up merchants and figures. */
import { looksLikeTransfer, matchCategory, matchMerchant, parseVoiceInput, wholeReply } from "@/utils/voice-parser";

const NOW = new Date(2026, 10, 18, 12);
const ctx = {
  merchants: ["Swiggy", "DMart", "Blinkit", "Zomato", "Ola", "Sharma Sweets"],
  categories: ["Food & Dining", "Groceries", "Fuel", "Transport", "Health", "Shopping", "Bills"],
  modes: ["UPI", "Cash", "HDFC Credit Card", "Debit Card"],
};
const p = (s: string) => parseVoiceInput(s, ctx, NOW);

describe("a spoken entry", () => {
  it("the example from the sheet", () => {
    expect(p("450 at Swiggy for lunch, GPay, yesterday")).toMatchObject({
      amount: 450,
      merchant: "Swiggy",
      category: "Food & Dining",
      paymentModeName: "UPI",
      paymentMode: "UPI",
      dateIso: "2026-11-17",
    });
  });

  it("number words", () => {
    expect(p("spent two fifty at D Mart")).toMatchObject({ amount: 250, merchant: "DMart", category: "Groceries" });
    expect(p("fifteen hundred on groceries")).toMatchObject({ amount: 1500, category: "Groceries" });
    expect(p("dedh sau chai")).toMatchObject({ amount: 150 });
  });

  it("'on groceries' is a category, not a merchant", () => {
    const r = p("spent 450 on groceries");
    expect(r.merchant).toBeUndefined();
    expect(r.category).toBe("Groceries");
  });

  it("your merchants, forgivingly, in your spelling", () => {
    expect(p("300 at blink it").merchant).toBe("Blinkit");
    expect(p("dmart 1200").merchant).toBe("DMart");
    expect(p("800 sharma sweets").merchant).toBe("Sharma Sweets");
  });

  it("a new merchant keeps what was said", () => {
    expect(p("600 at Green Leaf Cafe").merchant).toBe("Green Leaf Cafe");
  });

  it("everyday words find your category", () => {
    expect(p("2000 petrol").category).toBe("Fuel");
    expect(p("120 auto").category).toBe("Transport");
    expect(p("340 medicines").category).toBe("Health");
  });

  it("payment apps map to your UPI mode; your own mode names win", () => {
    expect(p("500 phone pe").paymentMode).toBe("UPI");
    expect(p("500 paytm").paymentMode).toBe("UPI");
    expect(p("2000 on hdfc credit card").paymentMode).toBe("HDFC Credit Card");
    expect(p("200 cash").paymentMode).toBe("Cash");
  });

  it("dates said in the sentence don't become the amount", () => {
    expect(p("on the 5th 300 at the bakery")).toMatchObject({ amount: 300, dateIso: "2026-11-05" });
    expect(p("last friday 800 at zomato")).toMatchObject({ amount: 800, merchant: "Zomato", dateIso: "2026-11-13" });
  });

  it("works without your lists, as before", () => {
    expect(parseVoiceInput("Spent 450 at Swiggy for lunch")).toMatchObject({ amount: 450, merchant: "Swiggy", description: "lunch" });
    expect(parseVoiceInput("1500")).toMatchObject({ amount: 1500 });
  });
});

describe("matching", () => {
  it("short merchants only as whole words", () => {
    expect(matchMerchant("bought chocolate", ["Ola"])).toBeUndefined();
    expect(matchMerchant("ola to office", ["Ola"])).toBe("Ola");
  });
  it("category names, longest first", () => {
    expect(matchCategory("food and dining", ["Food", "Food & Dining"])).toBe("Food & Dining");
  });
});

describe("commands only when they're the whole reply", () => {
  it.each([
    ["done", "done"],
    ["Done.", "done"],
    ["skip", "skip"],
    ["yes", "yes"],
    ["haan", "yes"],
    ["no", "no"],
  ])("%s", (said, cmd) => expect(wholeReply(said)).toBe(cmd));

  it.each(["done at the salon 500", "bus pass 300", "next door shop 200", "no frills 400"])("%s is an entry", (said) => {
    expect(wholeReply(said)).toBeUndefined();
  });
});

describe("transfers", () => {
  it("between your accounts", () => {
    expect(looksLikeTransfer("transfer 500 from HDFC to SBI")).toBe(true);
    expect(looksLikeTransfer("move 2k to savings")).toBe(true);
  });
  it("paying by bank transfer is a payment", () => {
    expect(looksLikeTransfer("paid 5000 rent by bank transfer")).toBe(false);
    expect(looksLikeTransfer("3000 to the plumber via bank transfer")).toBe(false);
  });
});

describe("review cases (Nov 2026)", () => {
  const morning = new Date(2026, 10, 28, 9);
  it("today's own date said before noon stays this year", () => {
    expect(parseVoiceInput("28 november 300 swiggy", ctx, morning).dateIso).toBe("2026-11-28");
  });
  it("words that start like months aren't dates", () => {
    expect(p("spent 450 decathlon").amount).toBe(450);
    expect(p("500 marriott").amount).toBe(500);
    expect(p("1200 novotel for dinner").amount).toBe(1200);
  });
  it("digits after a scale word", () => {
    expect(p("2 lakh 50000 for car").amount).toBe(250000);
    expect(p("2 thousand 500 at dmart").amount).toBe(2500);
  });
  it("'the' and a number isn't a date", () => {
    expect(p("paid 500 for the 2 tickets").dateIso).toBeUndefined();
  });
  it("litres aren't lakhs", () => {
    expect(p("bought 5 l milk for ₹60").amount).toBe(60);
  });
  it("a shop said alone is the merchant", () => {
    expect(parseVoiceInput("450 swiggy").merchant).toBe("Swiggy");
  });
  it("transfer said mid-sentence", () => {
    expect(looksLikeTransfer("I want to transfer 500 to SBI")).toBe(true);
    expect(looksLikeTransfer("500 transfer to savings")).toBe(true);
  });
  it.each([
    ["yes please", "yes"], ["yes confirm", "yes"], ["proceed", "yes"], ["ok", "yes"],
    ["no thanks", "no"], ["abort", "no"], ["go back", "no"],
    ["I'm done", "done"], ["okay done", "done"], ["that's it", "done"],
    ["skip this", "skip"], ["skip category", "skip"],
  ])("command with filler: %s", (said, cmd) => expect(wholeReply(said)).toBe(cmd));
});
