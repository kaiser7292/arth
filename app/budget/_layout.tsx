import { Stack } from "expo-router";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Colors } from "@/constants/theme";
import { HeaderBackHome } from "@/components/ui/HeaderBackHome";

export default function BudgetLayout() {
  const { colorScheme } = useColorScheme();
  const theme = Colors[colorScheme];

  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.background,
        },
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
      <Stack.Screen
        name="[categoryId]"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="spending-split"
        options={{ title: "Spending Split" }}
      />
      <Stack.Screen
        name="transactions"
        options={{ title: "Expenses" }}
      />
    </Stack>
  );
}
