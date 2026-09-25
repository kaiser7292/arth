import { cleanDueLabel, shortBank } from "../../services/sms/due-description";

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
