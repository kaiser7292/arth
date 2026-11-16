import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { MoneyChip, Text } from "@/components/ui";
import { RADIUS } from "@/constants/design-tokens";
import { useTheme } from "@/hooks/use-theme";
import { formatMonthLabel } from "@/utils/date";
import type { MonthSummary } from "@/utils/month-drawers";

/** Which totals a month's header shows: in and out on All, one figure on the other tabs. */
export type DrawerMode = "all" | "spend" | "credit" | "transfer";

const CARD_MX = 16;
/** The card corner, as a number for the style objects that split it top and bottom. */
const R = parseInt(RADIUS.card, 10);

/** The rotating arrow on a month's header. */
function Chevron({ open, color }: { open: boolean; color: string }) {
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.value = withTiming(open ? 1 : 0, { duration: 260 });
  }, [open, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 180}deg` }] }));
  return (
    <Animated.View style={style}>
      <Ionicons name="chevron-down" size={18} color={color} />
    </Animated.View>
  );
}

/**
 * A drawer's header: a title, a line under it, whatever chips the list wants on the right, and an
 * arrow that turns when it opens. Open, it's the top of a card the rows continue. Months on the
 * Transactions tab, days in the audit log.
 */
export function DrawerHeader({
  title,
  subtitle,
  open,
  onToggle,
  right,
  accessibilityLabel,
}: {
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  right?: React.ReactNode;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ marginHorizontal: CARD_MX, marginTop: 10 }}>
      <Pressable
        onPress={onToggle}
        className="flex-row items-center bg-card border border-border"
        style={{
          minHeight: 64,
          paddingLeft: 16,
          paddingRight: 14,
          paddingVertical: 12,
          gap: 10,
          borderTopLeftRadius: R,
          borderTopRightRadius: R,
          borderBottomLeftRadius: open ? 0 : R,
          borderBottomRightRadius: open ? 0 : R,
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={accessibilityLabel ?? `${title}, ${subtitle}`}
        accessibilityHint={open ? "Hides these" : "Shows these"}
      >
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Text className="text-body font-bold text-foreground">{title}</Text>
          <Text className="text-meta text-muted-foreground mt-0.5">{subtitle}</Text>
        </View>
        {right ? (
          <View className="flex-row flex-wrap justify-end" style={{ gap: 6, flexShrink: 1 }}>
            {right}
          </View>
        ) : null}
        <Chevron open={open} color={theme.mutedForeground} />
      </Pressable>
    </View>
  );
}

/** A month's header: "Nov 2026", how many transactions, and the month's totals as chips. */
export function MonthDrawerHeader({
  summary,
  open,
  mode,
  onToggle,
}: {
  summary: MonthSummary;
  open: boolean;
  mode: DrawerMode;
  onToggle: () => void;
}) {
  const count = `${summary.count} ${summary.count === 1 ? "transaction" : "transactions"}`;
  return (
    <DrawerHeader
      title={formatMonthLabel(summary.month, "short")}
      subtitle={count}
      open={open}
      onToggle={onToggle}
      accessibilityLabel={`${formatMonthLabel(summary.month, "long")}, ${count}`}
      right={
        <>
          {(mode === "all" || mode === "credit") && <MoneyChip tone="in" amount={summary.received} label="money in" />}
          {/* Spending is the normal case: ink, not red. */}
          {(mode === "all" || mode === "spend") && <MoneyChip tone="out" amount={summary.spent} label="money out" />}
          {mode === "transfer" && <MoneyChip tone="moved" amount={summary.received + summary.spent} label="moved" />}
        </>
      }
    />
  );
}

/** A row inside an open month: the card's sides continue around it. */
export function DrawerBody({ children }: { children: React.ReactNode }) {
  return (
    <View className="bg-card border-x border-border" style={{ marginHorizontal: CARD_MX }}>
      {children}
    </View>
  );
}

/** The bottom of an open month's card. */
export function DrawerEnd() {
  return (
    <View
      className="bg-card border-x border-b border-border"
      style={{ marginHorizontal: CARD_MX, height: 8, borderBottomLeftRadius: R, borderBottomRightRadius: R }}
    />
  );
}

/** While an open month's rows load. */
export function DrawerLoading() {
  const theme = useTheme();
  return (
    <DrawerBody>
      <View className="items-center justify-center border-t border-border" style={{ height: 64 }}>
        <ActivityIndicator size="small" color={theme.primary} />
      </View>
    </DrawerBody>
  );
}

/** An open month with nothing left in it (e.g. the last one was deleted). */
export function DrawerEmpty() {
  return (
    <DrawerBody>
      <View className="items-center justify-center border-t border-border" style={{ height: 56 }}>
        <Text className="text-meta text-muted-foreground">Nothing here now</Text>
      </View>
    </DrawerBody>
  );
}
