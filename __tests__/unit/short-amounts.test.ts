import { shortAmountBody } from "../../utils/format";

describe("shortAmountBody", () => {
  it("reads lakh and crore", () => {
    expect(shortAmountBody(950, "lakh")).toBe("950");
    expect(shortAmountBody(14900, "lakh")).toBe("14.9K");
    expect(shortAmountBody(230000, "lakh")).toBe("2.3L");
    expect(shortAmountBody(12000000, "lakh")).toBe("1.2Cr");
  });
  it("reads million and billion", () => {
    expect(shortAmountBody(14900, "million")).toBe("14.9K");
    expect(shortAmountBody(2300000, "million")).toBe("2.3M");
    expect(shortAmountBody(1200000000, "million")).toBe("1.2B");
  });
});
