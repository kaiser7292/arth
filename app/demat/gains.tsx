import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";

import { SegmentedControl } from "@/components/motion";
import { Button, Card, Input, ScreenContainer, Text } from "@/components/ui";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getAccountHistory, type HistorySale } from "@/services/broker-history/history";
import { correctGain } from "@/services/broker-history/store";
import type { AssetClass, GainCategory } from "@/services/broker-history/types";
import { quarterOf } from "@/services/broker-history/compute";
import { formatDisplayDate } from "@/utils/date";
import { formatAmount } from "@/utils/format";

const CATEGORY: Record<GainCategory, string> = {
  short_term: "Short-term",
  long_term: "Long-term",
  intraday: "Intraday",
  fno: "F&O",
  currency: "Currency",
  commodity: "Commodity",
  buyback: "Buyback",
  crypto: "Crypto",
};
const CLASSES: { value: Exclude<AssetClass, "crypto">; label: string }[] = [
  { value: "equity", label: "Shares" },
  { value: "debt", label: "Bond or other" },
  { value: "gold", label: "Gold, silver" },
];
const QUARTER_NAME = { 1: "Apr - Jun", 2: "Jul - Sep", 3: "Oct - Dec", 4: "Jan - Mar" } as const;
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatAmount(Math.abs(n))}`;
const isCapitalGain = (s: HistorySale) => s.category === "short_term" || s.category === "long_term";

/** Each sale in a period, or just those needing a check. A sale from a report can be corrected. */
export default function DematGainsScreen() {
  const { accountId, fy, quarter, check } = useLocalSearchParams<{ accountId: string; fy: string; quarter?: string; check?: string }>();
  const theme = useTheme();
  const [sales, setSales] = useState<HistorySale[]>([]);
  const [editing, setEditing] = useState<HistorySale | null>(null);
  const [cost, setCost] = useState("");
  const [assetClass, setAssetClass] = useState<Exclude<AssetClass, "crypto">>("equity");

  useDataRefresh(
    useCallback(async () => {
      const h = await getAccountHistory(accountId, Number(fy));
      setSales(
        h.sales.filter((s) => {
          if (check) return !!s.checkReason;
          return quarter ? quarterOf(s.sellDate) === Number(quarter) : true;
        }),
      );
    }, [accountId, fy, quarter, check]),
  );

  const open = (s: HistorySale) => {
    if (!s.id) return;
    setCost(s.buyValue > 0 ? String(s.buyValue) : "");
    setAssetClass(s.assetClass === "crypto" ? "equity" : s.assetClass);
    setEditing(s);
  };

  const save = async () => {
    if (!editing?.id) return;
    const parsed = parseFloat(cost.replace(/,/g, ""));
    await correctGain(editing.id, {
      ...(Number.isFinite(parsed) && parsed >= 0 && parsed !== editing.buyValue ? { cost: parsed } : {}),
      ...(isCapitalGain(editing) && assetClass !== editing.assetClass ? { assetClass } : {}),
      ...(isCapitalGain(editing) && editing.checkReason && !/₹0 cost/.test(editing.checkReason) ? { assetClass } : {}),
    });
    setEditing(null);
  };

  const title = check ? "Sales to check" : quarter ? QUARTER_NAME[Number(quarter) as 1 | 2 | 3 | 4] : "Sales";

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen options={{ title }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {sales.length === 0 ? (
          <Text className="text-sm text-muted-foreground text-center mt-8">
            {check ? "Nothing left to check." : "No sales in this period."}
          </Text>
        ) : (
          <Card className="py-1">
            {sales.map((s, i) => (
              <Pressable
                key={s.id ?? `${s.symbol}-${s.sellDate}-${i}`}
                onPress={() => open(s)}
                disabled={!s.id}
                className={`py-2.5 ${i > 0 ? "border-t border-border" : ""}`}
                accessibilityRole={s.id ? "button" : undefined}
              >
                <View className="flex-row items-start">
                  <View className="flex-1 mr-2">
                    <Text className="text-sm font-semibold text-foreground" numberOfLines={2}>{s.symbol}</Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      {s.quantity} · {CATEGORY[s.category]}
                      {s.source === "calculated" ? " · Calculated" : ""}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {s.buyDate ? `${formatDisplayDate(s.buyDate)} to ` : "Sold "}{formatDisplayDate(s.sellDate)}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-sm font-bold" style={{ color: s.taxable >= 0 ? theme.success : theme.danger }}>{signed(s.taxable)}</Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">{formatAmount(s.buyValue)} to {formatAmount(s.sellValue)}</Text>
                  </View>
                </View>
                {s.checkReason && <Text className="text-xs mt-1" style={{ color: theme.warning }}>{s.checkReason}</Text>}
              </Pressable>
            ))}
          </Card>
        )}
      </ScrollView>

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <Pressable
          onPress={() => setEditing(null)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-start", paddingTop: 100, paddingHorizontal: 16 }}
        >
          <Pressable onPress={() => {}}>
            <Card>
              <Text className="text-base font-semibold text-foreground">{editing?.symbol}</Text>
              {editing?.checkReason && <Text className="text-xs mt-1 mb-2" style={{ color: theme.warning }}>{editing.checkReason}</Text>}
              <Input
                label="What it cost you"
                value={cost}
                onChangeText={setCost}
                keyboardType="numeric"
                formula
                placeholder="0"
                containerClassName="mt-2 mb-3"
              />
              {editing && isCapitalGain(editing) && (
                <>
                  <Text className="text-xs text-muted-foreground mb-1">Taxed as</Text>
                  <SegmentedControl accessibilityLabel="Taxed as" options={CLASSES} value={assetClass} onChange={setAssetClass} className="mb-3" />
                </>
              )}
              <Button title="Save" onPress={() => void save()} />
              <Button title="Cancel" variant="ghost" onPress={() => setEditing(null)} className="mt-1" />
            </Card>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenContainer>
  );
}
