import { View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { useEffect } from "react";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";

interface ProgressBarProps {
  value: number; // 0 to 1
  color?: string;
  trackColor?: string;
  height?: number;
  animated?: boolean;
}

export function ProgressBar({
  value,
  color,
  trackColor,
  height = 8,
  animated = true,
}: ProgressBarProps) {
  const { colors, accent } = useColorScheme();
  const theme = useTheme();
  const resolvedColor = color ?? colors.tint;
  const clampedValue = Math.min(Math.max(value, 0), 1);
  const width = useSharedValue(animated ? 0 : clampedValue);

  useEffect(() => {
    if (animated) {
      width.value = withTiming(clampedValue, { duration: 600 });
    } else {
      width.value = clampedValue;
    }
  }, [clampedValue, animated]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${width.value * 100}%`,
  }));

  // Use gradient when accent color (no explicit color override)
  const useGradient = !color;

  return (
    <View
      className="w-full rounded-full overflow-hidden bg-border"
      style={[{ height }, trackColor ? { backgroundColor: trackColor } : undefined]}
      accessibilityLabel={`Progress: ${Math.round(clampedValue * 100)}%`}
      accessibilityRole="progressbar"
    >
      <Animated.View className="h-full rounded-full overflow-hidden" style={fillStyle}>
        {useGradient ? (
          <LinearGradient
            colors={[theme.primary, theme.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ flex: 1 }}
          />
        ) : (
          <View style={{ flex: 1, backgroundColor: resolvedColor }} />
        )}
      </Animated.View>
    </View>
  );
}
