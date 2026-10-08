import { useEffect, useRef } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { timing } from "@/components/motion/motion";
import { useTheme } from "@/hooks/use-theme";
import { COMPONENTS, MOTION } from "@/constants/design-tokens";

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
  /** Wait before the first fill, to stagger bars in a list (later value changes glide at once). */
  delay?: number;
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
  height = COMPONENTS.progress.height,
  animated = true,
  delay = 0,
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
        <AnimatedFill value={clamped} color={fill} delay={delay} />
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
function AnimatedFill({ value, color, delay }: { value: number; color: string; delay: number }) {
  const width = useSharedValue(0);
  const first = useRef(true);

  // Fills from empty when it first shows (after `delay`), then glides to new values - month
  // changes, budget edits. Shared easing; skipped by "Remove animations" (ReduceMotion.System).
  useEffect(() => {
    const fill = withTiming(value, timing(first.current ? MOTION.count - 100 : MOTION.slow));
    width.value = first.current && delay > 0 ? withDelay(delay, fill) : fill;
    first.current = false;
  }, [value, width, delay]);

  const style = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));

  return (
    <Animated.View
      className="h-full rounded-full"
      style={[style, { backgroundColor: color }]}
    />
  );
}
