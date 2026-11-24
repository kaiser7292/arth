import { getReportAmountStyle } from "@/services/locale-preferences";
import { formatAmount, formatReportShort } from "@/utils/format";
import { Text as RNText } from "react-native";
import { useToast } from "./Toast";

/**
 * An amount on a report, printed the way Settings → Region → "Report numbers" asks.
 *
 * Full (the default): "₹24,92,209.10", exactly as before. Short: "₹24.92L" - and a tap shows the
 * full figure, so nothing is lost when a crore-sized number would not fit (owner, Nov 2026).
 *
 * A plain React Native Text, always placed inside another Text, so it takes that text's font,
 * size and colour (the app's Text would add its own font class):
 *   <Text className="text-body font-bold">You need <ReportAmount value={n} /></RNText>
 */
export function ReportAmount({ value }: { value: number }) {
  const toast = useToast();
  const full = formatAmount(value);
  if (getReportAmountStyle() !== "short") return <RNText>{full}</RNText>;
  const short = formatReportShort(value);
  if (short === full) return <RNText>{short}</RNText>;
  return (
    <RNText onPress={() => toast(full)} accessibilityRole="button" accessibilityLabel={full} accessibilityHint="Shows the full amount">
      {short}
    </RNText>
  );
}
