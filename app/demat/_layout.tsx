import { useStackScreenOptions } from "@/components/ui/stack-options";
import { Stack } from "expo-router";

export default function DematStackLayout() {
  const screenOptions = useStackScreenOptions();

  return (
    <Stack
      screenOptions={screenOptions}
    >
      <Stack.Screen name="snapshots/[id]" options={{ title: "Demat Account Details" }} />
    </Stack>
  );
}
