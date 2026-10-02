import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { OnboardingStep } from "@/components/onboarding/OnboardingStep";
import { Text } from "@/components/ui";
import { useAlert } from "@/hooks/use-alert";
import { useTheme } from "@/hooks/use-theme";
import {
  describeBiometricType,
  getBiometricCapability,
  isLockEnabled,
  promptUnlock,
  setLockEnabled,
} from "@/services/biometric-lock";
import { hasNotificationPermission, requestNotificationPermissions } from "@/services/notifications";

/** Onboarding: app lock and notifications. Both optional, both changeable in Settings. */
export default function OnboardingProtect() {
  const router = useRouter();
  const theme = useTheme();
  const alert = useAlert();
  const [lockOn, setLockOn] = useState(isLockEnabled());
  const [lockAvailable, setLockAvailable] = useState(true);
  const [lockLabel, setLockLabel] = useState("fingerprint or face");
  const [notifOn, setNotifOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBiometricCapability()
      .then((cap) => {
        setLockAvailable(cap.hasHardware);
        if (cap.supportedTypes.length) setLockLabel(describeBiometricType(cap.supportedTypes).toLowerCase());
      })
      .catch(() => setLockAvailable(false));
    hasNotificationPermission().then(setNotifOn).catch(() => {});
  }, []);

  const toggleLock = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (!next) {
        setLockEnabled(false);
        setLockOn(false);
        return;
      }
      const result = await promptUnlock({ promptMessage: "Confirm to turn on app lock", allowDeviceCredentials: true });
      if (result.ok) {
        setLockEnabled(true);
        setLockOn(true);
      } else if (result.reason === "not_enrolled") {
        alert("No screen lock set up", "Set up a fingerprint, face or PIN in your phone's settings first, then turn this on in Settings → Security.");
      } else if (result.reason !== "cancelled") {
        alert("Couldn't turn on app lock", "Please try again later from Settings → Security.");
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleNotifications = async (next: boolean) => {
    if (!next) return; // Android only lets the user revoke it in system settings
    const granted = await requestNotificationPermissions().catch(() => false);
    setNotifOn(granted);
  };

  const row = (icon: keyof typeof Ionicons.glyphMap, title: string, body: string, value: boolean, onChange: (v: boolean) => void, disabled?: boolean) => (
    <View className="flex-row items-start py-3 border-b border-border">
      <Ionicons name={icon} size={20} color={theme.primary} style={{ marginTop: 2, marginRight: 12 }} />
      <View className="flex-1 mr-3">
        <Text className="text-sm font-semibold text-foreground mb-0.5">{title}</Text>
        <Text className="text-xs text-muted-foreground leading-4">{body}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={title} />
    </View>
  );

  const next = () => router.push("/(onboarding)/done");

  return (
    <OnboardingStep
      icon="shield-checkmark-outline"
      title="Protect Arth"
      subtitle="Your finances are on this phone, so lock them behind your screen lock, and let Arth remind you about bills."
      onPrimary={next}
    >
      {row(
        "lock-closed-outline",
        "App lock",
        lockAvailable
          ? `Ask for your ${lockLabel} or phone PIN when Arth opens.`
          : "This phone has no fingerprint or face unlock. You can still use your phone PIN from Settings → Security.",
        lockOn,
        toggleLock,
        busy,
      )}
      {row(
        "notifications-outline",
        "Notifications",
        "Bill and EMI reminders, new transactions to review, and your monthly summary.",
        notifOn,
        toggleNotifications,
        notifOn,
      )}
    </OnboardingStep>
  );
}
