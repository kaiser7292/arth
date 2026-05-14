/**
 * Cash-flow simulator — engine unit tests.
 *
 * Covers:
 *   - Baseline snapshot with zero entries
 *   - Expense reduces savings / increases CC utilized
 *   - Credit increases savings / reduces CC utilized
 *   - Entry sorted ascending even if input is out-of-order
 *   - Beyond-horizon entries ignored
 *   - Warnings (min-balance, CC over-limit, negative non-CC)
 *   - Warning dedupe per (account, kind)
 *   - Net worth computation across asset / liability types
 *   - Unknown account — no crash, no-op
 *   - Fulfillment matcher: amount/date tolerance, account guard
 */

import {
  runSimulation,
  findFulfillmentCandidate,
  netWorthOf,
  type BaselineAccount,
  type EngineEntry,
  type SimulationInput,
  type FulfillmentCandidate,
} from "../../services/simulator-engine";

function bal(partial: Partial<BaselineAccount> & Pick<BaselineAccount, "id" | "type" | "balance">): BaselineAccount {
  return {
    label: partial.id,
    ...partial,
  } as BaselineAccount;
}

const today = "2026-05-02";
const horizon = "2026-05-31";

function baseInput(overrides: Partial<SimulationInput> = {}): SimulationInput {
  return {
    startBalances: [],
    entries: [],
    horizonDate: horizon,
    todayDate: today,
    ...overrides,
  };
}

describe("runSimulation", () => {
  it("emits today + horizon snapshots when no entries exist", () => {
    const input = baseInput({
      startBalances: [bal({ id: "s1", type: "savings", balance: 10000 })],
    });
    const out = runSimulation(input);
    expect(out.trajectory).toHaveLength(2);
    expect(out.trajectory[0].date).toBe(today);
    expect(out.trajectory[1].date).toBe(horizon);
    expect(out.netWorthStart).toBe(10000);
    expect(out.netWorthEnd).toBe(10000);
    expect(out.endBalances.s1).toBe(10000);
    expect(out.warnings).toEqual([]);
  });

  it("outgoing expense reduces savings", () => {
    const out = runSimulation(
      baseInput({
        startBalances: [bal({ id: "s1", type: "savings", balance: 10000 })],
        entries: [{ id: "e1", direction: "out", amount: 2500, date: "2026-05-10", accountId: "s1" }],
      }),
    );
    expect(out.endBalances.s1).toBe(7500);
    expect(out.netWorthEnd).toBe(7500);
  });

  it("outgoing on a credit card INCREASES utilized", () => {
    const out = runSimulation(
      baseInput({
        startBalances: [bal({ id: "cc1", type: "credit_card", balance: 5000, creditLimit: 100000 })],
        entries: [{ id: "e1", direction: "out", amount: 3000, date: "2026-05-10", accountId: "cc1" }],
      }),
    );
    expect(out.endBalances.cc1).toBe(8000);
    // CC is a liability → net worth DROPS by the additional utilized.
    expect(out.netWorthEnd).toBe(-8000);
  });

  it("incoming credit increases savings", () => {
    const out = runSimulation(
      baseInput({
        startBalances: [bal({ id: "s1", type: "savings", balance: 10000 })],
        entries: [{ id: "e1", direction: "in", amount: 50000, date: "2026-05-15", accountId: "s1" }],
      }),
    );
    expect(out.endBalances.s1).toBe(60000);
  });

  it("incoming on a credit card reduces utilized (bill payment)", () => {
    const out = runSimulation(
      baseInput({
        startBalances: [bal({ id: "cc1", type: "credit_card", balance: 5000, creditLimit: 100000 })],
        entries: [{ id: "e1", direction: "in", amount: 4000, date: "2026-05-20", accountId: "cc1" }],
      }),
    );
    expect(out.endBalances.cc1).toBe(1000);
  });

  it("entries are applied in date-ascending order regardless of input order", () => {
    const out = runSimulation(
      baseInput({
        startBalances: [bal({ id: "s1", type: "savings", balance: 10000 })],
        entries: [
          { id: "e2", direction: "out", amount: 3000, date: "2026-05-20", accountId: "s1" },
          { id: "e1", direction: "out", amount: 2000, date: "2026-05-10", accountId: "s1" },
        ],
      }),
    );
    // trajectory: today, 05-10, 05-20, horizon
    expect(out.trajectory.map((t) => t.date)).toEqual([today, "2026-05-10", "2026-05-20", horizon]);
    expect(out.trajectory[1].byAccount.s1).toBe(8000);
    expect(out.trajectory[2].byAccount.s1).toBe(5000);
  });

  it("entries beyond the horizon are ignored", () => {
    const out = runSimulation(
      baseInput({
        startBalances: [bal({ id: "s1", type: "savings", balance: 10000 })],
        entries: [
          { id: "e1", direction: "out", amount: 2000, date: "2026-05-10", accountId: "s1" },
          { id: "e2", direction: "out", amount: 5000, date: "2026-06-15", accountId: "s1" }, // past horizon
        ],
      }),
    );
    expect(out.endBalances.s1).toBe(8000);
    // Trajectory = today, 05-10, horizon (no 06-15 point)
    expect(out.trajectory).toHaveLength(3);
    expect(out.trajectory.some((t) => t.date === "2026-06-15")).toBe(false);
  });

  it("detects savings min-balance breach", () => {
    const out = runSimulation(
      baseInput({
        startBalances: [bal({ id: "s1", type: "savings", balance: 10000, minBalance: 5000 })],
        entries: [{ id: "e1", direction: "out", amount: 7000, date: "2026-05-10", accountId: "s1" }],
      }),
    );
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0].kind).toBe("min_balance_breach");
    expect(out.warnings[0].accountId).toBe("s1");
    expect(out.warnings[0].firstTriggerDate).toBe("2026-05-10");
  });

  it("does not fire min-balance when the minimum is zero (feature off)", () => {
    const out = runSimulation(
      baseInput({
        startBalances: [bal({ id: "s1", type: "savings", balance: 100, minBalance: 0 })],
        entries: [{ id: "e1", direction: "out", amount: 150, date: "2026-05-10", accountId: "s1" }],
      }),
    );
    // minBalance=0 means alert off — no min_balance_breach, but DOES fire negative_balance
    expect(out.warnings.some((w) => w.kind === "min_balance_breach")).toBe(false);
    expect(out.warnings.some((w) => w.kind === "negative_balance")).toBe(true);
  });

  it("detects CC over-limit", () => {
    const out = runSimulation(
      baseInput({
        startBalances: [bal({ id: "cc1", type: "credit_card", balance: 90000, creditLimit: 100000 })],
        entries: [{ id: "e1", direction: "out", amount: 15000, date: "2026-05-10", accountId: "cc1" }],
      }),
    );
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0].kind).toBe("cc_over_limit");
  });

  it("detects non-CC negative balance (wallet overdraft)", () => {
    const out = runSimulation(
      baseInput({
        startBalances: [bal({ id: "w1", type: "wallet", balance: 100 })],
        entries: [{ id: "e1", direction: "out", amount: 500, date: "2026-05-10", accountId: "w1" }],
      }),
    );
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0].kind).toBe("negative_balance");
  });

  it("does NOT fire a warning when baseline already breached (v16.0.1)", () => {
    // Wallet already at ₹100 (below 0 is false but let's say minBalance=5000 > 100 baseline).
    // Simulator adds ₹20 expense. Balance goes 100 → 80. Still below min.
    // But baseline was already below min → this is a real-world problem, not
    // a simulation-caused warning. Should NOT fire.
    const out = runSimulation(
      baseInput({
        startBalances: [bal({ id: "s1", type: "savings", balance: 100, minBalance: 5000 })],
        entries: [{ id: "e1", direction: "out", amount: 20, date: "2026-05-10", accountId: "s1" }],
      }),
    );
    expect(out.warnings).toEqual([]);
  });

  it("does NOT fire negative_balance when the account was already negative at baseline", () => {
    const out = runSimulation(
      baseInput({
        startBalances: [bal({ id: "w1", type: "wallet", balance: -500 })],
        entries: [{ id: "e1", direction: "in", amount: 100, date: "2026-05-10", accountId: "w1" }],
      }),
    );
    // Wallet was already −500, in brings to −400. Still negative but simulation
    // improved it — definitely not a simulation-caused warning.
    expect(out.warnings.filter((w) => w.kind === "negative_balance")).toHaveLength(0);
  });

  it("dedupes warnings per (account, kind) — first trigger wins", () => {
    const out = runSimulation(
      baseInput({
        startBalances: [bal({ id: "s1", type: "savings", balance: 10000, minBalance: 5000 })],
        entries: [
          { id: "e1", direction: "out", amount: 6000, date: "2026-05-10", accountId: "s1" }, // 4000 → breach
          { id: "e2", direction: "out", amount: 1000, date: "2026-05-20", accountId: "s1" }, // 3000 → would re-fire
        ],
      }),
    );
    const breaches = out.warnings.filter((w) => w.kind === "min_balance_breach");
    expect(breaches).toHaveLength(1);
    expect(breaches[0].firstTriggerDate).toBe("2026-05-10");
  });

  it("net worth treats savings/wallet/demat as assets, cc/loan as liabilities", () => {
    const out = runSimulation(
      baseInput({
        startBalances: [
          bal({ id: "s1", type: "savings", balance: 100000 }),
          bal({ id: "w1", type: "wallet", balance: 500 }),
          bal({ id: "d1", type: "demat", balance: 20000 }),
          bal({ id: "cc1", type: "credit_card", balance: 15000, creditLimit: 100000 }),
          bal({ id: "l1", type: "loan", balance: 200000 }),
        ],
      }),
    );
    // assets: 100000 + 500 + 20000 = 120500
    // liabilities: 15000 + 200000 = 215000
    // net = -94500
    expect(out.netWorthStart).toBe(-94500);
    expect(out.netWorthEnd).toBe(-94500);
  });

  it("treats pension as asset", () => {
    const m = new Map<string, BaselineAccount>();
    m.set("p1", bal({ id: "p1", type: "pension", balance: 50000 }));
    expect(netWorthOf(m)).toBe(50000);
  });

  it("entry with unknown account id — no throw, state unchanged", () => {
    const out = runSimulation(
      baseInput({
        startBalances: [bal({ id: "s1", type: "savings", balance: 10000 })],
        entries: [{ id: "e1", direction: "out", amount: 999, date: "2026-05-10", accountId: "ghost" }],
      }),
    );
    expect(out.endBalances.s1).toBe(10000);
  });

  it("entry with no accountId is a no-op (unattributed)", () => {
    const out = runSimulation(
      baseInput({
        startBalances: [bal({ id: "s1", type: "savings", balance: 10000 })],
        entries: [{ id: "e1", direction: "out", amount: 999, date: "2026-05-10" }],
      }),
    );
    expect(out.endBalances.s1).toBe(10000);
  });

  it("trajectory dates are monotonically non-decreasing", () => {
    const out = runSimulation(
      baseInput({
        startBalances: [bal({ id: "s1", type: "savings", balance: 10000 })],
        entries: [
          { id: "e1", direction: "out", amount: 100, date: "2026-05-20", accountId: "s1" },
          { id: "e2", direction: "out", amount: 200, date: "2026-05-10", accountId: "s1" },
          { id: "e3", direction: "out", amount: 300, date: "2026-05-15", accountId: "s1" },
        ],
      }),
    );
    const dates = out.trajectory.map((t) => t.date);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] >= dates[i - 1]).toBe(true);
    }
  });
});

describe("findFulfillmentCandidate", () => {
  function entry(over: Partial<EngineEntry> = {}): EngineEntry {
    return { id: "e1", direction: "out", amount: 1000, date: "2026-05-10", accountId: "s1", ...over };
  }
  function cand(over: Partial<FulfillmentCandidate> = {}): FulfillmentCandidate {
    return { id: "c1", amount: 1000, date: "2026-05-10", account_id: "s1", ...over };
  }

  it("matches an exact amount / date / account candidate", () => {
    const res = findFulfillmentCandidate(entry(), [cand()]);
    expect(res?.id).toBe("c1");
  });

  it("rejects any non-exact amount by default (v16.0.5)", () => {
    // v16.0.5 — amount tolerance dropped to exact; a 4% miss no longer matches.
    const res = findFulfillmentCandidate(entry(), [cand({ amount: 1040 })]);
    expect(res).toBeNull();
  });

  it("accepts paise-level drift within the 1p float epsilon", () => {
    // SQLite REAL round-trip may introduce sub-paise noise.
    const res = findFulfillmentCandidate(entry(), [cand({ amount: 1000.005 })]);
    expect(res?.id).toBe("c1");
  });

  it("respects opt-in percentage tolerance when caller passes it", () => {
    const res = findFulfillmentCandidate(
      entry(),
      [cand({ amount: 1040 })],
      { amountPct: 0.05 },
    );
    expect(res?.id).toBe("c1");
  });

  it("rejects beyond opt-in amount tolerance", () => {
    const res = findFulfillmentCandidate(
      entry(),
      [cand({ amount: 1100 })],
      { amountPct: 0.05 },
    );
    expect(res).toBeNull();
  });

  it("matches within 3-day window", () => {
    const res = findFulfillmentCandidate(entry(), [cand({ date: "2026-05-13" })]);
    expect(res?.id).toBe("c1");
  });

  it("rejects beyond 3-day window", () => {
    const res = findFulfillmentCandidate(entry(), [cand({ date: "2026-05-14" })]);
    expect(res).toBeNull();
  });

  it("rejects account mismatch when entry has an accountId", () => {
    const res = findFulfillmentCandidate(entry(), [cand({ account_id: "s2" })]);
    expect(res).toBeNull();
  });

  it("allows match across accounts when entry has no accountId", () => {
    const res = findFulfillmentCandidate(entry({ accountId: undefined }), [cand({ account_id: "any" })]);
    expect(res?.id).toBe("c1");
  });

  it("allows match with a candidate whose account_id is null (SMS orphan expense)", () => {
    // v16.0.1: real expenses can have account_id=NULL (SMS detected, never
    // linked to an account). Previously rejected; now matches with a small
    // tie-break penalty so an account-matched candidate still wins.
    const res = findFulfillmentCandidate(entry(), [cand({ account_id: null })]);
    expect(res?.id).toBe("c1");
  });

  it("prefers an account-matched candidate over a null-account one", () => {
    const res = findFulfillmentCandidate(entry(), [
      cand({ id: "null-acct", account_id: null }),
      cand({ id: "exact-acct", account_id: "s1" }),
    ]);
    expect(res?.id).toBe("exact-acct");
  });

  it("picks the closest amount among multiple opt-in matches", () => {
    const res = findFulfillmentCandidate(
      entry(),
      [
        cand({ id: "a", amount: 1040, date: "2026-05-10" }),
        cand({ id: "b", amount: 1005, date: "2026-05-10" }),
      ],
      { amountPct: 0.05 },
    );
    expect(res?.id).toBe("b");
  });

  it("tie-breaks by date when amounts tie", () => {
    const res = findFulfillmentCandidate(entry(), [
      cand({ id: "a", amount: 1000, date: "2026-05-12" }),
      cand({ id: "b", amount: 1000, date: "2026-05-10" }),
    ]);
    expect(res?.id).toBe("b");
  });

  it("returns null when no candidates match", () => {
    const res = findFulfillmentCandidate(entry(), []);
    expect(res).toBeNull();
  });
});
