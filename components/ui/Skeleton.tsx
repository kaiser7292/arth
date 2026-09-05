import { useEffect } from "react";
import { View, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/use-theme";
import { useReduceMotion } from "@/hooks/use-reduce-motion";

export interface SkeletonProps {
  width?: number | string;
  height?: number;
  radius?: number;
  className?: string;
  style?: ViewStyle;
}

/**
 * A placeholder shaped like the content that is coming.
 *
 * Replaces three competing loading treatments: a pulsing icon (LoadingState, 31 files), a bare
 * ActivityIndicator (63), and the literal string "Loading..." (4). A spinner says only "wait"; a
 * skeleton that matches the eventual layout also says what is arriving and stops the screen
 * jumping when it does.
 *
 * Falls back to a static block under reduce-motion rather than pulsing more slowly.
 */
export function Skeleton({ width = "100%", height = 14, radius = 6, className = "", style }: SkeletonProps) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const pulse = useSharedValue(0.5);

  useEffect(() => {
    if (reduceMotion) {
      pulse.value = 0.5;
      return;
    }
    pulse.value = withRepeat(withTiming(1, { duration: 850 }), -1, true);
  }, [reduceMotion, pulse]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      className={className}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={[
        {
          width: width as ViewStyle["width"],
          height,
          borderRadius: radius,
          backgroundColor: theme.alpha("mutedForeground", 0.16),
        },
        style,
        animated,
      ]}
    />
  );
}

/**
 * A stack of rows shaped like ListRow — icon bubble, two lines of text, trailing amount.
 * Used wherever a list is loading, so the skeleton and the real rows occupy the same space.
 */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <View accessibilityLabel="Loading list">
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} className="flex-row items-center px-4 py-3">
          <Skeleton width={34} height={34} radius={10} />
          <View className="flex-1 ml-3">
            <Skeleton width="55%" height={13} />
            <View className="h-1.5" />
            <Skeleton width="35%" height={11} />
          </View>
          <Skeleton width={72} height={13} />
        </View>
      ))}
    </View>
  );
}
