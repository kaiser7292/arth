import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Text } from "./Text";
import { useTheme } from "@/hooks/use-theme";
import { tint } from "@/constants/brand";

/**
 * A row that opens another screen: a tinted icon square, a title, a live line under it, an
 * optional value on the right and a chevron. The rows of the Goals tab's Track list,
 * the Settings home and most "Your data" style cards on the revamp boards.
 *
 * Sits inside a card. `divider` draws the hairline above it (off for the first row).
 */
export function LinkRow({
  icon,
  color,
  title,
  sub,
  value,
  valueColor,
  right,
  onPress,
  onLongPress,
  divider = true,
  danger = false,
  accessibilityLabel,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  /** The icon's colour (hex). Omitted: a neutral grey square. */
  color?: string;
  title: string;
  sub?: ReactNode;
  value?: string | null;
  valueColor?: string;
  /** Anything richer than a value: a badge, a switch. Shown before the chevron. */
  right?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  divider?: boolean;
  /** A destructive link (Clean up): the title turns red. */
  danger?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const fg = color ?? theme.mutedForeground;
  const bg = color ? tint(color, 0.1) : theme.alpha("foreground", 0.06);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      className={`flex-row items-center px-3.5 py-2.5 ${divider ? "border-t border-border" : ""}`}
      style={{ minHeight: 56, gap: 12 }}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel ?? title}
    >
      {icon ? (
        <View className="w-8 h-8 rounded-control items-center justify-center" style={{ backgroundColor: bg }}>
          <Ionicons name={icon} size={17} color={fg} />
        </View>
      ) : null}
      <View className="flex-1" style={{ minWidth: 0 }}>
        <Text
          className="text-body font-semibold"
          style={{ color: danger ? theme.danger : theme.foreground }}
          numberOfLines={1}
        >
          {title}
        </Text>
        {sub != null && sub !== "" ? (
          typeof sub === "string" ? (
            <Text className="text-meta text-muted-foreground mt-0.5" numberOfLines={2}>
              {sub}
            </Text>
          ) : (
            sub
          )
        ) : null}
      </View>
      {value != null && value !== "" ? (
        <Text
          className="text-body font-bold"
          style={{ color: valueColor ?? theme.foreground, fontVariant: ["tabular-nums"] }}
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={theme.faintForeground} /> : null}
    </Pressable>
  );
}

/**
 * One small figure in a row of two to four: the label above, the value below. Budget's "Spent ·
 * Daily pace · Projected", a bucket's "Avg a month · Months to go · Done by".
 */
export function StatTile({
  label,
  value,
  valueColor,
  sub,
  onPress,
}: {
  label: string;
  value: string;
  valueColor?: string;
  sub?: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      className="flex-1 rounded-card bg-card border border-border p-3"
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${label}, ${value}`}
    >
      <Text className="text-label text-muted-foreground" numberOfLines={1}>
        {label}
      </Text>
      <Text
        className="text-body font-bold mt-0.5"
        style={{ color: valueColor ?? theme.foreground, fontVariant: ["tabular-nums"] }}
        numberOfLines={1}
      >
        {value}
      </Text>
      {sub ? (
        <Text className="text-label text-muted-foreground mt-0.5" numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * The one labelled button a header may carry ("Edit", "Edit plan"): a light pill, as on the
 * transaction detail page. Anything more goes in a row under the header.
 */
export function HeaderPill({
  label,
  onPress,
  icon,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center rounded-pill border border-border bg-card px-3.5"
      style={{ height: 36, gap: 6 }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {icon ? <Ionicons name={icon} size={15} color={theme.foreground} /> : null}
      <Text className="text-meta font-semibold text-foreground" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A sum written out so it adds up: each line a label and an amount, a rule, then the result.
 * "Opening ₹X + In ₹Y − Out ₹Z = Closing ₹W". `sign` is shown before the amount.
 */
export function Statement({
  lines,
  total,
}: {
  lines: { label: string; amount: string; sign?: "+" | "−" | ""; sub?: string; color?: string; onPress?: () => void }[];
  total: { label: string; amount: string; color?: string; sub?: string };
}) {
  const theme = useTheme();
  return (
    <View>
      {lines.map((l, i) => (
        <Pressable
          key={`${l.label}-${i}`}
          onPress={l.onPress}
          disabled={!l.onPress}
          className="flex-row items-center py-2"
          accessibilityRole={l.onPress ? "button" : undefined}
          accessibilityLabel={`${l.sign === "−" ? "minus " : l.sign === "+" ? "plus " : ""}${l.label}, ${l.amount}`}
        >
          <View className="flex-1" style={{ minWidth: 0 }}>
            <Text className="text-body text-muted-foreground" numberOfLines={1}>
              {l.label}
            </Text>
            {l.sub ? (
              <Text className="text-label text-faint-foreground" numberOfLines={1}>
                {l.sub}
              </Text>
            ) : null}
          </View>
          <Text
            className="text-body"
            style={{ color: l.color ?? theme.foreground, fontVariant: ["tabular-nums"] }}
            numberOfLines={1}
          >
            {l.sign ? `${l.sign} ` : ""}
            {l.amount}
          </Text>
          {l.onPress ? <Ionicons name="chevron-forward" size={14} color={theme.faintForeground} style={{ marginLeft: 4 }} /> : null}
        </Pressable>
      ))}
      <View className="flex-row items-center border-t border-border pt-2.5 mt-1">
        <View className="flex-1">
          <Text className="text-body font-bold text-foreground" numberOfLines={1}>
            {total.label}
          </Text>
          {total.sub ? (
            <Text className="text-label text-muted-foreground" numberOfLines={2}>
              {total.sub}
            </Text>
          ) : null}
        </View>
        <Text
          className="text-body font-bold"
          style={{ color: total.color ?? theme.foreground, fontVariant: ["tabular-nums"] }}
          numberOfLines={1}
        >
          = {total.amount}
        </Text>
      </View>
    </View>
  );
}

/**
 * Tabs inside one scrolling screen (Income calculator's Salary / Deductions / Other / Tax): labels
 * in a row with the teal underline under the chosen one. For tabs that are whole pages you swipe
 * between, use SwipePager instead.
 */
export function UnderlineTabs<V extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
}) {
  const theme = useTheme();
  return (
    <View className="flex-row border-b border-border" accessibilityRole="tablist">
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <Pressable
            key={t.value}
            onPress={() => onChange(t.value)}
            className="flex-1 items-center justify-center"
            style={{ height: 44 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.label}
          >
            <Text className="text-body font-semibold" style={{ color: on ? theme.foreground : theme.mutedForeground }} numberOfLines={1}>
              {t.label}
            </Text>
            {on ? (
              <View className="absolute bottom-0 rounded-pill" style={{ height: 3, width: "56%", backgroundColor: theme.primary }} />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** The small uppercase label above a group of cards ("PLAN", "TRACK"). */
export function GroupLabel({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View className="flex-row items-center justify-between mb-2.5">
      <Text className="text-label font-semibold tracking-wider uppercase text-muted-foreground" accessibilityRole="header">
        {children}
      </Text>
      {right}
    </View>
  );
}
