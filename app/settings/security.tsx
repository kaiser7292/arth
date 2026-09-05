import { useCallback, useEffect, useState } from "react";
import { Text } from "@/components/ui";
import { View, Pressable, Switch, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { Card } from "@/components/ui/Card";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Colors } from "@/constants/theme";
import {
  isLockEnabled,
  setLockEnabled,
  getLockTimeout,
  setLockTimeout,
  promptUnlock,
  getBiometricCapability,
  describeBiometricType,
  LOCK_TIMEOUT_OPTIONS,
  LOCK_TIMEOUT_LABELS,
  type LockTimeoutOption,
} from "@/services/biometric-lock";
import { useAlert } from "@/hooks/use-alert";
import { useTheme } from "@/hooks/use-theme";

export default function SecuritySettingsScreen() {
  const { colorScheme } = useColorScheme();
  const uiTheme = useTheme();
  const theme = Colors[colorScheme];
  const accentColor = colorScheme === "dark" ? uiTheme.primary : uiTheme.primary;
  const router = useRouter();
  const alert = useAlert();

  const [enabled, setEnabled] = useState(isLockEnabled());
  const [timeout, setTimeoutState] = useState<LockTimeoutOption>(getLockTimeout());
  const [biometricLabel, setBiometricLabel] = useState("Biometric");
  const [hasHardware, setHasHardware] = useState(true);
  const [isEnrolled, setIsEnrolled] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBiometricCapability().then((cap) => {
      setHasHardware(cap.hasHardware);
      setIsEnrolled(cap.isEnrolled);
      setBiometricLabel(describeBiometricType(cap.supportedTypes));
    });
  }, []);

  const onToggle = useCallback(
    async (next: boolean) => {
      if (busy) return;
      setBusy(true);
      try {
        if (next) {
          // Verify the user can actually authenticate before turning on.
          const result = await promptUnlock({
            promptMessage: "Confirm to enable app lock",
            allowDeviceCredentials: true,
          });
          if (!result.ok) {
            if (result.reason === "no_hardware") {
              alert("Not supported", "Your device doesn't support biometric authentication.");
            } else if (result.reason === "not_enrolled") {
              alert(
                "No biometric set up",
                "Please set up fingerprint, Face ID, or a device passcode in your phone's Settings first.",
              );
            } else if (result.reason !== "cancelled") {
              alert("Authentication failed", "Please try again.");
            }
            return;
          }
          setLockEnabled(true);
          setEnabled(true);
        } else {
          // Require authentication BEFORE disabling so an attacker can't just
          // toggle it off from within an unlocked session.
          const result = await promptUnlock({
            promptMessage: "Confirm to disable app lock",
            allowDeviceCredentials: true,
          });
          if (!result.ok) {
            if (result.reason !== "cancelled") {
              alert("Authentication failed", "App lock remains enabled.");
            }
            return;
          }
          setLockEnabled(false);
          setEnabled(false);
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, alert],
  );

  const onSelectTimeout = useCallback((opt: LockTimeoutOption) => {
    setLockTimeout(opt);
    setTimeoutState(opt);
  }, []);

  const onLockNow = useCallback(() => {
    alert("Lock Arth now?", "You'll need to unlock with biometric to continue.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Lock",
        style: "destructive",
        onPress: () => {
          router.replace("/(lock)/lock" as never);
        },
      },
    ]);
  }, [alert, router]);

  const canEnable = hasHardware && isEnrolled;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-4 py-4">
          <Card title="App Lock" className="mb-4">
            <View className="flex-row items-center py-3">
              <Ionicons name="lock-closed" size={20} color={accentColor} />
              <View className="flex-1 ml-3">
                <Text className="text-base text-foreground font-semibold">
                  Enable App Lock
                </Text>
                <Text className="text-xs text-faint-foreground mt-0.5">
                  {canEnable
                    ? `Use ${biometricLabel} to unlock Arth`
                    : !hasHardware
                    ? "This device has no biometric hardware"
                    : "Set up biometric or passcode on your device first"}
                </Text>
              </View>
              {busy ? (
                <ActivityIndicator size="small" color={accentColor} />
              ) : (
                <Switch
                  value={enabled}
                  onValueChange={onToggle}
                  disabled={!canEnable && !enabled}
                  trackColor={{ false: theme.border, true: accentColor }}
                />
              )}
            </View>
          </Card>

          {enabled && (
            <>
              <Card title="Lock When" className="mb-4">
                {LOCK_TIMEOUT_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt}
                    onPress={() => onSelectTimeout(opt)}
                    className="flex-row items-center py-3 border-b border-border last:border-b-0"
                  >
                    <View className="flex-1">
                      <Text className="text-base text-foreground">
                        {LOCK_TIMEOUT_LABELS[opt]}
                      </Text>
                    </View>
                    {timeout === opt && (
                      <Ionicons name="checkmark" size={20} color={accentColor} />
                    )}
                  </Pressable>
                ))}
                <Text className="text-xs text-faint-foreground mt-3">
                  "Never" means Arth only locks on cold start (after closing the app completely).
                  Any other option also locks when the app is backgrounded for that long.
                </Text>
              </Card>

              <Card className="mb-4">
                <Pressable onPress={onLockNow} className="flex-row items-center py-3">
                  <Ionicons name="log-out-outline" size={20} color={theme.text} />
                  <View className="flex-1 ml-3">
                    <Text className="text-base text-foreground font-semibold">
                      Lock Now
                    </Text>
                    <Text className="text-xs text-faint-foreground mt-0.5">
                      Immediately lock Arth
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                </Pressable>
              </Card>
            </>
          )}

          <Text className="text-xs text-faint-foreground px-2">
            App lock preferences are stored on this device only. Uninstalling Arth or restoring from
            a backup on another device will start with the lock off - you can turn it on again from
            this screen.
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
