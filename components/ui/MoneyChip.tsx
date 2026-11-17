import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";
import { Text } from "./Text";
import { useTheme } from "@/hooks/use-theme";
import { COMPONENTS } from "@/constants/design-tokens";
import { formatAmount } from "@/utils/format";
import { moneyTone, type MoneyToneName } from "./money-tone";

const ARROW: Record<MoneyToneName, keyof typeof Ionicons.glyphMap> = {
  out: "arrow-up",
  over: "arrow-up",
  in: "arrow-down",
  moved: "swap-horizontal",
};

/** An amount in a pill, coloured by which way the money went (MONEY tones). */
export function MoneyChip({
  amount,
  tone,
  label,
  className = "",
}: {
  amount: number;
  tone: MoneyToneName;
  /** Read out instead of the arrow, e.g. "spent". */
  label?: string;
  className?: string;
}) {
  const theme = useTheme();
  const M = COMPONENTS.moneyChip;
  const { fg, bg } = moneyTone(theme, tone);
  const text = formatAmount(Math.abs(amount));
  return (
    <View
      className={`${M.base} ${className}`}
      style={{ backgroundColor: bg }}
      accessibilityLabel={label ? `${text} ${label}` : text}
    >
      <Ionicons name={ARROW[tone]} size={M.icon} color={fg} style={{ marginRight: 3, transform: tone === "moved" ? undefined : [{ rotate: "45deg" }] }} />
      <Text className={M.label} style={{ color: fg }} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}
