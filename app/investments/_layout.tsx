import { useStackScreenOptions } from "@/components/ui/stack-options";
import { Stack } from "expo-router";

export default function InvestmentsLayout() {
  const screenOptions = useStackScreenOptions();

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: "Investments" }} />
      <Stack.Screen name="add" options={{ title: "Add Fixed Deposit" }} />
    </Stack>
  );
}
