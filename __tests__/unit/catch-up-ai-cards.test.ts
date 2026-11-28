/**
 * Catch Up's AI cards (docs/AI_HUB_PROPOSAL.md §3): your assistant's reply first, formats and
 * "Same place?" last, each cleared by its own key. Made-up names only: the repo is public.
 */

import type { Expense } from "../../services/expense";
import { buildCatchUpDeck, countCatchUpItems, isAiCard, isCardStale, mergeSiblingKeys } from "../../services/catch-up";
import type { CatchUpAiItems } from "../../services/catch-up-ai";
import type { MergeOffer } from "../../services/ai/tasks/merchant-merge";
import type { TemplateOffer } from "../../services/ai/tasks/graduate-template";
import type { ReviewQueueSnapshot } from "../../services/review-queue-snapshot";

function exp(id: string): Expense {
  return { id, user_id: "u", amount: 100, merchant_name: "Corner Cafe", category_id: null, date: "2026-09-01", created_at: "2026-09-01 10:00:00", status: "pending_review", nature: "realized", matched_forecast_id: null } as Expense;
}

function snap(over: Partial<ReviewQueueSnapshot> = {}): ReviewQueueSnapshot {
  return { pending: [], matchedPairs: [], duplicateGroups: [], uncategorized: [], ...over };
}

const template = { label: "Sample Bank · card spend", bank: "Sample Bank", address: "XX-SAMPLE", sample: "Rs 120.00 spent on card 0000 at CORNER CAFE" } as TemplateOffer;
const merge = {
  key: "corner cafe|corner cafe ltd",
  keep: { name: "Corner Cafe", txCount: 9 },
  other: { name: "CORNER CAFE LTD", txCount: 2 },
} as MergeOffer;

function ai(over: Partial<CatchUpAiItems> = {}): CatchUpAiItems {
  return { replyWaiting: false, templates: [], merges: [], ...over };
}

describe("Catch Up AI cards", () => {
  it("puts the assistant's reply first and AI offers after every transaction card", () => {
    const deck = buildCatchUpDeck(
      snap({ pending: [exp("p1")], uncategorized: [exp("u1")] }),
      ai({ replyWaiting: true, templates: [{ key: "t1", offer: template }], merges: [merge] }),
    );
    expect(deck.map((c) => c.kind)).toEqual(["ai_reply", "pending", "uncategorized", "ai_template", "ai_merge"]);
    expect(deck.filter(isAiCard)).toHaveLength(3);
  });

  it("makes no AI cards when nothing waits, or when none are passed", () => {
    expect(buildCatchUpDeck(snap({ pending: [exp("p1")] }), ai()).map((c) => c.kind)).toEqual(["pending"]);
    expect(buildCatchUpDeck(snap({ pending: [exp("p1")] })).map((c) => c.kind)).toEqual(["pending"]);
  });

  it("counts AI cards with the deck's other cards", () => {
    expect(countCatchUpItems(snap(), ai({ replyWaiting: true, merges: [merge] }))).toBe(2);
    expect(countCatchUpItems(snap())).toBe(0);
  });

  it("sets aside other Same place? cards that share a name once one pair merges", () => {
    const shop = (name: string, txCount: number) => ({ name, txCount }) as MergeOffer["keep"];
    const pairs = [
      { key: "a|b", keep: shop("Corner Cafe", 9), other: shop("Corner Cafe Ltd", 2) },
      { key: "a|c", keep: shop("Corner Cafe", 9), other: shop("Corner Cafe Express", 1) },
      { key: "b|c", keep: shop("Corner Cafe Ltd", 2), other: shop("Corner Cafe Express", 1) },
      { key: "x|y", keep: shop("Green Grocer", 4), other: shop("Green Grocers", 1) },
    ] as MergeOffer[];
    const deck = buildCatchUpDeck(snap(), ai({ merges: pairs }));
    const first = deck[0];
    if (first.kind !== "ai_merge") throw new Error("expected a merge card");
    expect(mergeSiblingKeys(deck, first)).toEqual(["ai-merge-a|c", "ai-merge-b|c"]);
  });

  it("clears an AI card by its own key, not by transaction ids", () => {
    const [card] = buildCatchUpDeck(snap(), ai({ templates: [{ key: "t1", offer: template }] }));
    expect(card.kind).toBe("ai_template");
    expect(isCardStale(card, new Set(["t1"]))).toBe(false);
    expect(isCardStale(card, new Set([card.key]))).toBe(true);
  });
});
