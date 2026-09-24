import type { DuplicateGroup } from "@/services/duplicate-detection";
import type { Expense, ForecastMatchPair } from "@/services/expense";
import type { ReviewQueueSnapshot } from "@/services/review-queue-snapshot";

/**
 * Catch Up: the review queue as a one-card-at-a-time deck.
 *
 * Pure logic only (deck order, staleness, "same again" batching, deferred commit) so it can be
 * unit-tested without rendering. The screen lives in app/expense/catch-up.tsx.
 */

export type CatchUpCard =
  | { kind: "duplicate"; key: string; group: DuplicateGroup }
  | { kind: "match"; key: string; pair: ForecastMatchPair }
  | { kind: "pending"; key: string; expense: Expense }
  | { kind: "uncategorized"; key: string; expense: Expense };

function oldestFirst(a: Expense, b: Expense): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (a.created_at ?? "") < (b.created_at ?? "") ? -1 : 1;
}

/**
 * Deck order: duplicates first (so both copies aren't approved one by one), then forecast
 * matches, then SMS detections oldest to newest, then uncategorized.
 *
 * Forecasts (overdue / upcoming dues) are left out: acting on them doesn't clear them the way
 * reviewing a transaction does, so they aren't "unread" in the Catch Up sense.
 */
export function buildCatchUpDeck(snapshot: ReviewQueueSnapshot): CatchUpCard[] {
  const deck: CatchUpCard[] = [];
  snapshot.duplicateGroups.forEach((group, i) => {
    deck.push({ kind: "duplicate", key: `dup-${i}-${group.expenses.map((e) => e.id).join(",")}`, group });
  });
  snapshot.matchedPairs.forEach((pair) => {
    deck.push({ kind: "match", key: `match-${pair.realized.id}`, pair });
  });
  snapshot.pending
    .filter((e) => e.nature === "realized" || e.nature === "credit")
    .sort(oldestFirst)
    .forEach((expense) => deck.push({ kind: "pending", key: `pending-${expense.id}`, expense }));
  [...snapshot.uncategorized]
    .sort(oldestFirst)
    .forEach((expense) => deck.push({ kind: "uncategorized", key: `uncat-${expense.id}`, expense }));
  return deck;
}

/** How many cards Catch Up would show, from a snapshot. Cheap enough for an entry-point badge. */
export function countCatchUpItems(snapshot: ReviewQueueSnapshot): number {
  return buildCatchUpDeck(snapshot).length;
}

/**
 * A card is stale once an earlier action on another card already dealt with its rows - e.g.
 * "keep newest" on a duplicate group rejected an SMS item that also has its own pending card, or
 * a "same again" batch approved it.
 */
export function isCardStale(card: CatchUpCard, resolvedIds: ReadonlySet<string>): boolean {
  switch (card.kind) {
    case "pending":
    case "uncategorized":
      return resolvedIds.has(card.expense.id);
    case "match":
      return resolvedIds.has(card.pair.realized.id) || resolvedIds.has(card.pair.forecast.id);
    case "duplicate":
      // Nothing left to compare once fewer than two of the group remain.
      return card.group.expenses.filter((e) => !resolvedIds.has(e.id)).length < 2;
  }
}

/** Index of the first live card at or after `from`, or -1 when the deck is done. */
export function nextLiveIndex(
  deck: readonly CatchUpCard[],
  from: number,
  resolvedIds: ReadonlySet<string>,
): number {
  for (let i = Math.max(0, from); i < deck.length; i++) {
    if (!isCardStale(deck[i], resolvedIds)) return i;
  }
  return -1;
}

export function normalizeMerchantKey(merchant: string | null | undefined): string {
  return (merchant ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** A credit tied to a CC-repayment forecast needs a source account, so it can't be batch-approved. */
export function needsSourceAccount(expense: Expense): boolean {
  return expense.nature === "credit" && expense.matched_forecast_id != null;
}

/**
 * "Same again?" - later live cards of the same kind, same merchant and same direction as the one
 * just handled. Only pending and uncategorized cards batch; matches and duplicates are one-off
 * decisions.
 */
export function findSameMerchantCards(
  deck: readonly CatchUpCard[],
  afterIndex: number,
  source: CatchUpCard,
  resolvedIds: ReadonlySet<string>,
): Expense[] {
  if (source.kind !== "pending" && source.kind !== "uncategorized") return [];
  const key = normalizeMerchantKey(source.expense.merchant_name);
  if (!key) return [];
  const out: Expense[] = [];
  for (let i = afterIndex + 1; i < deck.length; i++) {
    const c = deck[i];
    if (c.kind !== source.kind) continue;
    if (isCardStale(c, resolvedIds)) continue;
    if (c.expense.nature !== source.expense.nature) continue;
    if (needsSourceAccount(c.expense)) continue;
    if (normalizeMerchantKey(c.expense.merchant_name) !== key) continue;
    out.push(c.expense);
  }
  return out;
}

/** Duplicate "keep newest": the most recently created row stays, the rest are rejected. */
export function splitDuplicateGroup(group: DuplicateGroup): { keep: Expense; reject: Expense[] } {
  const sorted = [...group.expenses].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  return { keep: sorted[0], reject: sorted.slice(1) };
}

// ── Session stats ──

export type CatchUpOutcome = "approved" | "rejected" | "skipped" | "resolved";

export interface CatchUpLogEntry {
  /** Deck index of the card the action was taken on. */
  index: number;
  outcome: CatchUpOutcome;
  /** Rows this action handled (0 for a skip). */
  count: number;
  /** Debit amount approved, for the "₹X approved" line. Credits don't add to it. */
  approvedSpend: number;
}

export interface CatchUpStats {
  approved: number;
  rejected: number;
  skipped: number;
  resolved: number;
  approvedSpend: number;
}

export function summarizeLog(log: readonly CatchUpLogEntry[]): CatchUpStats {
  const s: CatchUpStats = { approved: 0, rejected: 0, skipped: 0, resolved: 0, approvedSpend: 0 };
  for (const e of log) {
    if (e.outcome === "skipped") s.skipped += 1;
    else s[e.outcome] += e.count;
    s.approvedSpend += e.approvedSpend;
  }
  return s;
}

// ── Deferred commit (Undo) ──

/**
 * Holds the most recent action for a short window before writing it, so Undo is just "don't
 * write". Approve has side effects (account linking, deferred rule links, FD maturity, refund
 * split adjustments) that have no clean inverse, so undo-by-not-committing is the safe design.
 *
 * Only one action is ever held: scheduling a new one commits the previous one first. If the app
 * is killed inside the window, the held action is simply lost and the item stays in the queue.
 */
export class DeferredAction {
  private held: { run: () => Promise<void>; timer: ReturnType<typeof setTimeout> } | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly delayMs: number,
    private readonly onError: (e: unknown) => void,
  ) {}

  /** Commit whatever is held, then hold `run` for the undo window. */
  schedule(run: () => Promise<void>): Promise<void> {
    const flushed = this.flush();
    const timer = setTimeout(() => {
      void this.flush();
    }, this.delayMs);
    this.held = { run, timer };
    return flushed;
  }

  /** Drop the held action without running it. Returns true if there was one to drop. */
  cancel(): boolean {
    if (!this.held) return false;
    clearTimeout(this.held.timer);
    this.held = null;
    return true;
  }

  /** Run the held action now. Writes are serialized so two commits never interleave. */
  flush(): Promise<void> {
    const held = this.held;
    if (!held) return this.chain;
    clearTimeout(held.timer);
    this.held = null;
    this.chain = this.chain.then(async () => {
      try {
        await held.run();
      } catch (e) {
        this.onError(e);
      }
    });
    return this.chain;
  }

  get hasPending(): boolean {
    return this.held != null;
  }
}
