import { useEffect, useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { MOTION } from "@/constants/design-tokens";
import { timing } from "./motion";

/**
 * Chart and emphasis entrances. Each runs once, when it mounts (a screen's first appearance, not a
 * data refresh), with the shared easing, and is skipped by the phone's "Remove animations" setting
 * (Reanimated's ReduceMotion.System jumps timings straight to their end).
 */

/** 0 -> 1 once on mount, after `delay` ms, over `duration` ms. */
function useMountProgress(delay = 0, duration: number = MOTION.count - 100) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withTiming(1, timing(duration)));
  }, [p, delay, duration]);
  return p;
}

interface GrowInProps {
  delay?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/** Grows up from its bottom edge (scaleY 0 -> 1). For bars and stacked chart bands. */
export function GrowIn({ delay = 0, style, children }: GrowInProps) {
  const p = useMountProgress(delay);
  const anim = useAnimatedStyle(() => ({ transform: [{ scaleY: p.value }] }));
  return <Animated.View style={[{ transformOrigin: "bottom" }, style, anim]}>{children}</Animated.View>;
}

/**
 * Reveals its child left to right, like a line being drawn. The child is laid out at full width
 * from the start (so nothing reflows); only the visible window widens.
 */
export function WipeIn({ delay = 0, style, children }: GrowInProps) {
  const [width, setWidth] = useState(0);
  const p = useMountProgress(delay);
  // Hidden until measured (a full-width first frame would flash the whole chart before the wipe).
  const anim = useAnimatedStyle(() => ({ width: width * p.value }));
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (Math.abs(w - width) > 0.5) setWidth(w);
  };
  return (
    <View style={style} onLayout={onLayout}>
      <Animated.View style={[{ overflow: "hidden" }, anim]}>
        <View style={width > 0 ? { width } : null}>{children}</View>
      </Animated.View>
    </View>
  );
}

/** Turns in from a quarter turn back while scaling up and fading in. For donut charts. */
export function SpinIn({ delay = 0, style, children }: GrowInProps) {
  const p = useMountProgress(delay);
  const anim = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ rotate: `${(p.value - 1) * 90}deg` }, { scale: 0.85 + 0.15 * p.value }],
  }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/**
 * One gentle sideways nudge, to draw the eye to something that needs attention (over budget).
 * Plays once when `active` first becomes true; never loops.
 */
export function Nudge({ active, delay = 600, style, children }: { active: boolean } & GrowInProps) {
  const x = useSharedValue(0);
  useEffect(() => {
    if (!active) return;
    const step = timing(70);
    x.value = withDelay(
      delay,
      withSequence(withTiming(-5, step), withTiming(5, step), withTiming(-3, step), withTiming(0, step)),
    );
  }, [active, delay, x]);
  const anim = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}
