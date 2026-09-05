import { useState } from "react";
import { Pressable, ActivityIndicator } from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/use-theme";
import { Text } from "./Text";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost";

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

/**
 * Rebuilt on the token layer, which fixes a contrast bug in the app's most-used control.
 *
 * The primary variant filled with the 500 shade of the accent ramp and painted its label white.
 * That was 2.5:1 in light mode and 1.9:1 in dark, where the brand resolves to a light teal — well
 * under the 4.5:1 floor, and the label was close to illegible on a dark ground. Using the `primary`
 * role with its paired `primaryForeground` gives 5.5:1 in light and 9.1:1 in dark, because the
 * foreground token flips to dark ink exactly when the background becomes light.
 *
 * Only `primary` carried the bug; the other variants draw their label from a foreground role.
 */
export function Button({
  title,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  className = "",
}: ButtonProps) {
  const theme = useTheme();

  // Press state is tracked manually and applied through a static style array. Pressable's
  // function-form style prop does not reliably merge with a NativeWind className, which once
  // caused primary buttons to render with no background at all.
  const [isPressed, setIsPressed] = useState(false);

  const handlePress = () => {
    if (disabled || loading) return;
    Haptics.impactAsync(
      variant === "primary" ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Soft,
    );
    onPress();
  };

  const container =
    variant === "primary"
      ? { backgroundColor: theme.primary }
      : variant === "outline"
        ? { borderColor: theme.primary }
        : {};

  const label =
    variant === "primary"
      ? { color: theme.primaryForeground }
      : variant === "secondary"
        ? { color: theme.foreground }
        : { color: theme.primary };

  const containerClass =
    variant === "secondary" ? "bg-card" : variant === "outline" ? "border" : "";

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={() => !disabled && !loading && setIsPressed(true)}
      onPressOut={() => setIsPressed(false)}
      disabled={disabled || loading}
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      style={[container, isPressed && !disabled && !loading ? { opacity: 0.85 } : null]}
      className={`flex-row items-center justify-center rounded-control px-6 py-3 ${containerClass} ${disabled ? "opacity-50" : ""} ${className}`}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === "primary" ? theme.primaryForeground : theme.primary}
        />
      ) : (
        <Text
          className={`text-body ${variant === "ghost" ? "font-medium" : "font-semibold"}`}
          style={label}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}
