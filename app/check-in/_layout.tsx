import { Stack } from "expo-router";
import { useStackScreenOptions } from "@/components/ui/stack-options";

export default function CheckInLayout() {
  const screenOptions = useStackScreenOptions();

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="rules" options={{ title: "Rule suggestions" }} />
      <Stack.Screen name="subscriptions" options={{ title: "Subscriptions" }} />
      <Stack.Screen name="settle-up" options={{ title: "Settle up" }} />
      <Stack.Screen name="month-end" options={{ title: "Month-end check" }} />
    </Stack>
  );
}
