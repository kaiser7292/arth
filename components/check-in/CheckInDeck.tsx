import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, View } from "react-native";
import { SwipeDeck } from "@/components/expense/catch-up/SwipeDeck";
import { Button, Card, LoadingState, ProgressBar, ScreenContainer, Text, useToast } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { DeferredAction } from "@/services/catch-up";
import { formatError } from "@/utils/error-message";
import { logger } from "@/utils/logger";

type IconName = keyof typeof Ionicons.glyphMap;

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
  role?: "primary" | "danger" | "mutedForeground";
  onPress: (item: T) => DeckResult | null | Promise<DeckResult | null>;
}

interface CheckInDeckProps<T> {
  title: string;
  loadItems: () => Promise<T[]>;
  keyOf: (item: T) => string;
  renderCard: (item: T) => React.ReactNode;
  /** Swipe right / big button. */
  primary: DeckAction<T>;
  secondary?: DeckAction<T>[];
  doneTitle: string;
  emptyTitle: string;
  emptySubtitle?: string;
}

const UNDO_WINDOW_MS = 6000;

/**
 * The Catch Up interaction for any list of items: one card at a time, swipe right for the main
 * action, swipe left to skip, Undo for 6 seconds.
 *
 * Catch Up itself (app/expense/catch-up.tsx) has its own screen because of its mixed card kinds,
 * category suggestions and "same again" batching. The simpler check-ins (rule suggestions,
 * subscriptions, settle-up, month-end) share this one.
 */
export function CheckInDeck<T>({
  title,
  loadItems,
  keyOf,
  renderCard,
  primary,
  secondary = [],
  doneTitle,
  emptyTitle,
  emptySubtitle,
}: CheckInDeckProps<T>) {
  const router = useRouter();
  const theme = useTheme();
  const toast = useToast();

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

  const header = (
    <View className="flex-row items-center px-4 py-3">
      <Pressable onPress={() => router.back()} className="p-2 -ml-2" accessibilityLabel={`Close ${title}`}>
        <Ionicons name="close" size={24} color={theme.mutedForeground} />
      </Pressable>
      <Text className="text-lg font-bold text-foreground ml-1 flex-1">{title}</Text>
      {item && (
        <Text className="text-sm text-muted-foreground">
          {index + 1} of {items.length}
        </Text>
      )}
    </View>
  );

  if (loading) {
    return (
      <ScreenContainer>
        <LoadingState message="Loading…" icon="albums-outline" />
      </ScreenContainer>
    );
  }

  if (!item) {
    const counts = new Map<string, number>();
    log.forEach((o) => counts.set(o, (counts.get(o) ?? 0) + 1));
    const summary = [...counts.entries()].map(([o, n]) => `${o} ${n}`).join(" · ");
    const empty = items.length === 0;
    return (
      <ScreenContainer>
        {header}
        <View className="flex-1 items-center justify-center px-8">
          <View
            className="w-20 h-20 rounded-full items-center justify-center mb-5"
            style={{ backgroundColor: theme.alpha("success", 0.12) }}
          >
            <Ionicons name="checkmark-done" size={40} color={theme.success} />
          </View>
          <Text className="text-xl font-bold text-foreground text-center">{empty ? emptyTitle : doneTitle}</Text>
          {empty && emptySubtitle ? (
            <Text className="text-sm text-muted-foreground text-center mt-2">{emptySubtitle}</Text>
          ) : null}
          {!empty && summary ? (
            <Text className="text-sm text-muted-foreground text-center mt-2">{summary}</Text>
          ) : null}
          <View className="w-full mt-8">
            <Button title="Done" onPress={() => router.back()} />
          </View>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      {header}
      <View className="px-4 pb-3">
        <ProgressBar value={items.length > 0 ? index / items.length : 0} />
      </View>

      <SwipeDeck
        cardKey={keyOf(item)}
        onSwipeRight={() => void perform(primary)}
        onSwipeLeft={skip}
        rightLabel={primary.label}
        enabled={!busy}
      >
        <Card className="flex-1 mx-4 py-5">{renderCard(item)}</Card>
      </SwipeDeck>

      {secondary.length > 0 && (
        <View className="flex-row flex-wrap justify-center px-4 pt-3 gap-2">
          {secondary.map((a) => (
            <DeckSecondaryButton key={a.label} action={a} onPress={() => void perform(a)} />
          ))}
        </View>
      )}

      <View className="flex-row px-4 pt-3 pb-4 gap-3">
        <Pressable
          onPress={skip}
          className="flex-1 flex-row items-center justify-center py-3.5 rounded-xl border border-border"
          accessibilityLabel="Skip"
        >
          <Ionicons name="arrow-back" size={18} color={theme.mutedForeground} />
          <Text className="text-base font-semibold text-muted-foreground ml-1.5">Skip</Text>
        </Pressable>
        <Pressable
          onPress={() => void perform(primary)}
          className="flex-1 flex-row items-center justify-center py-3.5 rounded-xl"
          style={{ backgroundColor: theme.primary }}
          accessibilityLabel={primary.label}
        >
          <Text className="text-base font-semibold mr-1.5" style={{ color: theme.primaryForeground }}>
            {primary.label}
          </Text>
          <Ionicons name="arrow-forward" size={18} color={theme.primaryForeground} />
        </Pressable>
      </View>
    </ScreenContainer>
  );
}

function DeckSecondaryButton<T>({ action, onPress }: { action: DeckAction<T>; onPress: () => void }) {
  const theme = useTheme();
  const role = action.role ?? "primary";
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-4 py-2 rounded-full"
      style={{ backgroundColor: theme.alpha(role, 0.1) }}
      accessibilityRole="button"
    >
      <Ionicons name={action.icon} size={16} color={theme[role]} />
      <Text className="text-sm font-semibold ml-1.5" style={{ color: theme[role] }}>
        {action.label}
      </Text>
    </Pressable>
  );
}

/** Big centred headline used by most check-in cards. */
export function DeckHeadline({ kicker, title, subtitle }: { kicker: string; title: string; subtitle?: string }) {
  return (
    <View className="items-center mb-4">
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{kicker}</Text>
      <Text className="text-2xl font-bold text-foreground text-center mt-2" numberOfLines={2}>
        {title}
      </Text>
      {subtitle ? <Text className="text-sm text-muted-foreground text-center mt-1">{subtitle}</Text> : null}
    </View>
  );
}

/** Label / value row for card details. */
export function DeckRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View className="flex-row justify-between py-2 border-b border-border">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="text-sm font-semibold text-foreground" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </Text>
    </View>
  );
}
