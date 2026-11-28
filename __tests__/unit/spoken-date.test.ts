/** Spoken dates and periods (docs/SPEED_AND_VOICE_PROPOSAL.md §2.2 B4, §2.3). */
import { readSpokenDate, readSpokenPeriod } from "@/utils/spoken-date";

// Wednesday 18 November 2026, noon.
const NOW = new Date(2026, 10, 18, 12);

describe("one day for a voice entry", () => {
  it.each([
    ["450 at swiggy today", "2026-11-18"],
    ["450 at swiggy yesterday", "2026-11-17"],
    ["kal 200 chai", "2026-11-17"],
    ["parso 300", "2026-11-16"],
    ["day before yesterday 300", "2026-11-16"],
    ["2 days ago 650", "2026-11-16"],
    ["do din pehle 650", "2026-11-16"],
    ["last friday 800", "2026-11-13"],
    ["on monday 120", "2026-11-16"],
    ["on the 5th 300", "2026-11-05"],
    ["300 on 5th", "2026-11-05"],
    ["on the 25th", "2026-10-25"],
    ["5th november 800", "2026-11-05"],
    ["november 5 800", "2026-11-05"],
    ["2 december", "2025-12-02"],
  ])("%s → %s", (said, day) => {
    expect(readSpokenDate(said, NOW)?.dateIso).toBe(day);
  });

  it("none said: undefined (today)", () => {
    expect(readSpokenDate("450 at swiggy", NOW)).toBeUndefined();
  });

  it("gives back the words, to take out of the sentence", () => {
    expect(readSpokenDate("450 at swiggy yesterday", NOW)?.match).toBe("yesterday");
  });
});

describe("the period a question is about", () => {
  it("by day 15: 1–15 this month, against 1–15 last month", () => {
    const p = readSpokenPeriod("what did I spend by day 15", NOW)!;
    expect(p).toMatchObject({ start: "2026-11-01", end: "2026-11-15", label: "1–15 Nov" });
    expect(p.previous).toMatchObject({ start: "2026-10-01", end: "2026-10-15" });
  });

  it("till the 25th, not yet reached: last month's", () => {
    expect(readSpokenPeriod("spent till the 25th", NOW)).toMatchObject({ start: "2026-10-01", end: "2026-10-25" });
  });

  it.each([
    ["spend this month", "2026-11-01", "2026-11-18"],
    ["spend last month", "2026-10-01", "2026-10-31"],
    ["food in october", "2026-10-01", "2026-10-31"],
    ["swiggy in december", "2025-12-01", "2025-12-31"],
    ["this week", "2026-11-16", "2026-11-18"],
    ["last week", "2026-11-09", "2026-11-15"],
    ["last 7 days", "2026-11-12", "2026-11-18"],
    ["last 3 months", "2026-09-01", "2026-11-18"],
    ["this financial year", "2026-04-01", "2026-11-18"],
    ["this year", "2026-04-01", "2026-11-18"],
    ["last year", "2025-01-01", "2025-12-31"],
    ["today", "2026-11-18", "2026-11-18"],
    ["yesterday", "2026-11-17", "2026-11-17"],
  ])("%s → %s to %s", (said, start, end) => {
    expect(readSpokenPeriod(said, NOW)).toMatchObject({ start, end });
  });

  it("this month compares with the same days of last month", () => {
    expect(readSpokenPeriod("this month", NOW)!.previous).toMatchObject({ start: "2026-10-01", end: "2026-10-18" });
  });

  it("'may' as a word isn't a month", () => {
    expect(readSpokenPeriod("may I know my spend", NOW)).toBeUndefined();
    expect(readSpokenPeriod("spend in may", NOW)).toMatchObject({ start: "2026-05-01" });
  });

  it("by 500 rupees isn't a day", () => {
    expect(readSpokenPeriod("over by 500 rupees", NOW)).toBeUndefined();
  });
});
