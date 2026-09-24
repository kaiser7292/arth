import { Ionicons } from "@expo/vector-icons";
import { View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  FadeIn,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Text } from "@/components/ui";
import { MOTION } from "@/constants/design-tokens";
import { useReduceMotion } from "@/hooks/use-reduce-motion";
import { useTheme } from "@/hooks/use-theme";

interface SwipeDeckProps {
  /** Changes per card; remounts the animated surface so each card starts centred. */
  cardKey: string;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  /**
   * The right swipe can't finish on its own (needs a category or a source account). The card
   * springs back and onSwipeRight opens the picker instead of flying off.
   */
  rightNeedsInput?: boolean;
  rightLabel: string;
  leftLabel?: string;
  enabled?: boolean;
  children: React.ReactNode;
}

const SPRING = { damping: 20, stiffness: 220, mass: 0.8 };

/**
 * One card that can be flung right (primary action) or left (skip).
 *
 * The action fires after the fly-off finishes so the next card never appears under a card
 * that's still moving.
 */
export function SwipeDeck({
  cardKey,
  onSwipeRight,
  onSwipeLeft,
  rightNeedsInput = false,
  rightLabel,
  leftLabel = "Skip",
  enabled = true,
  children,
}: SwipeDeckProps) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const { width } = useWindowDimensions();
  const threshold = width * 0.28;
  const translateX = useSharedValue(0);

  const pan = Gesture.Pan()
    .enabled(enabled)
    // Horizontal intent only: lets the card's own ScrollView (raw SMS) keep vertical drags.
    .activeOffsetX([-12, 12])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      const goRight = translateX.value > threshold || (e.velocityX > 900 && translateX.value > 0);
      const goLeft = translateX.value < -threshold || (e.velocityX < -900 && translateX.value < 0);
      if (goRight && rightNeedsInput) {
        translateX.value = withSpring(0, SPRING);
        runOnJS(onSwipeRight)();
      } else if (goRight) {
        translateX.value = withTiming(width * 1.3, { duration: MOTION.fast }, (done) => {
          if (done) runOnJS(onSwipeRight)();
        });
      } else if (goLeft) {
        translateX.value = withTiming(-width * 1.3, { duration: MOTION.fast }, (done) => {
          if (done) runOnJS(onSwipeLeft)();
        });
      } else {
        translateX.value = withSpring(0, SPRING);
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      {
        rotate: `${interpolate(translateX.value, [-width, 0, width], [-8, 0, 8], Extrapolation.CLAMP)}deg`,
      },
    ],
  }));
  const rightHint = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, threshold], [0, 1], Extrapolation.CLAMP),
  }));
  const leftHint = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-threshold, 0], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <View style={{ flex: 1 }}>
      <GestureDetector gesture={pan}>
        <Animated.View
          key={cardKey}
          entering={reduceMotion ? undefined : FadeIn.duration(MOTION.base)}
          style={[{ flex: 1 }, cardStyle]}
        >
          {children}
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                top: 20,
                left: 20,
                borderWidth: 2,
                borderColor: theme.success,
                borderRadius: 10,
                paddingHorizontal: 10,
                paddingVertical: 4,
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: theme.card,
              },
              rightHint,
            ]}
          >
            <Ionicons name="checkmark" size={16} color={theme.success} />
            <Text className="text-sm font-bold ml-1" style={{ color: theme.success }}>
              {rightLabel}
            </Text>
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                top: 20,
                right: 20,
                borderWidth: 2,
                borderColor: theme.mutedForeground,
                borderRadius: 10,
                paddingHorizontal: 10,
                paddingVertical: 4,
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: theme.card,
              },
              leftHint,
            ]}
          >
            <Ionicons name="play-skip-forward" size={14} color={theme.mutedForeground} />
            <Text className="text-sm font-bold ml-1" style={{ color: theme.mutedForeground }}>
              {leftLabel}
            </Text>
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
