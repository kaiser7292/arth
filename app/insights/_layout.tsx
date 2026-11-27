import { FeatureGate } from "@/components/FeatureOff";
import { useStackScreenOptions } from "@/components/ui/stack-options";
import { Stack, usePathname } from "expo-router";

export default function InsightsStackLayout() {
  const screenOptions = useStackScreenOptions();
  // The transaction list a drill-down opens is shared: Budget vs actual, Financial health and Year
  // over year live outside Insights and open it too, so it stays open with Insights switched off.
  const pathname = usePathname();
  const shared = pathname === "/insights/filtered";

  return (
    <FeatureGate feature="insights" bypass={shared}>
    <Stack
      screenOptions={screenOptions}
    >
      <Stack.Screen name="index" options={{ title: "Insights" }} />
      <Stack.Screen name="insight-detail" options={{ title: "Insight" }} />
      <Stack.Screen name="forecast" options={{ title: "Forecast" }} />
      <Stack.Screen name="patterns" options={{ title: "My Spending Patterns" }} />
      <Stack.Screen name="merchants" options={{ title: "Merchant Analytics" }} />
      <Stack.Screen name="where-it-goes" options={{ title: "Where it goes" }} />
      <Stack.Screen name="compare" options={{ title: "Compare Periods" }} />
      <Stack.Screen name="filtered" options={{ title: "Transactions" }} />
      <Stack.Screen name="cash-flow" options={{ title: "Money in and out" }} />
      <Stack.Screen name="export-for-ai" options={{ title: "Export for AI Insights" }} />
      <Stack.Screen name="month-story" options={{ title: "Your month", headerShown: false, animation: "fade_from_bottom" }} />
      <Stack.Screen name="year-review" options={{ title: "Year in Review", headerShown: false, animation: "fade_from_bottom" }} />
    </Stack>
    </FeatureGate>
  );
}
