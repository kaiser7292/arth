import { HeaderBackHome } from "@/components/ui/HeaderBackHome";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Stack } from "expo-router";

export default function VaultLayout() {
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
      <Stack.Screen name="index" options={{ title: "Vault" }} />
      <Stack.Screen name="add" options={{ title: "New Entry" }} />
      <Stack.Screen name="[entryId]" options={{ title: "Entry" }} />
    </Stack>
  );
}
