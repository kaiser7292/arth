import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/use-theme";
import { MOTION } from "@/constants/design-tokens";

interface ProgressBarProps {
  /** 0 to 1. Values outside that are clamped rather than allowed to overflow the track. */
  value: number;
  color?: string;
  trackColor?: string;
  height?: number;
  /**
   * Animate from empty on mount. Off means a plain View with no Reanimated node at all, which is
   * what you want for a bar inside a list row - thirty rows animating themselves on scroll is
   * motion nobody asked for and thirty shared values nobody needed.
   */
  animated?: boolean;
  /** Layout only (margins). Padding and radius belong to the bar. */
  className?: string;
}

/**
 * A horizontal progress bar.
 *
 * There were about forty of these written inline - a rounded track View wrapping a fill View with
 * a percentage width - against eighteen uses of this component. Most of the inline ones did not
 * clamp, so any figure over 100% painted a fill wider than its own track.
 *
 * Two things changed here to make adopting it safe in dense screens. It no longer draws a
 * LinearGradient: that gradient ran between `theme.primary` and `theme.primary`, so it was an
 * extra native view rendering a solid colour. And `animated={false}` now renders plain Views,
 * where before it still created a shared value and an animated style to hold a constant.
 */
export function ProgressBar({
  value,
  color,
  trackColor,
  height = 8,
  animated = true,
  className = "",
}: ProgressBarProps) {
  const theme = useTheme();
  const fill = color ?? theme.primary;
  const clamped = Math.min(Math.max(value, 0), 1);

  return (
    <View
      className={`w-full rounded-full overflow-hidden bg-border ${className}`}
      style={[{ height }, trackColor ? { backgroundColor: trackColor } : null]}
      accessibilityRole="progressbar"
      accessibilityValue={{ now: Math.round(clamped * 100), min: 0, max: 100 }}
    >
      {animated ? (
        <AnimatedFill value={clamped} color={fill} />
      ) : (
        <View
          className="h-full rounded-full"
          style={{ width: `${clamped * 100}%`, backgroundColor: fill }}
        />
      )}
    </View>
  );
}

/** Split out so the static path mounts no Reanimated node at all. */
function AnimatedFill({ value, color }: { value: number; color: string }) {
  const width = useSharedValue(0);

  useEffect(() => {
    width.value = withTiming(value, { duration: MOTION.slow });
  }, [value, width]);

  const style = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));

  return (
    <Animated.View
      className="h-full rounded-full"
      style={[style, { backgroundColor: color }]}
    />
  );
}
