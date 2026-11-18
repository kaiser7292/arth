import { Pressable } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/use-theme";
import { BRAND_RAMP } from "@/constants/brand";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { Shadows } from "@/constants/theme";
import { Text } from "./Text";

interface FABProps {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  iconColor?: string;
  size?: number;
  accessibilityLabel?: string;
  /**
   * Makes it the labelled pill the revamp boards use ("+ Milestone", "+ Account"): 52 tall, the icon
   * and one word. Without a label it stays the round button.
   */
  label?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function FAB({
  icon,
  onPress,
  iconColor,
  size = 64,
  accessibilityLabel,
  label,
}: FABProps) {
  const theme = useTheme();
  // Scheme-aware stops. A fixed 400->600 gradient with a white glyph measured 3.4:1 in light and
  // 1.9:1 in dark - under the 3:1 floor WCAG sets for graphical objects. Darkening the light-mode
  // stops and pairing the glyph with primaryForeground (which flips to dark ink when the brand
  // itself becomes light) clears it in both schemes.
  const stops: [string, string] =
    theme.scheme === "dark" ? [BRAND_RAMP[300], BRAND_RAMP[500]] : [BRAND_RAMP[600], BRAND_RAMP[800]];
  const glyph = iconColor ?? theme.primaryForeground;
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.9, { damping: 15, stiffness: 300 });
    opacity.value = withSpring(0.9, { damping: 15, stiffness: 300 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 300 });
    opacity.value = withSpring(1, { damping: 15, stiffness: 300 });
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityLabel={accessibilityLabel ?? (label ? `Add ${label.toLowerCase()}` : "Add new item")}
      accessibilityRole="button"
      style={[
        label
          ? { height: 52, borderRadius: 26, overflow: "hidden", position: "absolute", bottom: 24, right: 16 }
          : {
              width: size,
              height: size,
              borderRadius: size / 2,
              overflow: "hidden",
              position: "absolute",
              bottom: 24,
              right: 24,
            },
        Shadows.fab,
        animatedStyle,
      ]}
    >
      <LinearGradient
        colors={stops}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={
          label
            ? { flex: 1, flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 20, gap: 8 }
            : { flex: 1, alignItems: "center", justifyContent: "center" }
        }
      >
        <Ionicons name={icon} size={label ? 20 : 32} color={glyph} />
        {label ? (
          <Text className="text-body font-bold" style={{ color: glyph }} numberOfLines={1}>
            {label}
          </Text>
        ) : null}
      </LinearGradient>
    </AnimatedPressable>
  );
}
