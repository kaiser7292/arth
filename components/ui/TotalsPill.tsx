import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";
import { Text } from "./Text";
import { moneyTone, type MoneyToneName } from "./money-tone";
import { formatShortAmount } from "@/utils/format";
import { useTheme } from "@/hooks/use-theme";

/** A group's totals in one pill: "↙ ₹15.0K  ↗ ₹14.9K", short amounts as set in Region. */
export function TotalsPill({ parts }: { parts: { tone: MoneyToneName; amount: number; label: string }[] }) {
  const theme = useTheme();
  const shown = parts.filter((p) => p.amount > 0);
  if (shown.length === 0) return null;
  return (
    <View
      className="flex-row items-center rounded-pill border border-border"
      style={{ paddingHorizontal: 8, paddingVertical: 3, gap: 8, flexShrink: 0 }}
      accessibilityLabel={shown.map((p) => `${formatShortAmount(p.amount)} ${p.label}`).join(", ")}
    >
      {shown.map((p) => {
        // Money out in red, as on the rows under it (owner, Nov 2026).
        const fg = p.tone === "out" ? theme.danger : moneyTone(theme, p.tone).fg;
        return (
          <View key={p.label} className="flex-row items-center">
            <Ionicons
              name={p.tone === "moved" ? "swap-horizontal" : p.tone === "in" ? "arrow-down" : "arrow-up"}
              size={11}
              color={fg}
              style={{ marginRight: 2, transform: p.tone === "moved" ? undefined : [{ rotate: "45deg" }] }}
            />
            <Text className="text-label font-semibold" style={{ color: fg, fontVariant: ["tabular-nums"] }} numberOfLines={1}>
              {formatShortAmount(p.amount)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
