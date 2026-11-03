import { FeatureGate } from "@/components/FeatureOff";
import { useStackScreenOptions } from "@/components/ui/stack-options";
import { Stack } from "expo-router";

export default function HisaabLayout() {
  const screenOptions = useStackScreenOptions();

  return (
    <FeatureGate feature="hisaab">
    <Stack
      screenOptions={screenOptions}
    >
      <Stack.Screen
        name="persons"
        options={{ title: "Hisaab - Family Ledger" }}
      />
      <Stack.Screen
        name="ledger"
        options={{ title: "Ledger" }}
      />
    </Stack>
    </FeatureGate>
  );
}
