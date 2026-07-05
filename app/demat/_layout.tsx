import { Stack } from "expo-router";
import { useColorScheme } from "@/hooks/use-color-scheme";

export default function DematLayout() {
  const { colors } = useColorScheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "700", fontSize: 18 },
        headerShadowVisible: false,
      }}
    />
  );
}
