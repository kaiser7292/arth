import { useStackScreenOptions } from "@/components/ui/stack-options";
import { Stack } from "expo-router";

export default function BudgetLayout() {
  const screenOptions = useStackScreenOptions();

  return (
    <Stack
      screenOptions={screenOptions}
    >
      <Stack.Screen
        name="[categoryId]"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="spending-split"
        options={{ title: "Spending Split" }}
      />
      <Stack.Screen
        name="transactions"
        options={{ title: "Expenses" }}
      />
    </Stack>
  );
}
