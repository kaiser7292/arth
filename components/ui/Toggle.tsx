import { useEffect, useRef } from "react";
import { Animated, Pressable } from "react-native";
import { useTheme } from "@/hooks/use-theme";

/**
 * An on/off switch that looks and feels the same on iPhone and Android (owner, Nov 2026: the
 * native iOS switch looked wrong in the category cards: bigger, and it ignores the off colour).
 * 44×26 as on the boards; the knob slides.
 */
export function Toggle({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const x = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(x, { toValue: value ? 1 : 0, duration: 160, useNativeDriver: false }).start();
  }, [value, x]);
  const bg = x.interpolate({ inputRange: [0, 1], outputRange: [theme.alpha("foreground", 0.18), theme.primary] });
  const left = x.interpolate({ inputRange: [0, 1], outputRange: [3, 21] });
  return (
    <Pressable
      onPress={() => !disabled && onValueChange(!value)}
      hitSlop={8}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Animated.View style={{ width: 44, height: 26, borderRadius: 13, backgroundColor: bg, justifyContent: "center" }}>
        <Animated.View
          style={{
            position: "absolute",
            left,
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: "#FFFFFF",
            shadowColor: "#000",
            shadowOpacity: 0.2,
            shadowRadius: 1.5,
            shadowOffset: { width: 0, height: 1 },
            elevation: 1,
          }}
        />
      </Animated.View>
    </Pressable>
  );
}
