import { useEffect } from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Text } from "@/components/ui/Text";
import { useTheme } from "@/hooks/use-theme";

type Shape = { icon?: keyof typeof Ionicons.glyphMap; glyph?: string; top: number; left?: number; right?: number; size: number; drift: number; period: number };

/** Faint outlined money shapes, placed around the edges so they never sit under text. */
const SHAPES: Shape[] = [
  { glyph: "₹", top: 18, right: 22, size: 64, drift: 10, period: 5200 },
  { icon: "card-outline", top: 120, right: -14, size: 76, drift: 8, period: 6400 },
  { icon: "wallet-outline", top: 300, left: -18, size: 70, drift: 12, period: 5800 },
  { icon: "trending-up-outline", top: 470, right: 10, size: 56, drift: 9, period: 7000 },
];

/**
 * A slow ambient drift behind the onboarding welcome: outlined ₹ / card / wallet / chart tiles
 * bobbing a few pixels, out of step with each other. Purely decorative (hidden from screen
 * readers, no touches); still when "Remove animations" is on.
 */
export function DriftingShapes() {
  return (
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden" }}>
      {SHAPES.map((s, i) => (
        <Tile key={i} shape={s} index={i} />
      ))}
    </View>
  );
}

function Tile({ shape, index }: { shape: Shape; index: number }) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    t.value = withDelay(index * 400, withRepeat(withTiming(1, { duration: shape.period, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [index, reduceMotion, shape.period, t]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: (t.value - 0.5) * 2 * shape.drift }, { rotate: `${(t.value - 0.5) * 6}deg` }],
  }));
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          top: shape.top,
          left: shape.left,
          right: shape.right,
          width: shape.size,
          height: shape.size,
          borderRadius: shape.size * 0.28,
          borderWidth: 1.5,
          borderColor: theme.alpha("primary", 0.16),
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      {shape.glyph ? (
        <Text style={{ fontSize: shape.size * 0.42, color: theme.alpha("primary", 0.2), fontWeight: "700" }}>{shape.glyph}</Text>
      ) : (
        <Ionicons name={shape.icon!} size={shape.size * 0.42} color={theme.alpha("primary", 0.2)} />
      )}
    </Animated.View>
  );
}
