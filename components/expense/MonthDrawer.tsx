import { drawerEntering } from "@/components/motion/drawer-motion";
import Animated from "react-native-reanimated";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Chevron } from "@/components/motion/Chevron";
import { Text } from "@/components/ui";
import type { MoneyToneName } from "@/components/ui/money-tone";
import { TotalsPill } from "@/components/ui/TotalsPill";
import { useTheme } from "@/hooks/use-theme";
import { formatMonthLabel } from "@/utils/date";
import type { MonthSummary } from "@/utils/month-drawers";

export { TotalsPill };

/** Which totals a month's header shows: in and out on All, one figure on the other tabs. */
export type DrawerMode = "all" | "spend" | "credit" | "transfer";

const CARD_MX = 16;


/**
 * A drawer's header: a plain row, not a card (owner, Nov 2026: "why did we put everything in a
 * card and lose so much space"). The name, the group's totals in one short pill, and an arrow that
 * turns when it opens; a hairline under it. Months on the Transactions tab, days in the audit log.
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
  /** Read out with the title; not shown. */
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  right?: React.ReactNode;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      className="flex-row items-center border-b border-border"
      style={{ minHeight: 52, paddingHorizontal: CARD_MX, gap: 10 }}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={accessibilityLabel ?? `${title}, ${subtitle}`}
      accessibilityHint={open ? "Hides these" : "Shows these"}
    >
      <Text className="text-body font-bold text-foreground" numberOfLines={1} style={{ flexShrink: 1 }}>
        {title}
      </Text>
      {right}
      <View className="flex-1" />
      <Chevron open={open} size={18} color={theme.mutedForeground} />
    </Pressable>
  );
}

/** A month's header: "Nov 2026" and the month's totals in one pill. */
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
  // Only a "YYYY-MM" key is a month; anything else (a stale day or year key) shows as it is
  // rather than as "NaN undefined NaN".
  const isMonth = /^\d{4}-\d{2}$/.test(summary.month);
  return (
    <DrawerHeader
      title={isMonth ? formatMonthLabel(summary.month, "short") : summary.month}
      subtitle={count}
      open={open}
      onToggle={onToggle}
      accessibilityLabel={`${isMonth ? formatMonthLabel(summary.month, "long") : summary.month}, ${count}`}
      right={<TotalsPill parts={pillParts(summary, mode)} />}
    />
  );
}

function pillParts(summary: MonthSummary, mode: DrawerMode): { tone: MoneyToneName; amount: number; label: string }[] {
  if (mode === "transfer") return [{ tone: "moved", amount: summary.received + summary.spent, label: "moved" }];
  return [
    ...(mode === "all" || mode === "credit" ? [{ tone: "in" as const, amount: summary.received, label: "money in" }] : []),
    // Spending is the normal case: ink, not red.
    ...(mode === "all" || mode === "spend" ? [{ tone: "out" as const, amount: summary.spent, label: "money out" }] : []),
  ];
}

/**
 * A drawer for any other grouping (a day, a year, a category, a merchant, an account, a payment
 * mode): its name, how many transactions, and the same money chips as a month.
 */
export function GroupDrawerHeader({
  summary,
  title,
  open,
  mode,
  onToggle,
}: {
  summary: MonthSummary;
  title: string;
  open: boolean;
  mode: DrawerMode;
  onToggle: () => void;
}) {
  const count = `${summary.count} ${summary.count === 1 ? "transaction" : "transactions"}`;
  return (
    <DrawerHeader
      title={title}
      subtitle={count}
      open={open}
      onToggle={onToggle}
      right={<TotalsPill parts={pillParts(summary, mode)} />}
    />
  );
}

/** A row inside an open month: part of the plain list under the heading. Fades in when its month was just opened. */
export function DrawerBody({ children, group }: { children: React.ReactNode; group?: string }) {
  return <Animated.View entering={drawerEntering(group)}>{children}</Animated.View>;
}

/**
 * The end of an open month. The last row's own hairline already divides it from the next
 * heading; a second line here sat 6px under it and read as a stray line (owner, Nov 2026).
 */
export function DrawerEnd() {
  return <View style={{ height: 0 }} />;
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
