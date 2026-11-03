import { useState } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount } from "@/utils/expense-validation";
import { SelectSheet } from "./SelectSheet";
import { Text } from "./Text";

/** The "Group by" control above a list. */
export function GroupByBar<K extends string>({
  value,
  options,
  onChange,
  inset = true,
}: {
  value: K;
  options: { value: K; label: string }[];
  onChange: (value: K) => void;
  /** False when the list's container already has side padding. */
  inset?: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const label = options.find((o) => o.value === value)?.label ?? "";
  return (
    <View className={`flex-row items-center justify-end py-1 ${inset ? "px-4" : ""}`}>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        className="flex-row items-center py-1"
        accessibilityRole="button"
        accessibilityLabel={`Group by ${label}, tap to change`}
      >
        <Ionicons name="layers-outline" size={14} color={theme.mutedForeground} />
        <Text className="text-xs text-muted-foreground ml-1.5">Group by </Text>
        <Text className="text-xs font-semibold" style={{ color: theme.primary }}>{label}</Text>
        <Ionicons name="chevron-down" size={12} color={theme.primary} style={{ marginLeft: 2 }} />
      </Pressable>
      <SelectSheet<K> visible={open} title="Group by" options={options} value={value} onChange={onChange} onClose={() => setOpen(false)} />
    </View>
  );
}

/** A group's heading in a list: its name, how many, and what it adds up to. */
export function GroupHeading({
  label,
  count,
  total,
  signed = true,
  inset = true,
}: {
  label: string;
  count?: number;
  total: number;
  /** False where amounts have no direction, like transfers between your own accounts. */
  signed?: boolean;
  inset?: boolean;
}) {
  const theme = useTheme();
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
