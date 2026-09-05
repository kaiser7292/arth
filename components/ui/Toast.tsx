import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/use-theme";
import { useReduceMotion } from "@/hooks/use-reduce-motion";
import { Text } from "./Text";

type ToastTone = "neutral" | "success" | "danger";

interface ToastOptions {
  tone?: ToastTone;
  /** Label for the trailing action, e.g. "Undo". */
  actionLabel?: string;
  onAction?: () => void;
  /** Milliseconds before it dismisses itself. Default 4000, or 6000 when an action is offered. */
  duration?: number;
}

interface ToastState extends ToastOptions {
  id: number;
  message: string;
}

const ToastContext = createContext<(message: string, options?: ToastOptions) => void>(() => {});

/**
 * Transient confirmation, with an optional action.
 *
 * The app soft-deletes almost everything and keeps a recycle bin, but had no way to say so: an
 * accidental delete meant navigating to Settings to find the bin. A toast carrying Undo turns that
 * into one tap, which is the whole reason this exists rather than it being decoration.
 *
 * One toast at a time, deliberately. A stack competes with the FAB and the tab bar for the same
 * corner, and a queue of confirmations is noise rather than information.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);

  const show = useCallback((message: string, options: ToastOptions = {}) => {
    if (timer.current) clearTimeout(timer.current);
    const id = ++nextId.current;
    setToast({ id, message, ...options });
    const ms = options.duration ?? (options.actionLabel ? 6000 : 4000);
    timer.current = setTimeout(() => {
      setToast((cur) => (cur && cur.id === id ? null : cur));
    }, ms);
  }, []);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && <ToastView toast={toast} onDismiss={dismiss} />}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  const accent =
    toast.tone === "success" ? theme.success : toast.tone === "danger" ? theme.danger : theme.primary;

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(180)}
      exiting={reduceMotion ? undefined : FadeOutDown.duration(140)}
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        // Clears the tab bar, so it never sits on top of the navigation.
        bottom: insets.bottom + 72,
      }}
    >
      <View
        accessibilityRole="alert"
        className="flex-row items-center px-4 py-3 rounded-card"
        style={{
          backgroundColor: theme.foreground,
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <Text
          className="flex-1 text-meta font-medium"
          style={{ color: theme.background }}
          numberOfLines={2}
        >
          {toast.message}
        </Text>

        {toast.actionLabel && toast.onAction && (
          <Pressable
            hitSlop={10}
            className="ml-3"
            accessibilityRole="button"
            accessibilityLabel={toast.actionLabel}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              toast.onAction?.();
              onDismiss();
            }}
          >
            <Text className="text-meta font-bold" style={{ color: accent }}>
              {toast.actionLabel}
            </Text>
          </Pressable>
        )}

        <Pressable hitSlop={10} className="ml-3" onPress={onDismiss} accessibilityLabel="Dismiss">
          <Ionicons name="close" size={16} color={theme.background} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

/**
 * `const toast = useToast(); toast("Expense deleted", { actionLabel: "Undo", onAction: restore })`
 */
export function useToast() {
  return useContext(ToastContext);
}
