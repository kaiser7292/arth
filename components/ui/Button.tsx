import { useState } from "react";
import { Text } from "./Text";
import { Pressable, ActivityIndicator } from "react-native";
import * as Haptics from "expo-haptics";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost";

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

const baseClasses: Record<ButtonVariant, { container: string; text: string }> = {
  primary: {
    container: "",
    text: "text-white font-semibold",
  },
  secondary: {
    container: "bg-card",
    text: "text-foreground font-semibold",
  },
  outline: {
    container: "border",
    text: "font-semibold",
  },
  ghost: {
    container: "",
    text: "font-medium",
  },
};

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  className = "",
}: ButtonProps) {
  const { colors, accent, colorScheme } = useColorScheme();
  const styles = baseClasses[variant];
  // Track press state manually and drive opacity via a static style array —
  // Pressable's function-form style prop doesn't reliably merge with
  // NativeWind className on all RN versions, which caused primary buttons
  // to render with no background color (white-on-white in light mode).
  const [isPressed, setIsPressed] = useState(false);

  const handlePress = () => {
    if (disabled || loading) return;
    Haptics.impactAsync(
      variant === "primary"
        ? Haptics.ImpactFeedbackStyle.Light
        : Haptics.ImpactFeedbackStyle.Soft,
    );
    onPress();
  };

  const accentContainer =
    variant === "primary"
      ? { backgroundColor: accent[500] }
      : variant === "outline"
        ? { borderColor: ac(accent, colorScheme, 500, 400) }
        : {};

  const accentText =
    variant === "outline" || variant === "ghost"
      ? { color: ac(accent, colorScheme, 500, 200) }
      : {};

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={() => !disabled && !loading && setIsPressed(true)}
      onPressOut={() => setIsPressed(false)}
      disabled={disabled || loading}
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      style={[
        accentContainer,
        isPressed && !disabled && !loading ? { opacity: 0.85 } : null,
      ]}
      className={`flex-row items-center justify-center rounded-control px-6 py-3 ${styles.container} ${disabled ? "opacity-50" : ""} ${className}`}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === "primary" ? "#FFFFFF" : colors.tint}
        />
      ) : (
        <Text className={`text-base ${styles.text}`} style={accentText}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}
