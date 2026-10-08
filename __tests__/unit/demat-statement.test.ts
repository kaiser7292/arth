jest.mock("../../database", () => ({ getDatabase: () => ({}) }));

import { buildDematDays } from "../../services/demat-statement";

const ACC = "demat-1";
const t = (id: string, date: string, amount: number, out = false) => ({
  id,
  date,
  amount,
  from_account_id: out ? ACC : "bank",
  counterparty: "HDFC",
});

describe("buildDematDays", () => {
  it("splits each day's change into your money and the market's, newest first", () => {
    const days = buildDematDays(
      ACC,
      "2026-09",
      [
        { date: "2026-08-31", value: 100000 },
        { date: "2026-09-10", value: 112000 },
        { date: "2026-09-20", value: 105000 },
      ],
      [{ date: "2026-08-31", value: 0 }],
      [t("in1", "2026-09-10", 10000)],
      "2026-09-30",
    );
    expect(days.map((d) => d.date)).toEqual(["2026-09-20", "2026-09-10"]);
    // 10 Sep: 100k → 112k with 10k added = 2k market gain
    expect(days[1]).toMatchObject({ value: 112000, moneyIn: 10000, gain: 2000, gainPct: 1.82 });
    // 20 Sep: 112k → 105k, nothing moved = 7k loss
    expect(days[0]).toMatchObject({ value: 105000, gain: -7000, moneyIn: 0, moneyOut: 0 });
  });

  it("a transfer-only day moves the value, so the next snapshot doesn't count it as gain", () => {
    const days = buildDematDays(
      ACC,
      "2026-09",
      [
        { date: "2026-08-31", value: 50000 },
        { date: "2026-09-15", value: 30500 },
      ],
      [],
      [t("out1", "2026-09-05", 20000, true)],
      "2026-09-30",
    );
    const [snap, withdrawal] = days;
    expect(withdrawal).toMatchObject({ date: "2026-09-05", hasSnapshot: false, value: 30000, moneyOut: 20000, gain: 0 });
    expect(snap).toMatchObject({ date: "2026-09-15", value: 30500, gain: 500 });
  });

  it("ignores days after today", () => {
    const days = buildDematDays(ACC, "2026-10", [{ date: "2026-10-20", value: 1 }], [], [], "2026-10-08");
    expect(days).toEqual([]);
  });
});
