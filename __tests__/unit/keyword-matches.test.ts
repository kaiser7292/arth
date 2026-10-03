jest.mock("../../database", () => ({ getDatabase: jest.fn() }));
jest.mock("../../services/public-data/lookup", () => ({ resolveMerchantBrand: jest.fn() }));
import { keywordMatches } from "../../services/smart-categorizer";

describe("keywordMatches", () => {
  it("contains mode matches anywhere, as keyword rules always have", () => {
    expect(keywordMatches("pyu*swiggy food", "swiggy")).toBe(true);
    expect(keywordMatches("swiggyinstamart", "swiggy")).toBe(true);
  });
  it("word mode needs whole words", () => {
    expect(keywordMatches("more retail", "more", "word")).toBe(true);
    expect(keywordMatches("more", "more", "word")).toBe(true);
    expect(keywordMatches("rsp*more mega store", "more", "word")).toBe(true);
    expect(keywordMatches("moreover cafe", "more", "word")).toBe(false);
    expect(keywordMatches("bangalore metro rail", "metro", "word")).toBe(true);
    expect(keywordMatches("metropolis labs", "metro", "word")).toBe(false);
    expect(keywordMatches("barbeque nation blr", "barbeque nation", "word")).toBe(true);
  });
  it("treats regex characters in keywords literally", () => {
    expect(keywordMatches("c+ store", "c+", "word")).toBe(true);
    expect(keywordMatches("cc store", "c+", "word")).toBe(false);
  });
});
