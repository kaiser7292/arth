import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Pressable, View } from "react-native";
import { AccountPickerSheet } from "@/components/expense/AccountPickerSheet";
import { CatchUpCardView } from "@/components/expense/catch-up/CatchUpCardView";
import { CatchUpDone } from "@/components/expense/catch-up/CatchUpDone";
import { CategoryPickerSheet } from "@/components/expense/catch-up/CategoryPickerSheet";
import { SwipeDeck } from "@/components/expense/catch-up/SwipeDeck";
import { LoadingState, ProgressBar, ScreenContainer, Text, useToast } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import type { Category } from "@/services/category";
import { getCategories } from "@/services/category";
import type { CatchUpCard, CatchUpLogEntry, CatchUpOutcome } from "@/services/catch-up";
import {
  DeferredAction,
  buildCatchUpDeck,
  findSameMerchantCards,
  needsSourceAccount,
  nextLiveIndex,
  splitDuplicateGroup,
  summarizeLog,
} from "@/services/catch-up";
import { approveBatchWithCategory, approveWithCategory, assignCategory } from "@/services/catch-up-actions";
import { dismissDuplicateGroup } from "@/services/duplicate-detection";
import type { Expense } from "@/services/expense";
import {
  approveCcRepaymentCredit,
  getExpenseById,
  rejectExpense,
  rejectExpenses,
  resolveMatchAlreadyCaptured,
  resolveMatchBothDifferent,
  resolveMatchRealize,
} from "@/services/expense";
import type { FinancialAccount } from "@/services/financial-account";
import { getActiveAccounts } from "@/services/financial-account";
import { getReviewQueueSnapshot } from "@/services/review-queue-snapshot";
import { categorizeByMerchant } from "@/services/smart-categorizer";
import { reconcilePresentedAlerts } from "@/services/transaction-alerts";
import { formatError } from "@/utils/error-message";
import { formatAmount } from "@/utils/format";
import { logger } from "@/utils/logger";

/** Matches the Toast's default duration when it carries an action, so Undo never outlives the hold. */
const UNDO_WINDOW_MS = 6000;

interface BatchOffer {
  kind: "pending" | "uncategorized";
  expenses: Expense[];
  categoryId: string | null;
  merchant: string;
}

interface UndoPoint {
  index: number;
  resolvedAdded: string[];
  logLength: number;
}

/**
 * Catch Up — the review queue one card at a time.
 *
 * Swipe right = the card's main action (approve / same payment / keep newest / categorize),
 * swipe left = skip (stays in the queue). Every action is held for UNDO_WINDOW_MS before it is
 * written (see DeferredAction), so Undo is exact rather than a best-effort reversal.
 *
 * The deck is built once on open. Actions don't reload it; instead `resolved` tracks rows that
 * earlier actions already dealt with, and cards whose rows are all resolved are skipped over.
 */
export default function CatchUpScreen() {
  const router = useRouter();
  const theme = useTheme();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [deck, setDeck] = useState<CatchUpCard[]>([]);
  const [index, setIndex] = useState(0);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<CatchUpLogEntry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);

  // Category per expense: what the smart categorizer suggests, and what the user picked on the card.
  const [suggestions, setSuggestions] = useState<Record<string, string | null>>({});
  const [picked, setPicked] = useState<Record<string, string>>({});

  const [picker, setPicker] = useState<{ commit: boolean } | null>(null);
  const [ccPickerOpen, setCcPickerOpen] = useState(false);
  const [batchOffer, setBatchOffer] = useState<BatchOffer | null>(null);

  const deferred = useRef(
    new DeferredAction(UNDO_WINDOW_MS, (e) => {
      logger.error("Catch up: commit failed", e);
      toast("Couldn't save that change: " + formatError("Save", e), { tone: "danger" });
    }),
  ).current;
  const undoPoint = useRef<UndoPoint | null>(null);
  const logRef = useRef<CatchUpLogEntry[]>([]);
  logRef.current = log;
  const deckRef = useRef<CatchUpCard[]>([]);
  deckRef.current = deck;
  const editingId = useRef<string | null>(null);

  // ── Load once ──
  useEffect(() => {
    (async () => {
      try {
        const [snapshot, cats, accts] = await Promise.all([
          getReviewQueueSnapshot(DEFAULT_USER_ID),
          getCategories(DEFAULT_USER_ID),
          getActiveAccounts(DEFAULT_USER_ID),
        ]);
        setDeck(buildCatchUpDeck(snapshot));
        setCategories(cats);
        setAccounts(accts);
      } catch (e) {
        logger.error("Catch up: load failed", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Anything still held gets written when the screen goes away or the app is backgrounded.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") void deferred.flush();
    });
    return () => {
      sub.remove();
      // Commit, then take down notification alerts for anything just reviewed here.
      void deferred.flush().then(() => reconcilePresentedAlerts()).catch(() => {});
    };
  }, [deferred]);

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const currentIdx = nextLiveIndex(deck, index, resolved);
  const card = currentIdx >= 0 ? deck[currentIdx] : null;
  const cardExpense = card && (card.kind === "pending" || card.kind === "uncategorized") ? card.expense : null;

  // Fetch a suggestion for the card on screen (the SMS pipeline may already have set one).
  useEffect(() => {
    if (!cardExpense || cardExpense.id in suggestions) return;
    const id = cardExpense.id;
    if (cardExpense.category_id) {
      setSuggestions((s) => ({ ...s, [id]: cardExpense.category_id }));
      return;
    }
    categorizeByMerchant(DEFAULT_USER_ID, cardExpense.merchant_name)
      .then((r) => setSuggestions((s) => ({ ...s, [id]: r.categoryId })))
      .catch(() => setSuggestions((s) => ({ ...s, [id]: null })));
  }, [cardExpense, suggestions]);

  const categoryFor = useCallback(
    (e: Expense): string | null => picked[e.id] ?? suggestions[e.id] ?? e.category_id ?? null,
    [picked, suggestions],
  );

  // Back from the edit screen: the row may have been approved, deleted or re-categorized there.
  useFocusEffect(
    useCallback(() => {
      const id = editingId.current;
      if (!id) return;
      editingId.current = null;
      getExpenseById(id)
        .then((fresh) => {
          const target = deckRef.current.find(
            (c) => (c.kind === "pending" || c.kind === "uncategorized") && c.expense.id === id,
          );
          if (!target) return;
          const handled =
            !fresh ||
            fresh.deleted_at != null ||
            (target.kind === "pending" && fresh.status !== "pending_review") ||
            (target.kind === "uncategorized" && fresh.category_id != null);
          if (handled) {
            setResolved((r) => new Set(r).add(id));
          } else {
            setDeck((prev) => prev.map((c) => (c === target ? ({ ...c, expense: fresh } as CatchUpCard) : c)));
          }
          setPicked((p) => {
            const { [id]: _, ...rest } = p;
            return rest;
          });
          setSuggestions((s) => {
            const { [id]: _, ...rest } = s;
            return rest;
          });
        })
        .catch(() => {});
    }, []),
  );

  // ── Action plumbing ──

  const undo = useCallback(() => {
    const point = undoPoint.current;
    undoPoint.current = null;
    if (!point || !deferred.cancel()) {
      toast("Already saved - edit it from Transactions to change it.");
      return;
    }
    setIndex(point.index);
    setResolved((r) => {
      const next = new Set(r);
      point.resolvedAdded.forEach((id) => next.delete(id));
      return next;
    });
    setLog(logRef.current.slice(0, point.logLength));
    setBatchOffer(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [deferred, toast]);

  const act = useCallback(
    (opts: {
      run: () => Promise<void>;
      outcome: CatchUpOutcome;
      count: number;
      approvedSpend?: number;
      resolvedIds: string[];
      message: string;
      /** Move to the next card. False for a "same again" batch, which acts on cards ahead. */
      advance?: boolean;
    }) => {
      const at = currentIdx;
      undoPoint.current = { index: at, resolvedAdded: opts.resolvedIds, logLength: logRef.current.length };
      setLog((l) => [...l, { index: at, outcome: opts.outcome, count: opts.count, approvedSpend: opts.approvedSpend ?? 0 }]);
      setResolved((r) => {
        const next = new Set(r);
        opts.resolvedIds.forEach((id) => next.add(id));
        return next;
      });
      if (opts.advance !== false) setIndex(at + 1);
      void deferred.schedule(opts.run);
      Haptics.notificationAsync(
        opts.outcome === "rejected" ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      toast(opts.message, {
        tone: opts.outcome === "rejected" ? "danger" : "success",
        actionLabel: "Undo",
        onAction: undo,
        duration: UNDO_WINDOW_MS,
      });
    },
    [currentIdx, deferred, toast, undo],
  );

  const offerSameAgain = useCallback(
    (source: CatchUpCard, categoryId: string | null, alsoResolved: string[]) => {
      if (source.kind !== "pending" && source.kind !== "uncategorized") return;
      const after = new Set(resolved);
      alsoResolved.forEach((id) => after.add(id));
      const more = findSameMerchantCards(deck, currentIdx, source, after);
      // Uncategorized batches need a category to apply; pending ones can approve as-is.
      if (more.length === 0 || (source.kind === "uncategorized" && !categoryId)) {
        setBatchOffer(null);
        return;
      }
      setBatchOffer({
        kind: source.kind,
        expenses: more,
        categoryId,
        merchant: source.expense.merchant_name ?? "this merchant",
      });
    },
    [deck, currentIdx, resolved],
  );

  // ── Card actions ──

  const primary = useCallback(
    (overrideCategory?: string) => {
      if (!card) return;
      setBatchOffer(null);
      switch (card.kind) {
        case "pending": {
          const e = card.expense;
          if (needsSourceAccount(e)) {
            setCcPickerOpen(true);
            return;
          }
          const categoryId = overrideCategory ?? (e.nature === "credit" ? e.category_id : categoryFor(e));
          const taught = overrideCategory != null || picked[e.id] != null;
          act({
            run: () => approveWithCategory(e, categoryId, taught),
            outcome: "approved",
            count: 1,
            approvedSpend: e.nature === "realized" ? e.amount : 0,
            resolvedIds: [e.id],
            message: `Approved ${e.merchant_name ?? "transaction"}`,
          });
          offerSameAgain(card, categoryId, [e.id]);
          return;
        }
        case "uncategorized": {
          const e = card.expense;
          const categoryId = overrideCategory ?? categoryFor(e);
          if (!categoryId) {
            setPicker({ commit: true });
            return;
          }
          const taught = overrideCategory != null || picked[e.id] != null;
          act({
            run: () => assignCategory([e], categoryId, taught),
            outcome: "resolved",
            count: 1,
            resolvedIds: [e.id],
            message: `Filed under ${categoryMap.get(categoryId)?.name ?? "category"}`,
          });
          offerSameAgain(card, categoryId, [e.id]);
          return;
        }
        case "match": {
          const { forecast, realized } = card.pair;
          act({
            run: () => resolveMatchRealize(forecast.id, realized.id, realized.date),
            outcome: "resolved",
            count: 1,
            resolvedIds: [forecast.id, realized.id],
            message: "Marked the forecast as paid",
          });
          return;
        }
        case "duplicate": {
          const { reject } = splitDuplicateGroup(card.group);
          const ids = reject.map((x) => x.id);
          act({
            run: () => rejectExpenses(ids),
            outcome: "rejected",
            count: ids.length,
            resolvedIds: ids,
            message: `Kept the newest, rejected ${ids.length}`,
          });
          return;
        }
      }
    },
    [card, act, categoryFor, picked, categoryMap, offerSameAgain],
  );

  const skip = useCallback(() => {
    if (currentIdx < 0) return;
    setBatchOffer(null);
    setLog((l) => [...l, { index: currentIdx, outcome: "skipped", count: 0, approvedSpend: 0 }]);
    setIndex(currentIdx + 1);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [currentIdx]);

  const reject = useCallback(() => {
    if (!card || card.kind !== "pending") return;
    const e = card.expense;
    setBatchOffer(null);
    act({
      run: () => rejectExpense(e.id),
      outcome: "rejected",
      count: 1,
      resolvedIds: [e.id],
      message: `Rejected ${e.merchant_name ?? "transaction"}`,
    });
  }, [card, act]);

  const matchAlreadyCaptured = useCallback(() => {
    if (!card || card.kind !== "match") return;
    const { forecast, realized } = card.pair;
    act({
      run: () => resolveMatchAlreadyCaptured(forecast.id, realized.id),
      outcome: "resolved",
      count: 1,
      resolvedIds: [forecast.id, realized.id],
      message: "Kept the SMS, dropped the forecast",
    });
  }, [card, act]);

  const matchBothDifferent = useCallback(() => {
    if (!card || card.kind !== "match") return;
    const { forecast, realized } = card.pair;
    act({
      run: () => resolveMatchBothDifferent(forecast.id, realized.id),
      outcome: "resolved",
      count: 1,
      resolvedIds: [forecast.id, realized.id],
      message: "Kept both as separate payments",
    });
  }, [card, act]);

  const notDuplicates = useCallback(() => {
    if (!card || card.kind !== "duplicate") return;
    const group = card.group;
    act({
      run: async () => dismissDuplicateGroup(group.expenses),
      outcome: "resolved",
      count: 1,
      resolvedIds: [],
      message: "Marked as not duplicates",
    });
  }, [card, act]);

  const acceptBatch = useCallback(() => {
    const offer = batchOffer;
    if (!offer) return;
    setBatchOffer(null);
    const n = offer.expenses.length;
    const ids = offer.expenses.map((e) => e.id);
    if (offer.kind === "pending") {
      act({
        run: () => approveBatchWithCategory(offer.expenses, offer.categoryId),
        outcome: "approved",
        count: n,
        approvedSpend: offer.expenses.filter((e) => e.nature === "realized").reduce((s, e) => s + e.amount, 0),
        resolvedIds: ids,
        message: `Approved ${n} more from ${offer.merchant}`,
        advance: false,
      });
    } else if (offer.categoryId) {
      const categoryId = offer.categoryId;
      act({
        run: () => assignCategory(offer.expenses, categoryId, false),
        outcome: "resolved",
        count: n,
        resolvedIds: ids,
        message: `Filed ${n} more from ${offer.merchant}`,
        advance: false,
      });
    }
  }, [batchOffer, act]);

  const openCard = useCallback(
    async (id: string) => {
      // The edit screen must see the committed state, not what's held for Undo.
      await deferred.flush();
      undoPoint.current = null;
      editingId.current = id;
      router.push(`/expense/${id}`);
    },
    [deferred, router],
  );

  const onPickCategory = useCallback(
    (categoryId: string) => {
      const commit = picker?.commit ?? false;
      setPicker(null);
      if (!cardExpense) return;
      setPicked((p) => ({ ...p, [cardExpense.id]: categoryId }));
      if (commit) primary(categoryId);
    },
    [picker, cardExpense, primary],
  );

  const onCcAccountSelected = useCallback(
    (fromAccountId: string) => {
      setCcPickerOpen(false);
      if (!card || card.kind !== "pending") return;
      const e = card.expense;
      act({
        run: () => approveCcRepaymentCredit(e.id, fromAccountId),
        outcome: "approved",
        count: 1,
        resolvedIds: [e.id],
        message: "Card repayment recorded",
      });
    },
    [card, act],
  );

  // ── Render ──

  const stats = summarizeLog(log);

  if (loading) {
    return (
      <ScreenContainer>
        <LoadingState message="Getting your queue ready…" icon="albums-outline" />
      </ScreenContainer>
    );
  }

  const header = (
    <View className="flex-row items-center px-4 py-3">
      <Pressable onPress={() => router.back()} className="p-2 -ml-2" accessibilityLabel="Close catch up">
        <Ionicons name="close" size={24} color={theme.mutedForeground} />
      </Pressable>
      <Text className="text-lg font-bold text-foreground ml-1 flex-1">Catch up</Text>
      {card && (
        <Text className="text-sm text-muted-foreground">
          {currentIdx + 1} of {deck.length}
        </Text>
      )}
    </View>
  );

  if (!card) {
    return (
      <ScreenContainer>
        {header}
        <CatchUpDone
          stats={stats}
          onViewSpending={() => router.replace("/(tabs)/budget")}
          onClose={() => router.back()}
        />
      </ScreenContainer>
    );
  }

  const needsInput =
    (card.kind === "pending" && needsSourceAccount(card.expense)) ||
    (card.kind === "uncategorized" && !categoryFor(card.expense));
  const primaryLabel =
    card.kind === "pending"
      ? "Approve"
      : card.kind === "uncategorized"
        ? needsInput ? "Pick category" : "Save"
        : card.kind === "match"
          ? "Same payment"
          : "Keep newest";

  return (
    <ScreenContainer>
      {header}
      <View className="px-4 pb-3">
        <ProgressBar value={deck.length > 0 ? currentIdx / deck.length : 0} />
      </View>

      {batchOffer && (
        <View
          className="mx-4 mb-3 px-4 py-3 rounded-xl flex-row items-center"
          style={{ backgroundColor: theme.alpha("primary", 0.1) }}
        >
          <Text className="text-sm text-foreground flex-1 mr-2">
            {batchOffer.kind === "pending" ? "Approve" : "File"} {batchOffer.expenses.length} more from{" "}
            <Text className="font-semibold">{batchOffer.merchant}</Text>
            {batchOffer.categoryId && categoryMap.get(batchOffer.categoryId)
              ? ` as ${categoryMap.get(batchOffer.categoryId)!.name}`
              : ""}
            {batchOffer.kind === "pending"
              ? ` (${formatAmount(batchOffer.expenses.reduce((s, e) => s + e.amount, 0))})`
              : ""}
            ?
          </Text>
          <Pressable onPress={() => setBatchOffer(null)} className="px-2 py-1.5 mr-1" accessibilityLabel="One by one instead">
            <Text className="text-sm font-semibold text-muted-foreground">No</Text>
          </Pressable>
          <Pressable
            onPress={acceptBatch}
            className="px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: theme.primary }}
          >
            <Text className="text-sm font-semibold" style={{ color: theme.primaryForeground }}>
              Yes, all
            </Text>
          </Pressable>
        </View>
      )}

      <SwipeDeck
        cardKey={card.key}
        onSwipeRight={() => primary()}
        onSwipeLeft={skip}
        rightNeedsInput={needsInput}
        rightLabel={primaryLabel}
        enabled={!picker && !ccPickerOpen}
      >
        <CatchUpCardView
          card={card}
          categoryMap={categoryMap}
          accountMap={accountMap}
          categoryId={cardExpense ? categoryFor(cardExpense) : null}
          onPickCategory={() => setPicker({ commit: false })}
          onOpen={openCard}
        />
      </SwipeDeck>

      {/* Secondary actions for cards that have a third choice */}
      {(card.kind === "pending" || card.kind === "match" || card.kind === "duplicate") && (
        <View className="flex-row justify-center px-4 pt-3 gap-2">
          {card.kind === "pending" && (
            <SecondaryButton label="Reject" icon="close" role="danger" onPress={reject} />
          )}
          {card.kind === "match" && (
            <>
              <SecondaryButton label="Already captured" icon="duplicate-outline" role="primary" onPress={matchAlreadyCaptured} />
              <SecondaryButton label="Different payments" icon="git-branch-outline" role="mutedForeground" onPress={matchBothDifferent} />
            </>
          )}
          {card.kind === "duplicate" && (
            <SecondaryButton label="Not duplicates" icon="checkmark-done-outline" role="primary" onPress={notDuplicates} />
          )}
        </View>
      )}

      <View className="flex-row px-4 pt-3 pb-4 gap-3">
        <Pressable
          onPress={skip}
          className="flex-1 flex-row items-center justify-center py-3.5 rounded-xl border border-border"
          accessibilityLabel="Skip, keep in queue"
        >
          <Ionicons name="arrow-back" size={18} color={theme.mutedForeground} />
          <Text className="text-base font-semibold text-muted-foreground ml-1.5">Skip</Text>
        </Pressable>
        <Pressable
          onPress={() => primary()}
          className="flex-1 flex-row items-center justify-center py-3.5 rounded-xl"
          style={{ backgroundColor: theme.primary }}
          accessibilityLabel={primaryLabel}
        >
          <Text className="text-base font-semibold mr-1.5" style={{ color: theme.primaryForeground }}>
            {primaryLabel}
          </Text>
          <Ionicons name="arrow-forward" size={18} color={theme.primaryForeground} />
        </Pressable>
      </View>

      <CategoryPickerSheet
        visible={picker != null}
        categories={categories}
        selectedId={cardExpense ? categoryFor(cardExpense) : null}
        onSelect={onPickCategory}
        onClose={() => setPicker(null)}
      />
      <AccountPickerSheet
        visible={ccPickerOpen}
        title="Paid from which account?"
        onSelect={onCcAccountSelected}
        onClose={() => setCcPickerOpen(false)}
      />
    </ScreenContainer>
  );
}

function SecondaryButton({
  label,
  icon,
  role,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  role: "primary" | "danger" | "mutedForeground";
  onPress: () => void;
}) {
  const theme = useTheme();
  const color = theme[role];
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-4 py-2 rounded-full"
      style={{ backgroundColor: theme.alpha(role, 0.1) }}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={16} color={color} />
      <Text className="text-sm font-semibold ml-1.5" style={{ color }}>
        {label}
      </Text>
    </Pressable>
  );
}
