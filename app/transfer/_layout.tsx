import { Stack } from "expo-router";
import { useStackScreenOptions } from "@/components/ui/stack-options";

/**
 * The transfer route had no layout and was not registered in the root Stack, so it rendered with
 * expo-router's default chrome — a different header from every other detail screen in the app.
 */
export default function TransferLayout() {
  const screenOptions = useStackScreenOptions();

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="[id]" options={{ title: "Transfer" }} />
    </Stack>
  );
}
