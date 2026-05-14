import { Stack } from "expo-router";

export default function ExpenseLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="add" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="review-queue" />
    </Stack>
  );
}
