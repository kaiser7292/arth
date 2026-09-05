import { createContext, useContext, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  ActivityIndicator,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { Shadows } from "@/constants/theme";
import { logger } from "@/utils/logger";

/* ── Types (mirrors React Native Alert API) ── */

export interface AlertButton {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void | Promise<void>;
}

type AlertFn = (
  title: string,
  message?: string,
  buttons?: AlertButton[],
) => void;

/* ── Context ── */

const AlertContext = createContext<AlertFn>(() => {});

export function useAlert(): AlertFn {
  return useContext(AlertContext);
}

/* ── Provider ── */

interface AlertState {
  title: string;
  message?: string;
  buttons: AlertButton[];
}

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [alertState, setAlertState] = useState<AlertState | null>(null);
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null);
  const { colors, colorScheme } = useColorScheme();
  const theme = useTheme();

  const backdropOpacity = useSharedValue(0);
  const cardScale = useSharedValue(0.9);
  const cardOpacity = useSharedValue(0);

  const resolveRef = useRef<(() => void) | null>(null);
  const alertGenRef = useRef(0);

  const animateIn = useCallback(() => {
    backdropOpacity.value = withTiming(1, { duration: 200 });
    cardScale.value = withTiming(1, { duration: 200 });
    cardOpacity.value = withTiming(1, { duration: 200 });
  }, []);

  const animateOut = useCallback((onDone: () => void) => {
    backdropOpacity.value = withTiming(0, { duration: 150 });
    cardScale.value = withTiming(0.9, { duration: 150 });
    cardOpacity.value = withTiming(0, { duration: 150 }, () => {
      runOnJS(onDone)();
    });
  }, []);

  const dismiss = useCallback(() => {
    animateOut(() => {
      setAlertState(null);
      setLoadingIdx(null);
      resolveRef.current?.();
      resolveRef.current = null;
    });
  }, [animateOut]);

  const alert: AlertFn = useCallback(
    (title, message, buttons) => {
      const resolvedButtons =
        buttons && buttons.length > 0 ? buttons : [{ text: "OK" }];
      alertGenRef.current += 1;
      setAlertState({ title, message, buttons: resolvedButtons });
      setLoadingIdx(null);

      // Reset animation values before animating in
      backdropOpacity.value = 0;
      cardScale.value = 0.9;
      cardOpacity.value = 0;

      // Small delay to ensure state is set before animating
      requestAnimationFrame(() => {
        animateIn();
      });
    },
    [animateIn],
  );

  const handlePress = useCallback(
    async (button: AlertButton, idx: number) => {
      const genBefore = alertGenRef.current;
      if (button.onPress) {
        setLoadingIdx(idx);
        try {
          await button.onPress();
        } catch (e) {
          logger.error("Alert button handler error:", e);
        }
        setLoadingIdx(null);
      }
      // Only dismiss if the callback didn't show a new alert
      if (alertGenRef.current === genBefore) {
        dismiss();
      }
    },
    [dismiss],
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const cardAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
    opacity: cardOpacity.value,
  }));

  const isDark = colorScheme === "dark";

  return (
    <AlertContext.Provider value={alert}>
      {children}
      {alertState && (
        <Modal transparent visible statusBarTranslucent animationType="none">
          {/* Backdrop */}
          <Animated.View
            style={[
              {
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.5)",
                justifyContent: "center",
                alignItems: "center",
                paddingHorizontal: 32,
              },
              backdropStyle,
            ]}
          >
            <Pressable
              style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
              onPress={() => {
                // Tap backdrop = cancel (find cancel button or just dismiss)
                const cancelBtn = alertState.buttons.find(
                  (b) => b.style === "cancel",
                );
                if (cancelBtn?.onPress) cancelBtn.onPress();
                dismiss();
              }}
            />

            {/* Alert Card */}
            <Animated.View
              style={[
                {
                  width: "100%",
                  maxWidth: 300,
                  borderRadius: 24,
                  backgroundColor: isDark ? "#1C1C1E" : "#FFFFFF",
                  paddingTop: 28,
                  paddingBottom: 20,
                  paddingHorizontal: 24,
                },
                Shadows.card,
                cardAnimStyle,
              ]}
            >
              {/* Title */}
              <Text
                style={{
                  fontSize: 17,
                  fontWeight: "700",
                  color: colors.text,
                  textAlign: "center",
                  letterSpacing: -0.2,
                  marginBottom: alertState.message ? 10 : 24,
                }}
              >
                {alertState.title}
              </Text>

              {/* Message */}
              {alertState.message && (
                <Text
                  style={{
                    fontSize: 14,
                    lineHeight: 21,
                    color: isDark ? "#9A9A9A" : "#6B7280",
                    textAlign: "center",
                    marginBottom: 24,
                    paddingHorizontal: 4,
                  }}
                >
                  {alertState.message}
                </Text>
              )}

              {/* Buttons */}
              <View style={{ gap: 10 }}>
                {/* Primary actions first (non-cancel), then cancel at bottom */}
                {alertState.buttons
                  .slice()
                  .sort((a, b) => {
                    if (a.style === "cancel") return 1;
                    if (b.style === "cancel") return -1;
                    return 0;
                  })
                  .map((button, idx) => {
                  const isCancel = button.style === "cancel";
                  const isDestructive = button.style === "destructive";
                  const isLoading = loadingIdx === alertState.buttons.indexOf(button);
                  const isDisabled = loadingIdx !== null;

                  let bgColor: string;
                  let textColor: string;

                  if (isDestructive) {
                    bgColor = theme.danger;
                    textColor = "#FFFFFF";
                  } else if (isCancel) {
                    bgColor = theme.background;
                    textColor = theme.mutedForeground;
                  } else {
                    // Was accent[500] with a white label - about 2.5:1, and 1.9:1 in dark where
                    // the brand is a light teal. primaryForeground flips to dark ink there.
                    bgColor = theme.primary;
                    textColor = theme.primaryForeground;
                  }

                  return (
                    <Pressable
                      key={idx}
                      onPress={() => handlePress(button, alertState.buttons.indexOf(button))}
                      disabled={isDisabled}
                      style={{
                        backgroundColor: bgColor,
                        borderRadius: 12,
                        paddingVertical: 14,
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: 48,
                        opacity: isDisabled && !isLoading ? 0.5 : 1,
                      }}
                    >
                      {isLoading ? (
                        <ActivityIndicator size="small" color={textColor} />
                      ) : (
                        <Text
                          style={{
                            fontSize: 15,
                            fontWeight: isCancel ? "500" : "600",
                            color: textColor,
                            letterSpacing: -0.1,
                          }}
                        >
                          {button.text}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </Animated.View>
          </Animated.View>
        </Modal>
      )}
    </AlertContext.Provider>
  );
}
