import { useStackScreenOptions } from "@/components/ui/stack-options";
import { Stack } from "expo-router";

export default function TogetherLayout() {
  const screenOptions = useStackScreenOptions();

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: "Together" }} />
      <Stack.Screen name="settle" options={{ title: "Settle Up" }} />
      <Stack.Screen name="budget" options={{ title: "Household Budget" }} />
      <Stack.Screen name="goal" options={{ title: "Shared Goal" }} />
      <Stack.Screen name="transactions" options={{ title: "Shared Transactions" }} />
    </Stack>
  );
}
