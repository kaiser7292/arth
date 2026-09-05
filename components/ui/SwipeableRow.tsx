import { useRef } from "react";
import { Text } from "./Text";
import { View, Animated } from "react-native";
import { Swipeable, RectButton } from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { useTheme } from "@/hooks/use-theme";

interface SwipeableRowProps {
  children: React.ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftLabel?: string;
  rightLabel?: string;
  leftColor?: string;
  rightColor?: string;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  enabled?: boolean;
}

export function SwipeableRow({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftLabel = "Approve",
  rightLabel = "Reject",
  leftColor: leftColorProp,
  rightColor: rightColorProp,
  leftIcon = "checkmark-circle",
  rightIcon = "close-circle",
  enabled = true,
}: SwipeableRowProps) {
  
  const theme = useTheme();
  const leftColor = leftColorProp ?? theme.success;
  const rightColor = rightColorProp ?? theme.danger;
  const swipeableRef = useRef<Swipeable>(null);

  const renderLeftActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>,
  ) => {
    const scale = dragX.interpolate({
      inputRange: [0, 80],
      outputRange: [0.5, 1],
      extrapolate: "clamp",
    });

    return (
      <RectButton
        style={{ backgroundColor: leftColor, justifyContent: "center", paddingHorizontal: 24 }}
        onPress={() => {
          onSwipeRight?.();
          swipeableRef.current?.close();
        }}
        accessibilityLabel={leftLabel}
        accessibilityRole="button"
      >
        <Animated.View style={{ transform: [{ scale }], alignItems: "center" }}>
          <Ionicons name={leftIcon} size={24} color="white" />
          <Text style={{ color: "white", fontSize: 12, fontWeight: "600", marginTop: 2 }}>
            {leftLabel}
          </Text>
        </Animated.View>
      </RectButton>
    );
  };

  const renderRightActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>,
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-80, 0],
      outputRange: [1, 0.5],
      extrapolate: "clamp",
    });

    return (
      <RectButton
        style={{ backgroundColor: rightColor, justifyContent: "center", paddingHorizontal: 24 }}
        onPress={() => {
          onSwipeLeft?.();
          swipeableRef.current?.close();
        }}
        accessibilityLabel={rightLabel}
        accessibilityRole="button"
      >
        <Animated.View style={{ transform: [{ scale }], alignItems: "center" }}>
          <Ionicons name={rightIcon} size={24} color="white" />
          <Text style={{ color: "white", fontSize: 12, fontWeight: "600", marginTop: 2 }}>
            {rightLabel}
          </Text>
        </Animated.View>
      </RectButton>
    );
  };

  if (!enabled) {
    return <View>{children}</View>;
  }

  return (
    <Swipeable
      ref={swipeableRef}
      renderLeftActions={onSwipeRight ? renderLeftActions : undefined}
      renderRightActions={onSwipeLeft ? renderRightActions : undefined}
      overshootLeft={false}
      overshootRight={false}
      friction={2}
    >
      {children}
    </Swipeable>
  );
}
