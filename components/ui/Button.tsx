import { useState } from "react";
import { Pressable, ActivityIndicator, View } from "react-native";
import Animated from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/use-theme";
import { Text } from "./Text";
import { COMPONENTS } from "@/constants/design-tokens";
import { splitLayoutClasses, usePressScale } from "@/components/motion/motion";

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
  const B = COMPONENTS.button;

  // Press state is tracked manually and applied through a static style array. Pressable's
  // function-form style prop does not reliably merge with a NativeWind className, which once
  // caused primary buttons to render with no background at all.
  const [isPressed, setIsPressed] = useState(false);
  // Press feedback: the whole button shrinks slightly while held. The scale lives on an animated
  // layer with no className; layout classes from the caller (margins, flex-1) go on a plain View
  // outside it, visual ones stay on the Pressable.
  const press = usePressScale(!disabled && !loading);
  const { layout, rest } = splitLayoutClasses(className);

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

  const button = (
    <Animated.View style={press.style}>
    <Pressable
      onPress={handlePress}
      onPressIn={() => {
        if (disabled || loading) return;
        setIsPressed(true);
        press.onPressIn();
      }}
      onPressOut={() => {
        setIsPressed(false);
        press.onPressOut();
      }}
      disabled={disabled || loading}
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      style={[container, isPressed && !disabled && !loading ? { opacity: B.pressedOpacity } : null]}
      className={`${B.base} ${B.pad} ${containerClass} ${disabled ? B.disabled : ""} ${rest}`}
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
    </Animated.View>
  );
  return layout ? <View className={layout}>{button}</View> : button;
}
