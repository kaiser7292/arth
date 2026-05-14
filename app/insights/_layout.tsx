import { Stack } from "expo-router";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Colors } from "@/constants/theme";
import { HeaderBackHome } from "@/components/ui/HeaderBackHome";

export default function InsightsStackLayout() {
  const { colorScheme } = useColorScheme();
  const theme = Colors[colorScheme];

  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.background,
        },
        headerTitleStyle: {
          fontWeight: "700",
          fontSize: 18,
          color: theme.text,
        },
        headerTintColor: theme.tint,
        headerShadowVisible: false,
        headerTitleAlign: "center",
        headerLeft: () => <HeaderBackHome />,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Analytics" }} />
      <Stack.Screen name="insight-detail" options={{ title: "Insight" }} />
      <Stack.Screen name="forecast" options={{ title: "Monthly Forecast" }} />
      <Stack.Screen name="patterns" options={{ title: "My Spending Patterns" }} />
      <Stack.Screen name="merchants" options={{ title: "Merchant Analytics" }} />
      <Stack.Screen name="compare" options={{ title: "Compare Periods" }} />
      <Stack.Screen name="filtered" options={{ title: "Transactions" }} />
    </Stack>
  );
}
