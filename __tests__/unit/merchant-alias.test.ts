/**
 * Tests for merchant name cleaning/normalization.
 */

import { cleanMerchantName } from "../../services/merchant-alias";

describe("cleanMerchantName", () => {
  it("strips PYU* prefix", () => {
    expect(cleanMerchantName("PYU*Swiggy Food")).toBe("Swiggy Food");
  });

  it("strips CAS* prefix", () => {
    expect(cleanMerchantName("CAS*Zomato")).toBe("Zomato");
  });

  it("strips InfoEBA* prefix", () => {
    expect(cleanMerchantName("InfoEBA*Netflix")).toBe("Netflix");
  });

  it("strips RAZORPAY* prefix", () => {
    expect(cleanMerchantName("RAZORPAY*Amazon")).toBe("Amazon");
  });

  it("strips PAYU* prefix", () => {
    expect(cleanMerchantName("PAYU*Flipkart")).toBe("Flipkart");
  });

  it("strips PHONEPE* prefix", () => {
    expect(cleanMerchantName("PHONEPE*Uber")).toBe("Uber");
  });

  it("strips corporate suffixes", () => {
    expect(cleanMerchantName("ZOMATO LTD")).toBe("ZOMATO");
    expect(cleanMerchantName("Swiggy Private Limited")).toBe("Swiggy");
    expect(cleanMerchantName("Amazon India Pvt Ltd")).toBe("Amazon");
  });

  it("strips multiple suffixes in multiple passes", () => {
    expect(cleanMerchantName("Netflix India Private Limited")).toBe("Netflix");
  });

  it("handles combined prefix + suffix", () => {
    expect(cleanMerchantName("PYU*Swiggy Technologies Pvt Ltd")).toBe("Swiggy");
  });

  it("trims whitespace", () => {
    expect(cleanMerchantName("  Uber  ")).toBe("Uber");
  });

  it("returns as-is when no prefix/suffix match", () => {
    expect(cleanMerchantName("Big Bazaar")).toBe("Big Bazaar");
  });

  it("handles empty string", () => {
    expect(cleanMerchantName("")).toBe("");
  });

  it("is case-insensitive for prefixes", () => {
    expect(cleanMerchantName("pyu*Swiggy")).toBe("Swiggy");
    expect(cleanMerchantName("Pyu*Zomato")).toBe("Zomato");
  });
});
