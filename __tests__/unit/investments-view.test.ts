/** The Investments screen's FD ladder (docs/INVESTMENTS_VIEW_PROPOSAL.md). Made-up FDs. */
import { averageRate, fdLadder } from "@/services/investments-view";
import type { UpcomingFDMaturity } from "@/services/investment-accounts";

const NOW = new Date(2026, 10, 18, 12);
const fd = (id: string, date: string, amount: number, interest = 5000): UpcomingFDMaturity => ({
  financialAccountId: id,
  label: `FD ${id}`,
  maturityDate: date,
  maturityAmount: amount,
  interestAmount: interest,
});

describe("FD ladder", () => {
  const list = [
    fd("a", "2026-11-03", 50000),
    fd("b", "2026-11-28", 100000),
    fd("c", "2026-12-14", 70000),
    fd("d", "2027-02-22", 60000),
    fd("e", "2027-06-18", 150000),
    fd("f", "2028-01-10", 90000),
  ];
  const l = fdLadder(list, new Map([["c", 7.25]]), NOW);

  it("an FD past its date and still open is asked about, not counted as coming", () => {
    expect(l.overdue.map((i) => i.financialAccountId)).toEqual(["a"]);
  });
  it("buckets by when the money comes back", () => {
    expect(l.buckets.map((b) => [b.key, b.items.length, b.amount])).toEqual([
      ["month", 1, 100000],
      ["next3", 2, 130000],
      ["year", 1, 150000],
      ["later", 1, 90000],
    ]);
  });
  it("90 days, next date, interest, and 12 months of bars", () => {
    expect(l.next90).toBe(170000); // 28 Nov + 14 Dec; 22 Feb is past 16 Feb
    expect(l.nextDate).toBe("2026-11-28");
    expect(l.interestToCome).toBe(25000);
    expect(l.months).toHaveLength(12);
    expect(l.months[0]).toEqual({ month: "2026-11", amount: 100000 });
    expect(l.months[7]).toEqual({ month: "2027-06", amount: 150000 });
  });
  it("carries the rate", () => {
    expect(l.buckets[1].items[0].ratePa).toBe(7.25);
  });
  it("leaves empty buckets out", () => {
    expect(fdLadder([fd("x", "2027-08-01", 1000)], new Map(), NOW).buckets.map((b) => b.key)).toEqual(["year"]);
  });
});

describe("average rate", () => {
  it("weighted by the amount in each FD", () => {
    expect(averageRate([{ principal: 100000, rate: 7 }, { principal: 300000, rate: 8 }])).toBe(7.75);
    expect(averageRate([{ principal: null, rate: 7 }])).toBeNull();
  });
});
