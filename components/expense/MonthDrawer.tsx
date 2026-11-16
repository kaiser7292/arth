import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { formatMonthLabel } from "@/utils/date";
import { formatAmount } from "@/utils/format";
import type { MonthSummary } from "@/utils/month-drawers";

/** Which totals a month's header shows: in and out on All, one figure on the other tabs. */
export type DrawerMode = "all" | "spend" | "credit" | "transfer";

const CARD_MX = 16;

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

function AmountChip({ tone, icon, rotate, value, label }: {
  tone: "success" | "danger" | "primary";
  icon: keyof typeof Ionicons.glyphMap;
  rotate?: number;
  value: number;
  label: string;
}) {
  const theme = useTheme();
  const text = formatAmount(value);
  return (
    <View
      className="flex-row items-center rounded-full pl-1.5 pr-2.5"
      style={{ height: 26, backgroundColor: theme.alpha(tone, 0.12) }}
      accessibilityLabel={`${label} ${text}`}
    >
      <Ionicons
        name={icon}
        size={13}
        color={theme[tone]}
        style={rotate ? { transform: [{ rotate: `${rotate}deg` }] } : undefined}
      />
      <Text className="text-xs font-bold ml-0.5" style={{ color: theme[tone], fontVariant: ["tabular-nums"] }}>
        {text}
      </Text>
    </View>
  );
}

/**
 * A month's header: "Nov 2026", how many transactions, the month's totals as chips, and an
 * arrow that turns when it opens. Open, it's the top of a card the month's rows continue.
 */
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
  const theme = useTheme();
  const label = formatMonthLabel(summary.month, "short");
  const count = `${summary.count} ${summary.count === 1 ? "transaction" : "transactions"}`;
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
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          borderBottomLeftRadius: open ? 0 : 16,
          borderBottomRightRadius: open ? 0 : 16,
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${formatMonthLabel(summary.month, "long")}, ${count}`}
        accessibilityHint={open ? "Hides this month" : "Shows this month"}
      >
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Text className="text-body font-bold text-foreground">{label}</Text>
          <Text className="text-xs text-muted-foreground mt-0.5">{count}</Text>
        </View>
        <View className="flex-row flex-wrap justify-end" style={{ gap: 6, flexShrink: 1 }}>
          {(mode === "all" || mode === "credit") && (
            <AmountChip tone="success" icon="arrow-down" rotate={45} value={summary.received} label="Money in" />
          )}
          {(mode === "all" || mode === "spend") && (
            <AmountChip tone="danger" icon="arrow-up" rotate={45} value={summary.spent} label="Money out" />
          )}
          {mode === "transfer" && (
            <AmountChip tone="primary" icon="swap-horizontal" value={summary.received + summary.spent} label="Moved" />
          )}
        </View>
        <Chevron open={open} color={theme.mutedForeground} />
      </Pressable>
    </View>
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
      style={{ marginHorizontal: CARD_MX, height: 8, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }}
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
