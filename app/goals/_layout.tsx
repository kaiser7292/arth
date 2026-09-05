import { useStackScreenOptions } from "@/components/ui/stack-options";
import { Stack } from "expo-router";

export default function GoalsLayout() {
  const screenOptions = useStackScreenOptions();

  return (
    <Stack
      screenOptions={screenOptions}
    >
      <Stack.Screen
        name="yearly-plan"
        options={{ title: "Yearly Financial Plan" }}
      />
      <Stack.Screen
        name="investment-buckets"
        options={{ title: "Investment Buckets" }}
      />
      <Stack.Screen
        name="loans"
        options={{ title: "Loans & Debt" }}
      />
      <Stack.Screen
        name="investment-detail"
        options={{ title: "Investment Detail" }}
      />
      <Stack.Screen
        name="milestones"
        options={{ title: "Life Milestones" }}
      />
      <Stack.Screen
        name="milestone-detail"
        options={{ title: "Milestone Detail" }}
      />
      <Stack.Screen
        name="yoy-comparison"
        options={{ title: "Year-over-Year" }}
      />
      <Stack.Screen
        name="balance-sheet"
        options={{ title: "Balance Sheet" }}
      />
      <Stack.Screen
        name="salary-calculator"
        options={{ title: "Income Calculator" }}
      />
      <Stack.Screen
        name="capital-gains-reference"
        options={{ title: "Capital Gains Reference" }}
      />
      <Stack.Screen
        name="health-grade"
        options={{ title: "Financial Health" }}
      />
      <Stack.Screen
        name="risk-coverage"
        options={{ title: "Risk Coverage" }}
      />
    </Stack>
  );
}
