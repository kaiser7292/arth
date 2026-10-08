import { Ionicons } from "@expo/vector-icons";
import { forwardRef, useEffect, useImperativeHandle } from "react";
import { View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { spring, timing } from "@/components/motion/motion";
import { Text } from "@/components/ui";
import { MOTION } from "@/constants/design-tokens";
import { useReduceMotion } from "@/hooks/use-reduce-motion";
import { useTheme } from "@/hooks/use-theme";

interface SwipeDeckProps {
  /** Identity of the card on screen. A new key mounts a brand-new card. */
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
  /** Stretch to fill the parent's height, so the whole middle of the screen is swipeable. */
  fill?: boolean;
  /** More cards wait behind this one: show the edge of the next card under it. */
  peek?: boolean;
  /**
   * How this card arrives. "behind" (default): it rises from the stack, as the next card does.
   * "right": it slides back in from the right, as a card returned by Undo does.
   */
  enterFrom?: "behind" | "right";
  children: React.ReactNode;
}

export interface SwipeDeckHandle {
  /**
   * Fling the card as a swipe would, then run the matching callback - so the footer buttons move
   * the card the same way a swipe does. A right fling that needs input runs onSwipeRight in place.
   */
  fling: (dir: "right" | "left") => void;
}

/**
 * One card that can be flung right (primary action) or left (skip).
 *
 * Each card is its own component instance (keyed by cardKey), so its position starts at 0 by
 * construction. Two earlier versions reused one instance and reset the position after the swap;
 * on Android that lost a race with Reanimated's `entering` layout animation, which snapshots the
 * style at mount (still off-screen) and restores it when it ends - the next card never appeared.
 * The entrance is therefore done by hand here, with no layout animation at all.
 */
export const SwipeDeck = forwardRef<SwipeDeckHandle, SwipeDeckProps>(function SwipeDeck(props, ref) {
  const theme = useTheme();
  return (
    <View style={props.fill ? { flex: 1 } : null}>
      {props.peek && (
        // The edge of the next card, just below this one - Catch Up reads as a stack.
        <View
          pointerEvents="none"
          className="rounded-2xl border border-border"
          style={{ position: "absolute", top: 14, bottom: -10, left: 14, right: 14, backgroundColor: theme.card, opacity: 0.7 }}
        />
      )}
      <SwipeCard key={props.cardKey} ref={ref} {...props} />
    </View>
  );
});

const SPRING = { damping: 20, stiffness: 220, mass: 0.8 };

const SwipeCard = forwardRef<SwipeDeckHandle, SwipeDeckProps>(function SwipeCard({
  onSwipeRight,
  onSwipeLeft,
  rightNeedsInput = false,
  rightLabel,
  leftLabel = "Skip",
  enabled = true,
  fill = false,
  enterFrom = "behind",
  children,
}, ref) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const { width } = useWindowDimensions();
  const threshold = width * 0.28;
  const fromRight = enterFrom === "right" && !reduceMotion;
  const translateX = useSharedValue(fromRight ? width * 1.1 : 0);
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  // Rising from behind: starts slightly smaller and lower (where the peeking card sits).
  const rise = useSharedValue(reduceMotion || fromRight ? 1 : 0);

  useEffect(() => {
    opacity.value = withTiming(1, timing(MOTION.base));
    rise.value = withSpring(1, spring("gentle"));
    if (fromRight) translateX.value = withSpring(0, spring("gentle"));
  }, [opacity, rise, translateX, fromRight]);

  useImperativeHandle(ref, () => ({
    fling: (dir) => {
      if (dir === "right" && rightNeedsInput) {
        onSwipeRight();
        return;
      }
      const done = dir === "right" ? onSwipeRight : onSwipeLeft;
      if (reduceMotion) {
        done();
        return;
      }
      translateX.value = withTiming((dir === "right" ? 1 : -1) * width * 1.3, timing(MOTION.fast + 60), (finished) => {
        if (finished) runOnJS(done)();
      });
    },
  }), [rightNeedsInput, onSwipeRight, onSwipeLeft, reduceMotion, translateX, width]);

  const pan = Gesture.Pan()
    .enabled(enabled)
    // Horizontal intent only: vertical drags still scroll the card's content.
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
    opacity: opacity.value,
    transform: [
      { translateY: (1 - rise.value) * 14 },
      { scale: 0.94 + 0.06 * rise.value },
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
      <Animated.View style={[fill ? { flex: 1 } : null, cardStyle]}>
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
});
