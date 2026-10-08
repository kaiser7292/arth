import { useState } from "react";
import { ScrollView, View } from "react-native";
import { StackedAreaChart, type StackedLayer } from "@/components/charts/StackedAreaChart";
import { Card, FilterChip, Text } from "@/components/ui";
import { DATA_HEX } from "@/constants/brand";

/**
 * Preview of the Investments chart (stacked bands + drill-down) with sample data, no database.
 * Open /investments in the preview harness (npm run preview).
 */

const months = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const market = [292000, 296000, 301000, 295000, 304000, 310000, 306000, 312000, 309000, 315000, 318000, 320000];
const pension = [216000, 218000, 220000, 222000, 224000, 226000, 229000, 231000, 233000, 235000, 238000, 240000];
const fd = [0, 0, 55000, 55000, 55000, 55000, 55000, 55000, 55000, 55000, 55000, 55000];

const ALL: StackedLayer[] = [
  { key: "fd", label: "Fixed Deposits", color: DATA_HEX.series[1], values: fd },
  { key: "market", label: "Market (Demat)", color: DATA_HEX.series[2], values: market },
  { key: "pension", label: "Pension", color: DATA_HEX.series[0], values: pension },
];
const MARKET: StackedLayer[] = [
  { key: "groww", label: "Groww MF", color: DATA_HEX.series[2], opacity: 0.78, values: market.map((v) => Math.round(v * 0.32)) },
  { key: "zerodha", label: "Zerodha", color: DATA_HEX.series[2], opacity: 1, values: market.map((v) => Math.round(v * 0.68)) },
];

export default function InvestmentsPreview() {
  const [focus, setFocus] = useState<string | null>(null);
  const layers = focus === "market" ? MARKET : ALL;
  return (
    <ScrollView className="bg-background" contentContainerStyle={{ padding: 16 }}>
      <View style={{ width: 390 }}>
        <Card>
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            {focus ? "Market (Demat) value" : "Total value"}
          </Text>
          <Text className="text-2xl font-bold text-foreground">{focus ? "₹3,20,000" : "₹6,15,000"}</Text>
          <View className="flex-row mt-3">
            <FilterChip label="All" active={focus == null} onPress={() => setFocus(null)} />
            <FilterChip label="Market (Demat)" active={focus === "market"} onPress={() => setFocus("market")} />
          </View>
          <View className="mt-3">
            <StackedAreaChart key={focus ?? "all"} months={months} layers={layers} onLayerPress={focus ? undefined : setFocus} />
          </View>
        </Card>
      </View>
    </ScrollView>
  );
}
