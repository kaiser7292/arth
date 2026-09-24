/**
 * Catch Up deck logic: order, staleness, "same again" batching, stats, and the deferred
 * commit that makes Undo exact.
 */

import type { DuplicateGroup } from "../../services/duplicate-detection";
import type { Expense, ForecastMatchPair } from "../../services/expense";
import {
  DeferredAction,
  buildCatchUpDeck,
  findSameMerchantCards,
  isCardStale,
  nextLiveIndex,
  splitDuplicateGroup,
  summarizeLog,
} from "../../services/catch-up";
import type { ReviewQueueSnapshot } from "../../services/review-queue-snapshot";

function exp(id: string, over: Partial<Expense> = {}): Expense {
  return {
    id,
    user_id: "u",
    amount: 100,
    merchant_name: "Swiggy",
    category_id: null,
    date: "2026-09-01",
    created_at: "2026-09-01 10:00:00",
    status: "pending_review",
    nature: "realized",
    matched_forecast_id: null,
    ...over,
  } as Expense;
}

function snap(over: Partial<ReviewQueueSnapshot> = {}): ReviewQueueSnapshot {
  return { pending: [], matchedPairs: [], duplicateGroups: [], uncategorized: [], ...over };
}

describe("buildCatchUpDeck", () => {
  it("orders duplicates, matches, pending (oldest first), then uncategorized", () => {
    const dup: DuplicateGroup = { expenses: [exp("d1"), exp("d2")], reason: "same amount" };
    const pair: ForecastMatchPair = {
      forecast: exp("f1", { nature: "forecast" }),
      realized: exp("r1"),
    } as ForecastMatchPair;
    const deck = buildCatchUpDeck(
      snap({
        pending: [exp("p-new", { date: "2026-09-10" }), exp("p-old", { date: "2026-09-02" })],
        matchedPairs: [pair],
        duplicateGroups: [dup],
        uncategorized: [exp("u1", { status: "approved" })],
      }),
    );
    expect(deck.map((c) => c.kind)).toEqual(["duplicate", "match", "pending", "pending", "uncategorized"]);
    expect(deck[2].kind === "pending" && deck[2].expense.id).toBe("p-old");
  });

  it("leaves forecasts (dues) out of the deck", () => {
    const deck = buildCatchUpDeck(
      snap({ pending: [exp("f", { nature: "forecast", due_date: "2026-09-30" }), exp("c", { nature: "credit" })] }),
    );
    expect(deck).toHaveLength(1);
    expect(deck[0].kind === "pending" && deck[0].expense.id).toBe("c");
  });
});

describe("staleness", () => {
  it("skips a pending card whose row a duplicate resolution already rejected", () => {
    const deck = buildCatchUpDeck(
      snap({
        duplicateGroups: [{ expenses: [exp("a"), exp("b")], reason: "" }],
        pending: [exp("a"), exp("b")],
      }),
    );
    const resolved = new Set(["b"]);
    // The duplicate card itself is stale now (only one row left) - so is "b"'s pending card.
    expect(isCardStale(deck[0], resolved)).toBe(true);
    expect(nextLiveIndex(deck, 0, resolved)).toBe(1);
    expect(nextLiveIndex(deck, 2, resolved)).toBe(-1);
  });
});

describe("findSameMerchantCards", () => {
  it("returns later same-merchant, same-direction pending rows, ignoring case and handled rows", () => {
    const deck = buildCatchUpDeck(
      snap({
        pending: [
          exp("1", { date: "2026-09-01" }),
          exp("2", { date: "2026-09-02", merchant_name: "SWIGGY " }),
          exp("3", { date: "2026-09-03", merchant_name: "Zomato" }),
          exp("4", { date: "2026-09-04", nature: "credit" }),
          exp("5", { date: "2026-09-05" }),
        ],
      }),
    );
    const out = findSameMerchantCards(deck, 0, deck[0], new Set(["1", "5"]));
    expect(out.map((e) => e.id)).toEqual(["2"]);
  });

  it("never batches a CC-repayment credit (it needs a source account)", () => {
    const deck = buildCatchUpDeck(
      snap({
        pending: [
          exp("1", { nature: "credit", date: "2026-09-01" }),
          exp("2", { nature: "credit", date: "2026-09-02", matched_forecast_id: "fc" }),
        ],
      }),
    );
    expect(findSameMerchantCards(deck, 0, deck[0], new Set())).toEqual([]);
  });

  it("doesn't batch without a merchant", () => {
    const deck = buildCatchUpDeck(snap({ pending: [exp("1", { merchant_name: null }), exp("2", { merchant_name: null })] }));
    expect(findSameMerchantCards(deck, 0, deck[0], new Set())).toEqual([]);
  });
});

describe("splitDuplicateGroup", () => {
  it("keeps the most recently created row", () => {
    const { keep, reject } = splitDuplicateGroup({
      expenses: [
        exp("old", { created_at: "2026-09-01T10:00:00Z" }),
        exp("new", { created_at: "2026-09-03T10:00:00Z" }),
        exp("mid", { created_at: "2026-09-02T10:00:00Z" }),
      ],
      reason: "",
    });
    expect(keep.id).toBe("new");
    expect(reject.map((e) => e.id)).toEqual(["mid", "old"]);
  });
});

describe("summarizeLog", () => {
  it("counts rows, not actions, and skips as one each", () => {
    const s = summarizeLog([
      { index: 0, outcome: "approved", count: 1, approvedSpend: 250 },
      { index: 1, outcome: "approved", count: 4, approvedSpend: 1000 },
      { index: 2, outcome: "skipped", count: 0, approvedSpend: 0 },
      { index: 3, outcome: "rejected", count: 2, approvedSpend: 0 },
      { index: 4, outcome: "resolved", count: 1, approvedSpend: 0 },
    ]);
    expect(s).toEqual({ approved: 5, rejected: 2, skipped: 1, resolved: 1, approvedSpend: 1250 });
  });
});

describe("DeferredAction", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("commits after the window", async () => {
    const run = jest.fn(async () => {});
    const d = new DeferredAction(6000, jest.fn());
    d.schedule(run);
    expect(run).not.toHaveBeenCalled();
    jest.advanceTimersByTime(6000);
    await Promise.resolve();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("undo (cancel) means the write never happens", async () => {
    const run = jest.fn(async () => {});
    const d = new DeferredAction(6000, jest.fn());
    d.schedule(run);
    expect(d.cancel()).toBe(true);
    jest.advanceTimersByTime(10000);
    await d.flush();
    expect(run).not.toHaveBeenCalled();
    expect(d.cancel()).toBe(false);
  });

  it("scheduling a new action commits the previous one first, in order", async () => {
    const calls: string[] = [];
    const d = new DeferredAction(6000, jest.fn());
    d.schedule(async () => { calls.push("a"); });
    await d.schedule(async () => { calls.push("b"); });
    expect(calls).toEqual(["a"]);
    await d.flush();
    expect(calls).toEqual(["a", "b"]);
  });

  it("reports a failed write instead of throwing", async () => {
    const onError = jest.fn();
    const d = new DeferredAction(6000, onError);
    d.schedule(async () => { throw new Error("boom"); });
    await d.flush();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});
