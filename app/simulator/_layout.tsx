import { useStackScreenOptions } from "@/components/ui/stack-options";
import { Stack } from "expo-router";

/**
 * Simulator stack. Mirrors the screen-layout conventions used by the other
 * top-level directories (settings, goals, reconciliation): header-on,
 * theme-aware title, accent tint, no shadow.
 */
export default function SimulatorStackLayout() {
  const screenOptions = useStackScreenOptions();

  return (
    <Stack
      screenOptions={screenOptions}
    >
      <Stack.Screen name="index" options={{ title: "Cash-flow Simulator" }} />
      <Stack.Screen name="[id]" options={{ title: "" }} />
      <Stack.Screen name="[id]/entry" options={{ title: "Add Planned Entry" }} />
    </Stack>
  );
}
