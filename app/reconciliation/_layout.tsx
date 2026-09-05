import { useStackScreenOptions } from "@/components/ui/stack-options";
import { Stack } from "expo-router";

export default function ReconciliationStackLayout() {
  const screenOptions = useStackScreenOptions();

  return (
    <Stack
      screenOptions={screenOptions}
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
