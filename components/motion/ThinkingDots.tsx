import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { MOTION } from "@/constants/design-tokens";
import { EASE } from "./motion";

/**
 * Three dots that brighten in turn while the assistant works out a reply. With "Remove animations"
 * on they sit still at half strength.
 */
export function ThinkingDots({ color }: { color: string }) {
  return (
    <View className="flex-row items-center py-1" accessibilityLabel="Thinking" accessibilityRole="progressbar">
      {[0, 1, 2].map((i) => (
        <Dot key={i} index={i} color={color} />
      ))}
    </View>
  );
}

function Dot({ index, color }: { index: number; color: string }) {
  const reduceMotion = useReducedMotion();
  const o = useSharedValue(0.35);
  useEffect(() => {
    if (reduceMotion) {
      o.value = 0.5;
      return;
    }
    const half = MOTION.slow + 100;
    o.value = withDelay(
      index * 150,
      withRepeat(withSequence(withTiming(1, { duration: half, easing: EASE }), withTiming(0.35, { duration: half, easing: EASE })), -1),
    );
  }, [index, o, reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: (1 - o.value) * 2 }] }));
  return (
    <Animated.View
      style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: color, marginRight: index < 2 ? 5 : 0 }, style]}
    />
  );
}
