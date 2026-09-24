import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
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
  /** Changes per card. A new key re-centres the card and fades it in. */
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
 * that's still moving. The card is content-sized; the parent decides where it sits.
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

  // The shared value outlives the card: after a fly-off it still holds ±1.3 × width, so without
  // this the next card rendered off-screen (the "next card doesn't show up" bug).
  useEffect(() => {
    translateX.value = 0;
  }, [cardKey, translateX]);

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
        rotate: `${interpolate(translateX.value, [-width, 0, width], [-6, 0, 6], Extrapolation.CLAMP)}deg`,
      },
    ],
  }));
  const rightHint = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, threshold], [0, 1], Extrapolation.CLAMP),
  }));
  const leftHint = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-threshold, 0], [1, 0], Extrapolation.CLAMP),
  }));

  const hint = { position: "absolute" as const, top: 12, flexDirection: "row" as const };

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        key={cardKey}
        entering={reduceMotion ? undefined : FadeIn.duration(MOTION.base)}
        style={cardStyle}
      >
        {children}
        <Animated.View pointerEvents="none" style={[hint, { left: 28 }, rightHint]}>
          <View
            className="flex-row items-center px-2.5 py-1 rounded-full"
            style={{ backgroundColor: theme.alpha("success", 0.15) }}
          >
            <Ionicons name="checkmark" size={14} color={theme.success} />
            <Text className="text-xs font-semibold ml-1" style={{ color: theme.success }}>
              {rightLabel}
            </Text>
          </View>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[hint, { right: 28 }, leftHint]}>
          <View
            className="flex-row items-center px-2.5 py-1 rounded-full"
            style={{ backgroundColor: theme.alpha("mutedForeground", 0.15) }}
          >
            <Ionicons name="arrow-back" size={14} color={theme.mutedForeground} />
            <Text className="text-xs font-semibold ml-1" style={{ color: theme.mutedForeground }}>
              {leftLabel}
            </Text>
          </View>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}
