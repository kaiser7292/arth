import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Button, Card, EmptyState, ScreenContainer, Text } from "@/components/ui";
import { clearLoadTimings, loadTimings, summariseLoads, type ScreenSpeed } from "@/services/load-timings";

/**
 * Settings → Speed diagnostics (docs/SPEED_AND_VOICE_PROPOSAL.md §1.3): how long each screen took
 * to load on this phone, over its last 200 loads, slowest first. Open it from Search
 * ("speed"). Measures release builds honestly; debug builds are many times slower.
 */
export default function SpeedDiagnosticsScreen() {
  const [rows, setRows] = useState<ScreenSpeed[]>([]);
  const [total, setTotal] = useState(0);
  const refresh = useCallback(() => {
    const list = loadTimings();
    setTotal(list.length);
    setRows(summariseLoads(list));
  }, []);
  useFocusEffect(refresh);

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
        <Text className="text-meta text-muted-foreground leading-5">
          How long each screen took to get its data, over the last {total} loads on this phone. Typical is the middle
          one; slowest is the worst. Nothing here leaves the phone.
        </Text>
        {rows.length === 0 ? (
          <EmptyState icon="speedometer-outline" title="Nothing measured yet" subtitle="Use Arth for a bit, then come back." fillScreen={false} />
        ) : (
          <Card>
            <View className="flex-row pb-2 border-b border-border">
              <Text className="text-label font-semibold text-muted-foreground flex-1">Screen</Text>
              <Text className="text-label font-semibold text-muted-foreground w-16 text-right">Typical</Text>
              <Text className="text-label font-semibold text-muted-foreground w-16 text-right">Slowest</Text>
            </View>
            {rows.map((r) => (
              <View key={r.screen} className="flex-row py-2 border-b border-border" accessibilityLabel={`${r.screen || "Home"}: typical ${r.typical} ms, slowest ${r.slowest} ms, ${r.count} loads`}>
                <Text className="text-meta text-foreground flex-1" numberOfLines={1}>
                  {r.screen || "/"} <Text className="text-label text-muted-foreground">×{r.count}</Text>
                </Text>
                <Text className="text-meta text-foreground w-16 text-right">{r.typical} ms</Text>
                <Text className="text-meta text-muted-foreground w-16 text-right">{r.slowest} ms</Text>
              </View>
            ))}
          </Card>
        )}
        <Button
          title="Clear and start again"
          variant="outline"
          onPress={() => {
            clearLoadTimings();
            refresh();
          }}
        />
      </ScrollView>
    </ScreenContainer>
  );
}
