/** Plain-words search as filters (docs/SPEED_AND_VOICE_PROPOSAL.md §2.2 B6). Made-up names. */
import { hasSearchFilters, parseSpokenSearch } from "@/utils/voice-search";

const ctx = { merchants: ["Swiggy", "DMart", "Blinkit", "Uber"], categories: ["Food", "Groceries", "Transport", "Shopping"] };
const q = (s: string) => parseSpokenSearch(s, ctx);

describe("spoken search", () => {
  it("merchant, amount and date", () => {
    expect(q("Swiggy over 500 last month")).toMatchObject({ merchant: "Swiggy", min: 500, datePreset: "last_month", text: "" });
  });
  it("number words and k", () => {
    expect(q("more than two thousand")).toMatchObject({ min: 2000 });
    expect(q("under 1.5k")).toMatchObject({ max: 1500 });
    expect(q("between 200 and 500 this month")).toMatchObject({ min: 200, max: 500, datePreset: "this_month" });
  });
  it("categories from everyday words", () => {
    expect(q("groceries last 3 months")).toMatchObject({ category: "Groceries", datePreset: "last_3_months", text: "" });
  });
  it("forgiving merchant spelling", () => {
    expect(q("show me d mart")).toMatchObject({ merchant: "DMart", text: "" });
  });
  it("money in", () => {
    expect(q("refunds this month")).toMatchObject({ nature: "credit", datePreset: "this_month" });
  });
  it("leftover words stay a text search", () => {
    const r = q("birthday cake");
    expect(r.text).toBe("birthday cake");
    expect(hasSearchFilters(r)).toBe(false);
  });
});
