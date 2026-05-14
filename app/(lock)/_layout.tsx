import { Stack } from "expo-router";

export default function LockLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: false }}>
      <Stack.Screen name="lock" />
    </Stack>
  );
}
