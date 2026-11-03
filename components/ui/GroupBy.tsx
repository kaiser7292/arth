import { View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount } from "@/utils/expense-validation";
import { Text } from "./Text";

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
