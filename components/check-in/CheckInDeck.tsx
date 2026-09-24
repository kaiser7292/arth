import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, View } from "react-native";
import { SwipeDeck } from "@/components/expense/catch-up/SwipeDeck";
import { Button, Card, EmptyState, LoadingState, ProgressBar, ScreenContainer, Text, useToast } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { DeferredAction } from "@/services/catch-up";
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
  doneTitle: string;
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
  title,
  context,
  loadItems,
  keyOf,
  renderCard,
  primary,
  secondary = [],
  doneTitle,
  emptyIcon,
  emptyTitle,
  emptySubtitle,
}: CheckInDeckProps<T>) {
  const router = useRouter();
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

  if (loading) {
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
    return (
      <ScreenContainer padTop={false}>
        <EmptyState
          icon={empty ? emptyIcon : "checkmark-done-outline"}
          title={empty ? emptyTitle : doneTitle}
          subtitle={empty ? emptySubtitle : summary || undefined}
          action={
            <View className="w-full px-4 mt-4">
              <Button title="Done" onPress={() => router.back()} />
            </View>
          }
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <DeckProgress position={index + 1} total={items.length} context={context} />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <SwipeDeck
          cardKey={keyOf(item)}
          onSwipeRight={() => void perform(primary)}
          onSwipeLeft={skip}
          rightLabel={primary.label}
          enabled={!busy}
        >
          <Card>
            {renderCard(item)}
            <DeckCardActions
              actions={secondary.map((a) => ({ label: a.label, icon: a.icon, role: a.role, onPress: () => void perform(a) }))}
              disabled={busy}
            />
          </Card>
        </SwipeDeck>
        <Text className="text-xs text-faint-foreground text-center mt-3">
          Swipe right to {primary.label.toLowerCase()} · left to skip
        </Text>
      </ScrollView>
      <DeckFooter
        onSkip={skip}
        primaryLabel={primary.label}
        onPrimary={() => void perform(primary)}
        disabled={busy}
      />
    </ScreenContainer>
  );
}

// ─── Shared pieces (also used by Catch Up) ───

/** "2 of 17" plus a progress bar, under the Stack header. */
export function DeckProgress({ position, total, context }: { position: number; total: number; context?: string }) {
  return (
    <View className="px-4 pt-2 pb-4">
      <View className="flex-row items-center justify-between mb-2">
        {context ? (
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{context}</Text>
        ) : (
          <View />
        )}
        <Text className="text-xs text-muted-foreground">
          {position} of {total}
        </Text>
      </View>
      <ProgressBar value={total > 0 ? position / total : 0} />
    </View>
  );
}

export interface FooterAction {
  label: string;
  icon: IconName;
  role?: Role;
  onPress: () => void;
}

/**
 * Extra actions as full-width rows at the bottom of the card (Settings-row style), so the only
 * buttons below the card are Skip and the main action.
 */
export function DeckCardActions({ actions, disabled }: { actions: FooterAction[]; disabled?: boolean }) {
  const theme = useTheme();
  if (actions.length === 0) return null;
  return (
    <View className="mt-4 -mb-1 border-t border-border">
      {actions.map((a, i) => {
        const color = theme[a.role ?? "primary"];
        return (
          <Pressable
            key={a.label}
            onPress={a.onPress}
            disabled={disabled}
            className={`flex-row items-center py-3 ${i > 0 ? "border-t border-border" : ""}`}
            style={{ minHeight: 48 }}
            accessibilityRole="button"
          >
            <Ionicons name={a.icon} size={20} color={color} />
            <Text className="text-sm font-semibold ml-3 flex-1" style={{ color }}>
              {a.label}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Skip + the main action — always the same place on every deck. */
export function DeckFooter({
  onSkip,
  primaryLabel,
  onPrimary,
  disabled,
}: {
  onSkip: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  disabled?: boolean;
}) {
  return (
    <View className="flex-row gap-3 px-4 pt-3 pb-4 border-t border-border">
      <View className="flex-1">
        <Button title="Skip" variant="secondary" onPress={onSkip} disabled={disabled} />
      </View>
      <View className="flex-1">
        <Button title={primaryLabel} onPress={onPrimary} disabled={disabled} />
      </View>
    </View>
  );
}

/** Centred card heading: small section label, then the title. */
export function DeckHeadline({ kicker, title, subtitle }: { kicker: string; title: string; subtitle?: string }) {
  return (
    <View className="items-center">
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{kicker}</Text>
      <Text className="text-base font-bold text-foreground text-center mt-1.5" numberOfLines={2}>
        {title}
      </Text>
      {subtitle ? <Text className="text-sm text-muted-foreground text-center mt-1">{subtitle}</Text> : null}
    </View>
  );
}

/** Label / value row for card details. */
export function DeckRow({ label, value, valueColor }: { label: string; value: React.ReactNode; valueColor?: string }) {
  return (
    <View className="flex-row justify-between items-center py-2.5 border-b border-border">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      {typeof value === "string" ? (
        <Text className="text-sm font-semibold text-foreground" style={valueColor ? { color: valueColor } : undefined}>
          {value}
        </Text>
      ) : (
        value
      )}
    </View>
  );
}
