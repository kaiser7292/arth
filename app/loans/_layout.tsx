import { FeatureGate } from "@/components/FeatureOff";
import { useStackScreenOptions } from "@/components/ui/stack-options";
import { Stack } from "expo-router";

export default function LoansLayout() {
  const screenOptions = useStackScreenOptions();

  return (
    <FeatureGate feature="loans">
    <Stack
      screenOptions={screenOptions}
    >
      <Stack.Screen name="add" options={{ title: "Add loan" }} />
      <Stack.Screen name="[id]" options={{ title: "Loan" }} />
      <Stack.Screen name="[id]/correction" options={{ title: "Correct the loan" }} />
      <Stack.Screen name="[id]/prepayment" options={{ title: "Record prepayment" }} />
    </Stack>
    </FeatureGate>
  );
}
