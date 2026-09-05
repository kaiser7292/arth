import { useStackScreenOptions } from "@/components/ui/stack-options";
import { Stack } from "expo-router";

export default function InsightsStackLayout() {
  const screenOptions = useStackScreenOptions();

  return (
    <Stack
      screenOptions={screenOptions}
    >
      <Stack.Screen name="index" options={{ title: "Analytics" }} />
      <Stack.Screen name="insight-detail" options={{ title: "Insight" }} />
      <Stack.Screen name="forecast" options={{ title: "Monthly Forecast" }} />
      <Stack.Screen name="patterns" options={{ title: "My Spending Patterns" }} />
      <Stack.Screen name="merchants" options={{ title: "Merchant Analytics" }} />
      <Stack.Screen name="compare" options={{ title: "Compare Periods" }} />
      <Stack.Screen name="filtered" options={{ title: "Transactions" }} />
      <Stack.Screen name="budget-vs-actual" options={{ title: "Budget vs Actual" }} />
      <Stack.Screen name="reports" options={{ title: "Reports" }} />
      <Stack.Screen name="report-financial-health" options={{ title: "Financial Health" }} />
      <Stack.Screen name="report-retirement" options={{ title: "Retirement Readiness" }} />
      <Stack.Screen name="report-loan-payoff" options={{ title: "Loan Payoff Strategy" }} />
      <Stack.Screen name="report-spending-personality" options={{ title: "Spending Personality" }} />
    </Stack>
  );
}
