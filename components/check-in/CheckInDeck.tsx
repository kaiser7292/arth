import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { CHECK_IN_ROUTES } from "@/components/check-in/check-in-routes";
import { SwipeDeck } from "@/components/expense/catch-up/SwipeDeck";
import { Button, EmptyState, LoadingState, ScreenContainer, useToast } from "@/components/ui";
import { DeckCard, DeckFooter, DeckProgress } from "./DeckParts";
import { DEFAULT_USER_ID } from "@/constants/app";
import { DeferredAction } from "@/services/catch-up";
import type { CheckInId } from "@/services/check-ins";
import { getCheckInCounts, pickNextCheckIn, skippedEverything, snoozeCheckIn } from "@/services/check-ins";
import { formatError } from "@/utils/error-message";
import { logger } from "@/utils/logger";

type IconName = keyof typeof Ionicons.glyphMap;
type Role = "primary" | "danger" | "mutedForeground";

/** What a card action does. Returned by an action's onPress; null means "nothing to commit". */
export interface DeckResult {
  /** The write. Held for the undo window unless `undoable` is false. */
  run: () => Promise<void>;
  message: string;
  /** Word used in the end-of-deck summary, e.g. "Kept", "Settled". */
  outcome: string;
  tone?: "success" | "danger" | "neutral";
  /** False for actions that can't be taken back (opening a share sheet). Runs immediately. */
  undoable?: boolean;
}

export interface DeckAction<T> {
  label: string;
  icon: IconName;
  role?: Role;
  onPress: (item: T) => DeckResult | null | Promise<DeckResult | null>;
}

interface CheckInDeckProps<T> {
  /** Which check-in this is; used to move on to the next one when the deck is finished. */
  id: CheckInId;
  /** For logs; the screen title comes from the Stack header. */
  title: string;
  /** Optional context shown above the progress bar, e.g. the month being checked. */
  context?: string;
  loadItems: () => Promise<T[]>;
  keyOf: (item: T) => string;
  renderCard: (item: T) => React.ReactNode;
  /** Swipe right / main button. */
  primary: DeckAction<T>;
  secondary?: DeckAction<T>[];
  emptyIcon: IconName;
  emptyTitle: string;
  emptySubtitle?: string;
}

const UNDO_WINDOW_MS = 6000;

/**
 * The Catch Up interaction for any list of items: one card at a time, swipe right for the main
 * action, swipe left to skip, Undo for 6 seconds.
 *
 * Catch Up itself (app/expense/catch-up.tsx) has its own screen because of its mixed card kinds,
 * category suggestions and "same again" batching, but shares DeckProgress / DeckFooter below.
 */
export function CheckInDeck<T>({
  id,
  title,
  context,
  loadItems,
  keyOf,
  renderCard,
  primary,
  secondary = [],
  emptyIcon,
  emptyTitle,
  emptySubtitle,
}: CheckInDeckProps<T>) {
  const router = useRouter();
  const toast = useToast();
  const { visited: visitedParam } = useLocalSearchParams<{ visited?: string }>();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<T[]>([]);
  const [index, setIndex] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const deferred = useRef(
    new DeferredAction(UNDO_WINDOW_MS, (e) => {
      logger.error(`${title}: commit failed`, e);
      toast("Couldn't save that change: " + formatError("Save", e), { tone: "danger" });
    }),
  ).current;
  const undoPoint = useRef<{ index: number; logLength: number } | null>(null);
  const logRef = useRef<string[]>([]);
  logRef.current = log;

  useEffect(() => {
    loadItems()
      .then(setItems)
      .catch((e) => logger.error(`${title}: load failed`, e))
      .finally(() => setLoading(false));
    // loadItems is expected to be stable for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") void deferred.flush();
    });
    return () => {
      sub.remove();
      void deferred.flush();
    };
  }, [deferred]);

  const item = index < items.length ? items[index] : null;

  const undo = useCallback(() => {
    const point = undoPoint.current;
    undoPoint.current = null;
    if (!point || !deferred.cancel()) {
      toast("Already saved.");
      return;
    }
    setIndex(point.index);
    setLog(logRef.current.slice(0, point.logLength));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [deferred, toast]);

  const perform = useCallback(
    async (action: DeckAction<T>) => {
      if (!item || busy) return;
      setBusy(true);
      try {
        const result = await action.onPress(item);
        if (!result) return;
        const at = index;
        setLog((l) => [...l, result.outcome]);
        setIndex(at + 1);
        Haptics.notificationAsync(
          result.tone === "danger" ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});
        if (result.undoable === false) {
          await deferred.flush();
          undoPoint.current = null;
          await result.run().catch((e) => {
            logger.error(`${title}: action failed`, e);
            toast(formatError(action.label, e), { tone: "danger" });
          });
          toast(result.message, { tone: result.tone ?? "success" });
        } else {
          undoPoint.current = { index: at, logLength: logRef.current.length };
          void deferred.schedule(result.run);
          toast(result.message, {
            tone: result.tone ?? "success",
            actionLabel: "Undo",
            onAction: undo,
            duration: UNDO_WINDOW_MS,
          });
        }
      } finally {
        setBusy(false);
      }
    },
    [item, busy, index, deferred, toast, undo, title],
  );

  const skip = useCallback(() => {
    if (!item) return;
    setLog((l) => [...l, "Skipped"]);
    setIndex((i) => i + 1);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [item]);

  // Finished the last card: go straight to the next check-in that has something in it.
  const finished = !loading && items.length > 0 && index >= items.length;
  const [advancing, setAdvancing] = useState(false);
  useEffect(() => {
    if (!finished) return;
    let cancelled = false;
    setAdvancing(true);
    (async () => {
      // Commit the last action first, so the counts below reflect it.
      await deferred.flush();
      undoPoint.current = null;
      const snoozed = skippedEverything(logRef.current);
      if (snoozed) snoozeCheckIn(id);
      const doneMsg = snoozed
        ? `Skipped everything, so ${CHECK_IN_ROUTES[id].title} is hidden for a week.`
        : `${CHECK_IN_ROUTES[id].title} done.`;
      const visited = [...(visitedParam ? visitedParam.split(",") : []), id];
      const next = pickNextCheckIn(await getCheckInCounts(DEFAULT_USER_ID), id, visited);
      if (cancelled) return;
      if (next) {
        toast(`${doneMsg} Next: ${CHECK_IN_ROUTES[next].title}`);
        router.replace({ pathname: CHECK_IN_ROUTES[next].href as never, params: { visited: visited.join(",") } });
      } else {
        if (snoozed) toast(doneMsg);
        setAdvancing(false);
      }
    })().catch(() => setAdvancing(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  if (loading || advancing) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Loading…" icon="albums-outline" />
      </ScreenContainer>
    );
  }

  if (!item) {
    const empty = items.length === 0;
    const counts = new Map<string, number>();
    log.forEach((o) => counts.set(o, (counts.get(o) ?? 0) + 1));
    const summary = [...counts.entries()].map(([o, n]) => `${o} ${n}`).join(" · ");
    // Reaching here with a finished deck means there was no next check-in to move on to:
    // everything is done, so end on the one shared "all caught up" state.
    return (
      <ScreenContainer padTop={false}>
        <EmptyState
          icon={empty ? emptyIcon : "checkmark-done-circle-outline"}
          title={empty ? emptyTitle : "You're all caught up"}
          subtitle={
            empty
              ? emptySubtitle
              : [summary, "Every check-in is done for now."].filter(Boolean).join(" · ")
          }
          action={
            <View className="w-full px-4 mt-4">
              <Button title="Back to Home" onPress={() => router.dismissTo("/(tabs)")} />
            </View>
          }
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <DeckProgress position={index + 1} total={items.length} context={context} />
      <View className="flex-1 px-4">
        <SwipeDeck
          cardKey={keyOf(item)}
          onSwipeRight={() => void perform(primary)}
          onSwipeLeft={skip}
          rightLabel={primary.label}
          enabled={!busy}
          fill
        >
          <DeckCard
            actions={secondary.map((a) => ({ label: a.label, icon: a.icon, role: a.role, onPress: () => void perform(a) }))}
            disabled={busy}
          >
            {renderCard(item)}
          </DeckCard>
        </SwipeDeck>
      </View>
      <DeckFooter
        hint={`Swipe right to ${primary.label.toLowerCase()} · left to skip`}
        onSkip={skip}
        primaryLabel={primary.label}
        onPrimary={() => void perform(primary)}
        disabled={busy}
      />
    </ScreenContainer>
  );
}

export { DeckCard, DeckCardActions, DeckFooter, DeckHeadline, DeckProgress, DeckRow } from "./DeckParts";
export type { FooterAction } from "./DeckParts";
