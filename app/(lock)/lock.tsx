import { Colors } from "@/constants/theme";
import { STATUS_COLORS } from "@/constants/semantic-colors";
import { Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
    clearAppStartTime,
    consumePendingDeepLink,
    describeBiometricType,
    getBiometricCapability,
    promptUnlock,
    setHasLandedOnHome,
    type UnlockResult
} from "@/services/biometric-lock";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";

/**
 * v15.2.0 biometric lock screen.
 *
 * Routed into from app/_layout.tsx when shouldShowLock() is true. Blocks
 * anything downstream (including tab navigator, onboarding redirect, and
 * notification deep-links) until the user authenticates.
 *
 * Auto-triggers the biometric prompt on mount so a repeat user can unlock
 * in one tap. If the user cancels, they stay here with a manual unlock
 * button. After 3 consecutive fails, surfaces a "Try again later" state
 * (but still lets them retry — we don't hard-lock the app).
 */
export default function LockScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const uiTheme = useTheme();
  const theme = Colors[colorScheme];
  const accentColor = colorScheme === "dark" ? uiTheme.primary : uiTheme.primary;

  const [biometricLabel, setBiometricLabel] = useState<string>("Biometric");
  const [inFlight, setInFlight] = useState(false);
  const [failCount, setFailCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  const attemptUnlock = useCallback(async () => {
    if (inFlight) return;
    setInFlight(true);
    setLastError(null);
    const result: UnlockResult = await promptUnlock({
      promptMessage: "Unlock Arth",
    });
    setInFlight(false);

    if (result.ok) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Clear app start time and home screen flag to prevent cold start re-lock
      clearAppStartTime();
      setHasLandedOnHome(false);
      const pendingScreen = consumePendingDeepLink();
      router.replace((pendingScreen ?? "/(tabs)") as never);
      return;
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});

    if (result.reason === "no_hardware") {
      setLastError("This device doesn't support biometric authentication.");
    } else if (result.reason === "not_enrolled") {
      setLastError("No biometric or passcode is set on this device. Please set one in Settings.");
    } else if (result.reason === "cancelled") {
      // Silent — user cancelled; they can tap the button to retry.
    } else {
      setFailCount((c) => c + 1);
      setLastError("Authentication failed. Please try again.");
    }
  }, [inFlight, router]);

  // Auto-prompt on mount
  useEffect(() => {
    getBiometricCapability().then((cap) => {
      setBiometricLabel(describeBiometricType(cap.supportedTypes));
    });
    attemptUnlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 32,
      }}
    >
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: 48,
          backgroundColor: accentColor + "1A",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 24,
        }}
      >
        <Ionicons name="lock-closed" size={44} color={accentColor} />
      </View>

      <Text
        style={{
          fontSize: 24,
          fontWeight: "700",
          color: theme.text,
          marginBottom: 8,
        }}
      >
        Arth is locked
      </Text>
      <Text
        style={{
          fontSize: 14,
          color: theme.textSecondary,
          textAlign: "center",
          marginBottom: 32,
        }}
      >
        Use {biometricLabel} to unlock.
      </Text>

      <Pressable
        onPress={attemptUnlock}
        disabled={inFlight}
        style={({ pressed }) => ({
          backgroundColor: accentColor,
          paddingHorizontal: 32,
          paddingVertical: 14,
          borderRadius: 12,
          opacity: inFlight ? 0.6 : pressed ? 0.85 : 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        })}
      >
        {inFlight ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Ionicons name="finger-print" size={20} color="#FFFFFF" />
        )}
        <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: 16 }}>
          {inFlight ? "Authenticating..." : `Unlock with ${biometricLabel}`}
        </Text>
      </Pressable>

      {lastError && (
        <Text
          style={{
            color: STATUS_COLORS.error,
            fontSize: 13,
            textAlign: "center",
            marginTop: 16,
            maxWidth: 320,
          }}
        >
          {lastError}
        </Text>
      )}

      {failCount >= 3 && (
        <Text
          style={{
            color: theme.textSecondary,
            fontSize: 12,
            textAlign: "center",
            marginTop: 24,
            maxWidth: 320,
          }}
        >
          Tip: tap Unlock again and choose "Use Passcode" to authenticate with your device PIN.
        </Text>
      )}
    </View>
  );
}
