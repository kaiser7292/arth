import { Stack } from "expo-router";
import { useStackScreenOptions } from "@/components/ui/stack-options";

export default function ExpenseLayout() {
  const stackOptions = useStackScreenOptions();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="add" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="review-queue" />
      <Stack.Screen name="catch-up" options={{ ...stackOptions, headerShown: true, title: "Catch up" }} />
    </Stack>
  );
}
