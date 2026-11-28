import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { Amount, Card, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { loadRegulars, type RegularsSummary } from "@/services/regulars";
import { formatAmount } from "@/utils/format";
import { logger } from "@/utils/logger";

/**
 * Top of Where it goes → Regulars: what bills and subscriptions usually cost a month, and the
 * ones that went up or haven't come (services/regulars.ts). Shows nothing until Arth has learned
 * a regular payment.
 */
export function BillsSummaryCard() {
  const theme = useTheme();
  const [sum, setSum] = useState<RegularsSummary | null>(null);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const s = ++seq.current;
    try {
      const r = await loadRegulars();
      if (s === seq.current) setSum(r);
    } catch (e) {
      // A failed refresh keeps what was showing.
      logger.warn("Bills summary: load failed", e);
    }
  }, []);
  useDataRefresh(load);

  if (!sum || sum.regulars.length === 0) return null;
  const flagged = sum.regulars.filter((r) => r.wentUp || r.stopped).slice(0, 4);
  return (
    <View className="px-4 pt-3">
      <Card>
        <Text className="text-label text-muted-foreground">Bills and subscriptions, usually a month</Text>
        <Amount value={sum.monthlyTotal} className="text-hero font-bold text-foreground" />
        <Text className="text-meta text-muted-foreground">
          {sum.regulars.length} regular{sum.regulars.length === 1 ? "" : "s"}
          {sum.wentUp > 0 ? ` · ${sum.wentUp} went up` : ""}
          {sum.stopped > 0 ? ` · ${sum.stopped} not come this month` : ""}
        </Text>
        {flagged.map((r) => (
          <View key={r.id} className="flex-row items-center mt-2" style={{ gap: 8 }}>
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: theme.alpha(r.wentUp ? "warning" : "mutedForeground", 0.14) }}>
              <Text className="text-label font-bold" style={{ color: r.wentUp ? theme.warning : theme.mutedForeground }}>
                {r.wentUp ? "Went up" : "Stopped?"}
              </Text>
            </View>
            <Text className="text-meta text-foreground flex-1" numberOfLines={1}>
              {r.name}
            </Text>
            <Text className="text-meta text-muted-foreground" numberOfLines={1}>
              {r.wentUp && r.lastAmount != null ? `${formatAmount(r.lastAmount)}, was ${formatAmount(r.usual)}` : "not this month"}
            </Text>
          </View>
        ))}
      </Card>
    </View>
  );
}
