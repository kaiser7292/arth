/** Spoken amounts (docs/SPEED_AND_VOICE_PROPOSAL.md §2.2 B1). Made-up figures only. */
import { findAmount, normaliseSpokenNumbers, readSpokenAmount } from "@/utils/spoken-number";

describe("spoken amounts", () => {
  it.each([
    ["450", 450],
    ["₹450 at swiggy", 450],
    ["rs 1,200 at dmart", 1200],
    ["1,20,000 for the bike", 120000],
    ["two fifty at the chai stall", 250],
    ["two fifty five", 255],
    ["fifteen hundred for groceries", 1500],
    ["twelve fifty", 1250],
    ["two thousand five hundred", 2500],
    ["nine hundred and fifty", 950],
    ["fifty five rupees", 55],
    ["one twenty for the auto", 120],
    ["1.5k on clothes", 1500],
    ["2k at amazon", 2000],
    ["2 k at amazon", 2000],
    ["5 lakh for the car", 500000],
    ["1.2 crore", 12000000],
    ["three lakh fifty thousand", 350000],
    ["ek sau", 100],
    ["do hazaar", 2000],
    ["dedh sau ka chai", 150],
    ["dhai hazaar", 2500],
    ["saade teen hazaar", 3500],
    ["sava sau", 125],
    ["paune do sau", 175],
    ["pachaas rupaye", 50],
    ["2:50 at cafe", 250],
  ])("%s → %d", (said, amount) => {
    expect(readSpokenAmount(said)).toBe(amount);
  });

  it.each([
    ["on the 5th, 300 at the bakery", 300],
    ["300 on the 5th", 300],
    ["5 november 800 for the plumber", 800],
    ["2 days ago 650 at the pharmacy", 650],
    ["card ending 4321 paid 999", 999],
    ["paid 200 by card, ₹1,450 total", 1450],
  ])("skips dates and card digits: %s → %d", (said, amount) => {
    expect(readSpokenAmount(said)).toBe(amount);
  });

  it("finds nothing when no amount was said", () => {
    expect(readSpokenAmount("lunch at the office")).toBeUndefined();
    expect(readSpokenAmount("the one near home")).toBeUndefined();
    expect(readSpokenAmount("what do I do")).toBeUndefined();
  });

  it("keeps the rest of the sentence as it was", () => {
    expect(normaliseSpokenNumbers("spent two fifty at D Mart, yesterday")).toBe("spent 250 at D Mart, yesterday");
    expect(normaliseSpokenNumbers("do you know")).toBe("do you know");
    expect(normaliseSpokenNumbers("the one at Swiggy")).toBe("the one at Swiggy");
  });

  it("says where the amount was, so it can be taken out", () => {
    const f = findAmount("lunch 450 at swiggy");
    expect(f).toMatchObject({ value: 450, index: 6 });
  });
});
