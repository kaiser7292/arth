import { useStackScreenOptions } from "@/components/ui/stack-options";
import { Stack } from "expo-router";

export default function TogetherLayout() {
  const screenOptions = useStackScreenOptions();

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: "Together" }} />
      <Stack.Screen name="settle" options={{ title: "Settle Up" }} />
    </Stack>
  );
}
