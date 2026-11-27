/** The month story (services/month-story.ts): facts worked out by code. Made-up data only. */
import { buildMonthStory, dayLabel, pickPersona, plainHeadline, prevYm, storyFacts, storyTiles } from "@/services/month-story";

jest.mock("@/utils/format", () => ({
  formatShortAmount: (n: number) => `₹${n >= 1000 ? `${Math.round(n / 100) / 10}K` : n}`,
}));

let seq = 0;
const row = (date: string, amount: number, merchant: string | null = null, cat: string | null = "food") => ({
  id: `r${++seq}`,
  date,
  amount,
  category_id: cat,
  merchant_name: merchant,
  raw_merchant_name: null,
});

const NAMES = new Map([
  ["food", "Food & Dining"],
  ["fuel", "Fuel"],
  ["shop", "Shopping"],
]);

describe("month story", () => {
  it("compares the running month with last month by the same day", () => {
    const now = [row("2026-11-02", 1000), row("2026-11-05", 2000), row("2026-11-20", 9000)];
    const before = [row("2026-10-03", 4000), row("2026-10-09", 3000), row("2026-10-28", 50000)];
    const s = buildMonthStory("2026-11", now, before, NAMES, 0, new Date(2026, 10, 10));
    expect(s.isCurrent).toBe(true);
    expect(s.day).toBe(10);
    expect(s.spent).toBe(3000); // the 20th hasn't happened yet
    expect(s.prevSameDay).toBe(7000);
    expect(s.prevTotal).toBe(57000);
    expect(s.cumulative).toHaveLength(10);
    expect(s.quietDays).toBe(8);
    expect(plainHeadline(s)).toBe("You're ₹4K under October's pace.");
  });

  it("finds the loyal place, the biggest day, and what rose and fell", () => {
    const now = [
      row("2026-10-01", 200, "Testmart Cafe"),
      row("2026-10-04", 220, "Testmart Cafe"),
      row("2026-10-08", 240, "testmart cafe"),
      row("2026-10-12", 6000, "Big Store", "shop"),
      row("2026-10-12", 300, "Testmart Cafe"),
      row("2026-10-15", 800, "Fuel Stop", "fuel"),
    ];
    const before = [row("2026-09-05", 3000, "Fuel Stop", "fuel"), row("2026-09-06", 1000, "Big Store", "shop")];
    const s = buildMonthStory("2026-10", now, before, NAMES, 2, new Date(2026, 10, 27));
    expect(s.isCurrent).toBe(false);
    expect(s.day).toBe(31);
    expect(s.topPlace).toMatchObject({ name: "Testmart Cafe", count: 4 });
    expect(s.biggestDay).toMatchObject({ date: "2026-10-12", amount: 6300, count: 2 });
    expect(s.rise).toMatchObject({ name: "Shopping", pct: 500 });
    expect(s.drop).toMatchObject({ name: "Fuel", pct: -73 });
    expect(s.budgetsOver).toBe(2);
    // One payment is 77% of the month: that's what stands out.
    expect(s.persona.label).toBe("The big-ticket month");
    expect(storyTiles(s).map((t) => t.value)).toEqual(["4 visits", "−73%", "26"]);
    expect(storyFacts(s)).toContain("Most visited place: Testmart Cafe, 4 times, ₹960");
  });

  it("names the month after what stands out", () => {
    const base = buildMonthStory("2026-10", [row("2026-10-03", 500)], [], NAMES, 0, new Date(2026, 10, 1));
    expect(pickPersona({ ...base, biggestPayment: null, topCategory: { categoryId: "food", name: "Food & Dining", amount: 500, share: 0.6 } }).label).toBe("The foodie month");
    expect(pickPersona({ ...base, prevSameDay: 100, spent: 200, biggestPayment: null }).label).toBe("The big-spend month");
    expect(pickPersona({ ...base, prevSameDay: 1000, spent: 500, quietDays: 20, biggestPayment: null }).label).toBe("The quiet month");
    expect(pickPersona({ ...base, prevSameDay: 0, biggestPayment: null, topCategory: null }).label).toBe("A steady month");
  });

  it("small category changes aren't news", () => {
    const s = buildMonthStory("2026-10", [row("2026-10-03", 1100)], [row("2026-09-03", 1000)], NAMES, 0, new Date(2026, 10, 1));
    expect(s.rise).toBeNull();
    expect(s.drop).toBeNull();
  });

  it("an empty month says so", () => {
    const s = buildMonthStory("2026-11", [], [row("2026-10-03", 1000)], NAMES, 0, new Date(2026, 10, 5));
    expect(s.payments).toBe(0);
    expect(plainHeadline(s)).toBe("A clean slate: nothing spent in November yet.");
    expect(storyTiles(s).map((t) => t.label)).toEqual(["No-spend days"]);
  });

  it("a finished month is compared with all of the month before", () => {
    const s = buildMonthStory("2026-11", [row("2026-11-04", 1000)], [row("2026-10-04", 1000), row("2026-10-31", 5000)], NAMES, 0, new Date(2026, 11, 3));
    expect(s.prevSameDay).toBe(6000);
    expect(s.prevSameDay).toBe(s.prevTotal);
    expect(s.drop).toMatchObject({ name: "Food & Dining", before: 6000 });
  });

  it("dates and months", () => {
    expect(prevYm("2026-01")).toBe("2025-12");
    expect(dayLabel("2026-11-08")).toBe("Sun 8 Nov");
  });
});
