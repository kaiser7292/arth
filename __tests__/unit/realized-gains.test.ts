jest.mock("../../database", () => ({ getDatabase: () => ({}) }));
jest.mock("../../services/broker-link", () => ({ getBrokerLinkedAccount: () => null }));

import { replayAccount, taxYearOf, toTaxInputs, type FlowEvent, type WithdrawalGain } from "../../services/realized-gains";
import { computeCapitalGainsTax } from "../../services/tax-engine";

const reading = (rows: { date: string; value: number }[]) => (date: string) => {
  let hit: { date: string; value: number } | null = null;
  for (const r of rows) if (r.date < date) hit = r;
  return hit;
};

describe("replayAccount", () => {
  it("Zebpay: ₹10,000 in, ₹11,717.94 out of ₹11,856.96 -> proportional cost, the rest is gain", () => {
    const flows: FlowEvent[] = [
      { id: "in", date: "2026-08-09", amount: 10000, dir: "in" },
      { id: "out", date: "2026-10-06", amount: 11717.94, dir: "out" },
    ];
    const { withdrawals, remainingCost } = replayAccount(
      flows,
      reading([{ date: "2026-08-09", value: 10000 }, { date: "2026-10-01", value: 11856.96 }]),
      "crypto",
    );
    expect(withdrawals[0]).toMatchObject({ proceeds: 11717.94, cost: 9882.75, gain: 1835.19, fy: 2026 });
    expect(remainingCost).toBe(117.25);
  });

  it("oldest money first: the part held over 12 months is long-term", () => {
    const flows: FlowEvent[] = [
      { id: "a", date: "2024-01-10", amount: 50000, dir: "in" },
      { id: "b", date: "2026-03-10", amount: 50000, dir: "in" },
      { id: "out", date: "2026-06-01", amount: 60000, dir: "out" },
    ];
    // Worth 120,000 before the withdrawal: half of it comes out, so half the cost (50,000) - all
    // of it from the 2024 deposit, which is over a year old.
    const { withdrawals, remainingCost } = replayAccount(flows, reading([{ date: "2026-05-30", value: 120000 }]), "equity");
    expect(withdrawals[0]).toMatchObject({ cost: 50000, gain: 10000, longTerm: 10000, shortTerm: 0 });
    expect(remainingCost).toBe(50000);
  });

  it("with no value to go on, money put in comes back first", () => {
    const flows: FlowEvent[] = [
      { id: "in", date: "2026-05-01", amount: 1000, dir: "in" },
      { id: "out", date: "2026-06-01", amount: 1200, dir: "out" },
    ];
    const { withdrawals } = replayAccount(flows, () => null, "equity");
    expect(withdrawals[0]).toMatchObject({ cost: 1000, gain: 200 });
  });

  it("money added after the last reading counts toward the value before a withdrawal", () => {
    const flows: FlowEvent[] = [
      { id: "a", date: "2026-05-01", amount: 1000, dir: "in" },
      { id: "b", date: "2026-05-20", amount: 1000, dir: "in" },
      { id: "out", date: "2026-06-01", amount: 1100, dir: "out" },
    ];
    // Reading 1,200 on 10 May + 1,000 added on 20 May = 2,200 before; half comes out.
    const { withdrawals } = replayAccount(flows, reading([{ date: "2026-05-10", value: 1200 }]), "equity");
    expect(withdrawals[0]).toMatchObject({ cost: 1000, gain: 100 });
  });
});

describe("taxYearOf", () => {
  it("runs April to March", () => {
    expect(taxYearOf("2026-03-31")).toBe(2025);
    expect(taxYearOf("2026-04-01")).toBe(2026);
  });
});

const g = (over: Partial<WithdrawalGain>): WithdrawalGain => ({
  transferId: "t", accountId: "a", accountName: "A", date: "2026-06-01", fy: 2026, assetClass: "equity",
  proceeds: 0, cost: 0, gain: 0, shortTerm: 0, longTerm: 0, ...over,
});

describe("toTaxInputs", () => {
  it("crypto: each sale alone, a loss counts for nothing; ~1% TDS", () => {
    const r = toTaxInputs([
      g({ assetClass: "crypto", gain: 1835.19, shortTerm: 1835.19, proceeds: 11717.94 }),
      g({ assetClass: "crypto", gain: -500, shortTerm: -500, proceeds: 1000 }),
    ]);
    expect(r.input.crypto).toBe(1835.19);
    expect(r.cryptoTds).toBe(127.18);
  });

  it("equity: a short-term loss offsets short then long-term gains; a long-term loss only long", () => {
    expect(toTaxInputs([g({ shortTerm: -300, longTerm: 1000, gain: 700 })]).input).toMatchObject({ equity_stcg: 0, equity_ltcg: 700 });
    expect(toTaxInputs([g({ shortTerm: 500, longTerm: -800, gain: -300 })]).input).toMatchObject({ equity_stcg: 500, equity_ltcg: 0 });
  });

  it("gold: long-term at 12.5%, short-term with debt at slab", () => {
    expect(toTaxInputs([g({ assetClass: "gold", shortTerm: 200, longTerm: 300, gain: 500 })]).input).toMatchObject({ gold: 300, debt: 200 });
  });
});

describe("crypto in the tax engine", () => {
  it("flat 30% plus 4% cess, no exemption", () => {
    const r = computeCapitalGainsTax(
      { equity_ltcg: 0, equity_stcg: 0, debt: 0, fd: 0, gold: 0, real_estate: 0, crypto: 1835.19 },
      1200000,
      "new",
    );
    expect(r.items).toEqual([expect.objectContaining({ label: "Crypto", rate: "30%", tax: 573 })]);
  });
});
