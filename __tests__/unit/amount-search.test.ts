import { matchesSearch, parseAmountQuery } from "../../utils/amount-search";
import { transactionTitle } from "../../utils/transaction-title";

const finds = (q: string, amount: number) => matchesSearch(q, [], [amount]);

describe("amount search", () => {
  it("a whole number finds that amount and its paise", () => {
    expect(finds("450", 450)).toBe(true);
    expect(finds("450", 450.75)).toBe(true);
    expect(finds("450", 451)).toBe(false);
    expect(finds("450", 449.99)).toBe(false);
  });
  it("paise mean exactly that", () => {
    expect(finds("450.50", 450.5)).toBe(true);
    expect(finds("450.50", 450.51)).toBe(false);
  });
  it("ranges, either way round, with commas and a rupee sign", () => {
    expect(finds("450-500", 480)).toBe(true);
    expect(finds("500 to 450", 500)).toBe(true);
    expect(finds("₹1,000 - 2,000", 1500)).toBe(true);
    expect(finds("450-500", 501)).toBe(false);
  });
  it("above and below", () => {
    expect(finds(">5000", 5000.01)).toBe(true);
    expect(finds(">5000", 5000)).toBe(false);
    expect(finds(">=5000", 5000)).toBe(true);
    expect(finds("<100", 99.99)).toBe(true);
    expect(finds("<100", 100)).toBe(false);
    expect(finds("under 100", 50)).toBe(true);
    expect(finds("above 100", 150)).toBe(true);
  });
  it("Rs and INR are read", () => {
    expect(finds("Rs. 450", 450)).toBe(true);
    expect(finds("INR 450", 450)).toBe(true);
  });
  it("names aren't amounts", () => {
    expect(parseAmountQuery("1mg")).toBeNull();
    expect(parseAmountQuery("swiggy")).toBeNull();
    expect(parseAmountQuery("")).toBeNull();
  });
  it("a number also matches names, and an empty search matches everything", () => {
    expect(matchesSearch("99", ["Store 99"], [10])).toBe(true);
    expect(matchesSearch("  ", [], [])).toBe(true);
    expect(matchesSearch("zomato", ["Swiggy", null], [10])).toBe(false);
  });
});

describe("transactionTitle", () => {
  it("description, else merchant, else category, else the fallback", () => {
    expect(transactionTitle({ description: "Lunch", merchant_name: "Zomato" }, "Food")).toBe("Lunch");
    expect(transactionTitle({ description: "  ", merchant_name: "Zomato" }, "Food")).toBe("Zomato");
    expect(transactionTitle({ description: null, merchant_name: null }, "Food")).toBe("Food");
    expect(transactionTitle({}, null, "Credit")).toBe("Credit");
    expect(transactionTitle({})).toBe("Transaction");
  });
});
