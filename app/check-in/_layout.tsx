import { Stack } from "expo-router";

/** Check-in decks draw their own close / progress header (components/check-in/CheckInDeck). */
export default function CheckInLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="rules" />
      <Stack.Screen name="subscriptions" />
      <Stack.Screen name="settle-up" />
      <Stack.Screen name="month-end" />
    </Stack>
  );
}
