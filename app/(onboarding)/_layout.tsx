import { Stack } from "expo-router";

/**
 * First-run onboarding wizard. Entered from app/_layout.tsx when the MMKV
 * key `onboarding_completed_version` is null AND the
 * `v15_onboarding_wizard` flag is on. Existing users are stamped
 * "pre-existing" by `migrateExistingUser()` before this ever runs, so they
 * never see the wizard on upgrade.
 *
 * Skip is honoured at every step — tapping Skip on any screen stamps the
 * current app version as completed and replaces the route to (tabs).
 */
export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: false,
        animation: "slide_from_right",
      }}
    />
  );
}
