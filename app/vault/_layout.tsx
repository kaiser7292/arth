import { useStackScreenOptions } from "@/components/ui/stack-options";
import { Stack } from "expo-router";

export default function VaultLayout() {
  const screenOptions = useStackScreenOptions();

  return (
    <Stack
      screenOptions={screenOptions}
    >
      <Stack.Screen name="index" options={{ title: "Vault" }} />
      <Stack.Screen name="add" options={{ title: "New Entry" }} />
      <Stack.Screen name="[entryId]" options={{ title: "Entry" }} />
    </Stack>
  );
}
