import { getReportAmountStyle } from "@/services/locale-preferences";
import { formatAmount, formatReportShort } from "@/utils/format";
import { Text, type TextProps } from "./Text";
import { useToast } from "./Toast";

export interface AmountProps extends Omit<TextProps, "children" | "numberOfLines"> {
  value: number;
  /**
   * Longest full figure this spot takes ("₹1,31,077" is 9). Past it, with Settings → Region →
   * Tight spaces on "Short", the short form shows ("₹1.31L") and a tap shows the full figure.
   */
  maxChars?: number;
}

/**
 * One amount that never wraps (docs/INSIGHTS_STREAMLINE_PROPOSAL.md §3.3): one line, tabular
 * digits, allowed to shrink to 85% to fit; when the full figure is longer than the spot takes and
 * Tight spaces is "Short", the short form with the full figure a tap away. Decimals follow
 * Settings → Region, and hidden amounts stay hidden (formatAmount).
 */
export function Amount({ value, maxChars = 12, style, ...rest }: AmountProps) {
  const toast = useToast();
  const full = formatAmount(value);
  const short = getReportAmountStyle() === "short" && full.length > maxChars ? formatReportShort(value) : null;
  const shown = short && short !== full ? short : full;
  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.85}
      style={[{ fontVariant: ["tabular-nums"] }, style]}
      onPress={shown !== full ? () => toast(full) : undefined}
      accessibilityLabel={full}
      accessibilityRole={shown !== full ? "button" : undefined}
      accessibilityHint={shown !== full ? "Shows the full amount" : undefined}
      {...rest}
    >
      {shown}
    </Text>
  );
}
