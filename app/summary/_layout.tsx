import { useStackScreenOptions } from "@/components/ui/stack-options";
import { Stack } from "expo-router";

export default function SummaryLayout() {
  const screenOptions = useStackScreenOptions();

  return (
    <Stack
      screenOptions={screenOptions}
    >
      <Stack.Screen
        name="my-month"
        options={{ title: "My Month" }}
      />
      <Stack.Screen
        name="my-month-rows"
        options={{ title: "Transactions" }}
      />
      <Stack.Screen
        name="[month]"
        options={{ title: "Monthly Summary" }}
      />
    </Stack>
  );
}
