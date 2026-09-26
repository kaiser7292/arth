import { cleanDueLabel, dueCardSuffix, dueWhen, shortBank } from "../../services/sms/due-description";

describe("cleanDueLabel", () => {
  it.each([
    ["Credit Card Amount Due via HDFC Bank (Amount Due)", "HDFC credit card bill"],
    ["ICICI Credit Card Due via ICICI Bank (Amount Due)", "ICICI credit card bill"],
    ["Credit Card Total Due via State Bank of India (Amount Due)", "State Bank of India credit card bill"],
    ["Credit Card Payment Due via Kotak Mahindra Bank (Amount Due)", "Kotak Mahindra credit card bill"],
    ["IDFC First Credit Card Due via IDFC First Bank (Amount Due)", "IDFC First credit card bill"],
    ["EMI Payment via Axis Bank (EMI Due)", "Axis EMI"],
    ["Loan EMI — Home Loan via HDFC Bank (EMI Due)", "Loan EMI — Home Loan via HDFC Bank"],
    ["NETFLIX via ICICI Bank (Upcoming SI)", "NETFLIX via ICICI Bank"],
    ["HDFC Life Insurance via HDFC Bank (Upcoming SI)", "HDFC Life Insurance"],
    ["Rent", "Rent"],
  ])("%s -> %s", (input, expected) => {
    expect(cleanDueLabel(input)).toBe(expected);
  });

  it("falls back when there's nothing to show", () => {
    expect(cleanDueLabel(null)).toBe("Upcoming payment");
    expect(cleanDueLabel("   ")).toBe("Upcoming payment");
  });

  it("is stable: cleaning a clean label changes nothing", () => {
    for (const s of ["HDFC credit card bill", "Axis EMI", "NETFLIX via ICICI Bank"]) {
      expect(cleanDueLabel(cleanDueLabel(s))).toBe(cleanDueLabel(s));
    }
  });

  it("shortens bank names", () => {
    expect(shortBank("HDFC Bank")).toBe("HDFC");
    expect(shortBank("IDFC First Bank")).toBe("IDFC First");
  });
});


describe("dueCardSuffix", () => {
  it("prefers the linked account", () => {
    expect(dueCardSuffix("XXXX4521", "card ending 9999")).toBe("••4521");
  });
  it("falls back to the digits in the SMS", () => {
    expect(dueCardSuffix(null, "Axis Bank Credit Card ending 8812: total due Rs 9,148")).toBe("••8812");
    expect(dueCardSuffix("", "ICICI Card XX1234 payment due")).toBe("••1234");
    expect(dueCardSuffix(null, "Card **5678 due on 05-Oct")).toBe("••5678");
  });
  it("returns null when there's nothing to show", () => {
    expect(dueCardSuffix(null, "Your EMI of Rs 5000 is due")).toBeNull();
    expect(dueCardSuffix("ab", null)).toBeNull();
  });
});

describe("dueWhen", () => {
  const today = "2026-09-26";
  it("says today / tomorrow / in N days", () => {
    expect(dueWhen("2026-09-26", today)).toEqual({ text: "Due today", overdue: false });
    expect(dueWhen("2026-09-27", today)).toEqual({ text: "Due tomorrow", overdue: false });
    expect(dueWhen("2026-10-05", today)).toEqual({ text: "Due in 9 days · 5 Oct", overdue: false });
  });
  it("says overdue", () => {
    expect(dueWhen("2026-09-25", today)).toEqual({ text: "Overdue by 1 day · 25 Sep", overdue: true });
    expect(dueWhen("2026-09-20", today)).toEqual({ text: "Overdue by 6 days · 20 Sep", overdue: true });
  });
});
