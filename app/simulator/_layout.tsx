import { HeaderBackHome } from "@/components/ui/HeaderBackHome";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Stack } from "expo-router";

/**
 * Simulator stack. Mirrors the screen-layout conventions used by the other
 * top-level directories (settings, goals, reconciliation): header-on,
 * theme-aware title, accent tint, no shadow.
 */
export default function SimulatorStackLayout() {
  const { colorScheme } = useColorScheme();
  const theme = Colors[colorScheme];

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTitleStyle: { fontWeight: "700", fontSize: 18, color: theme.text },
        headerTintColor: theme.tint,
        headerShadowVisible: false,
        headerTitleAlign: "center",
        headerLeft: () => <HeaderBackHome />,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Cash-flow Simulator" }} />
      <Stack.Screen name="[id]" options={{ title: "" }} />
      <Stack.Screen name="[id]/entry" options={{ title: "Add Planned Entry" }} />
    </Stack>
  );
}
