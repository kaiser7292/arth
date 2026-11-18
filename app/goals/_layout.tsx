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
        options={{ title: "Yearly plan" }}
      />
      <Stack.Screen
        name="investment-buckets"
        options={{ title: "Investment buckets" }}
      />
      <Stack.Screen
        name="loans"
        options={{ title: "Loans & Debt" }}
      />
      <Stack.Screen
        name="investment-detail"
        options={{ title: "Investment bucket" }}
      />
      <Stack.Screen
        name="milestones"
        options={{ title: "Life Milestones" }}
      />
      <Stack.Screen
        name="milestone-detail"
        options={{ title: "Milestone" }}
      />
      <Stack.Screen
        name="yoy-comparison"
        options={{ title: "Year over year" }}
      />
      <Stack.Screen
        name="balance-sheet"
        options={{ title: "Net worth" }}
      />
      <Stack.Screen
        name="salary-calculator"
        options={{ title: "Income calculator" }}
      />
      <Stack.Screen
        name="capital-gains-reference"
        options={{ title: "Capital gains reference" }}
      />
      <Stack.Screen
        name="health-grade"
        options={{ title: "Financial health" }}
      />
      <Stack.Screen
        name="risk-coverage"
        options={{ title: "Risk coverage" }}
      />
    </Stack>
  );
}
