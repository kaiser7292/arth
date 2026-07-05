import { HeaderBackHome } from "@/components/ui/HeaderBackHome";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Stack } from "expo-router";

export default function DematStackLayout() {
  const { colorScheme } = useColorScheme();
  const theme = Colors[colorScheme];

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTitleStyle: {
          fontWeight: "700",
          fontSize: 18,
          color: theme.text,
        },
        headerTintColor: theme.tint,
        headerShadowVisible: false,
        headerTitleAlign: "center",
        headerLeft: () => <HeaderBackHome />,
      }}
    >
      <Stack.Screen name="snapshots/[id]" options={{ title: "Demat Account Details" }} />
    </Stack>
  );
}
