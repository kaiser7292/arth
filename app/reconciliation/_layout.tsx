import { HeaderBackHome } from "@/components/ui/HeaderBackHome";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Stack } from "expo-router";

export default function ReconciliationStackLayout() {
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
      <Stack.Screen name="credit-cards" options={{ title: "Credit Card Details" }} />
      <Stack.Screen name="bank-accounts" options={{ title: "Bank Account Details" }} />
      <Stack.Screen name="wallets" options={{ title: "Wallet Details" }} />
      <Stack.Screen name="pension-accounts" options={{ title: "Pension Account Details" }} />
      <Stack.Screen name="account-ledger" options={{ title: "Account Ledger" }} />
      <Stack.Screen name="demat-portfolio" options={{ title: "Portfolio Details" }} />
    </Stack>
  );
}
