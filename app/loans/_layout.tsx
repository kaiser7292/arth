import { useStackScreenOptions } from "@/components/ui/stack-options";
import { Stack } from "expo-router";

export default function LoansLayout() {
  const screenOptions = useStackScreenOptions();

  return (
    <Stack
      screenOptions={screenOptions}
    >
      <Stack.Screen name="add" options={{ title: "Add Loan" }} />
      <Stack.Screen name="[id]" options={{ title: "Loan Details" }} />
      <Stack.Screen name="[id]/correction" options={{ title: "Manual Correction" }} />
      <Stack.Screen name="[id]/prepayment" options={{ title: "Record Prepayment" }} />
    </Stack>
  );
}
