import { listLayout } from "@/components/motion/motion";
import { drawerEntering } from "@/components/motion/drawer-motion";
import Animated from "react-native-reanimated";
import { Chevron } from "@/components/motion/Chevron";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { RADIUS } from "@/constants/design-tokens";
import { formatAmount } from "@/utils/expense-validation";
import { Text } from "./Text";
import { MoneyChip } from "./MoneyChip";
import { TotalsPill } from "./TotalsPill";

const R = parseInt(RADIUS.card, 10);
const MX = 16;

/**
 * A group's heading in a list: its name, how many, and what it adds up to.
 *
 * With `onToggle` (useListTools sets it on every grouped list) it's a drawer, the same as the
 * Transactions tab's: a card header with the count and a money chip, an arrow that turns, and the
 * group's rows inside it while it's open (wrap each in DrawerCell).
 *
 * `flat` draws it as the Transactions tab does: a plain row with a hairline under it, no card
 * (owner, Nov 2026: ledgers "like how it is in the transactions tab, no cards"). Pass `flat` to
 * the group's DrawerCells too.
 */
export function GroupHeading({
  label,
  count,
  total,
  signed = true,
  inset = true,
  open,
  onToggle,
  noun,
  flat = false,
  inflow,
  outflow,
}: {
  label: string;
  count?: number;
  total: number;
  /** False where amounts have no direction, like transfers between your own accounts. */
  signed?: boolean;
  inset?: boolean;
  open?: boolean;
  onToggle?: () => void;
  noun?: { one: string; many: string };
  flat?: boolean;
  /** With `flat`: show money in and money out side by side instead of one net figure. */
  inflow?: number;
  outflow?: number;
}) {
  const theme = useTheme();
  if (onToggle && flat) {
    return (
      <Animated.View layout={listLayout()}>
      <Pressable
        onPress={onToggle}
        className="flex-row items-center border-b border-border"
        style={{ minHeight: 52, paddingHorizontal: inset ? MX : 0, paddingVertical: 8, gap: 10 }}
        accessibilityRole="button"
        accessibilityState={{ expanded: !!open }}
        accessibilityLabel={count != null ? `${label}, ${count}` : label}
      >
        <View className="flex-1 flex-row items-baseline" style={{ minWidth: 0, gap: 8 }}>
          <Text className="text-body font-bold text-foreground" numberOfLines={1} style={{ flexShrink: 1 }}>
            {label}
          </Text>
          {count != null ? <Text className="text-meta text-muted-foreground">{count}</Text> : null}
        </View>
        {inflow != null || outflow != null ? (
          <TotalsPill
            parts={[
              { tone: "in", amount: inflow ?? 0, label: "in" },
              { tone: "out", amount: outflow ?? 0, label: "out" },
            ]}
          />
        ) : (
          total !== 0 && <MoneyChip amount={total} tone={!signed ? "moved" : total > 0 ? "in" : "out"} />
        )}
        <Chevron open={!!open} size={18} color={theme.mutedForeground} />
      </Pressable>
      </Animated.View>
    );
  }
  if (onToggle) {
    return (
      <Animated.View layout={listLayout()} style={{ marginHorizontal: inset ? MX : 0, marginTop: 10 }}>
        <Pressable
          onPress={onToggle}
          className="flex-row items-center bg-card border border-border"
          style={{
            minHeight: 60,
            paddingLeft: 16,
            paddingRight: 14,
            paddingVertical: 10,
            gap: 10,
            borderTopLeftRadius: R,
            borderTopRightRadius: R,
            borderBottomLeftRadius: open ? 0 : R,
            borderBottomRightRadius: open ? 0 : R,
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded: !!open }}
          accessibilityLabel={count != null ? `${label}, ${count}` : label}
        >
          <View className="flex-1" style={{ minWidth: 0 }}>
            <Text className="text-body font-bold text-foreground" numberOfLines={1}>
              {label}
            </Text>
            {count != null ? <Text className="text-meta text-muted-foreground mt-0.5">{count} {count === 1 ? noun?.one ?? "item" : noun?.many ?? "items"}</Text> : null}
          </View>
          {total !== 0 && <MoneyChip amount={total} tone={!signed ? "moved" : total > 0 ? "in" : "out"} />}
          <Chevron open={!!open} size={18} color={theme.mutedForeground} />
        </Pressable>
      </Animated.View>
    );
  }
  const color = !signed ? theme.mutedForeground : total > 0 ? theme.success : theme.foreground;
  const amount = formatAmount(Math.abs(total));
  return (
    <View className={`pt-4 pb-1.5 flex-row items-baseline justify-between ${inset ? "px-4" : ""}`}>
      <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground shrink mr-3" numberOfLines={1} style={{ letterSpacing: 0.6 }}>
        {label}{count != null ? ` · ${count}` : ""}
      </Text>
      {total !== 0 && (
        <Text className="text-label font-semibold" style={{ color }}>
          {signed ? (total > 0 ? "+" : "-") : ""}{amount}
        </Text>
      )}
    </View>
  );
}

/**
 * A row inside an open group drawer: the card's sides continue around it, and the last row
 * closes the card. Outside a drawer (no grouping) it renders the row as it is.
 */
export function DrawerCell({
  row,
  inset = true,
  flat = false,
  children,
}: {
  row: { inDrawer?: boolean; last?: boolean; groupKey?: string };
  inset?: boolean;
  /** Under a flat heading: the row as it is, a plain list like Transactions. */
  flat?: boolean;
  children: ReactNode;
}) {
  if (!row.inDrawer) return <>{children}</>;
  // Fades in when its drawer was just opened; glides when rows above it come or go.
  if (flat) {
    return (
      <Animated.View entering={drawerEntering(row.groupKey)} layout={listLayout()}>
        {children}
      </Animated.View>
    );
  }
  return (
    <Animated.View
      entering={drawerEntering(row.groupKey)}
      layout={listLayout()}
      className={`bg-card border-x border-border ${row.last ? "border-b" : ""}`}
      style={{
        marginHorizontal: inset ? MX : 0,
        paddingBottom: row.last ? 6 : 0,
        borderBottomLeftRadius: row.last ? R : 0,
        borderBottomRightRadius: row.last ? R : 0,
        overflow: "hidden",
      }}
    >
      {row.last ? (
        // No divider under a group's last row: the row's own bottom line is clipped off.
        <View style={{ overflow: "hidden" }}>
          <View style={{ marginBottom: -1 }}>{children}</View>
        </View>
      ) : (
        children
      )}
    </Animated.View>
  );
}
