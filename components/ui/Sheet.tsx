import { useCallback, useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  View,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/use-theme";
import { MOTION } from "@/constants/design-tokens";

const SCREEN_H = Dimensions.get("window").height;
/** Drag far enough, or fling hard enough, and the sheet goes. */
const DISMISS_FRACTION = 0.28;
const DISMISS_VELOCITY = 900;

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  /** Max sheet height as a % of screen height. Default: 92 */
  maxHeightPct?: number;
  /** Disable drag-to-dismiss for sheets whose content scrolls horizontally. */
  draggable?: boolean;
  children: React.ReactNode;
}

/**
 * The app's bottom sheet.
 *
 * Replaces a Modal + timing-animation wrapper that could only be dismissed by tapping the
 * backdrop. It is now drag-dismissable, which is what makes a sheet feel like a sheet: the grabber
 * was always drawn but never did anything.
 *
 * react-native-gesture-handler was already a dependency and used in exactly two places, so nothing
 * new is pulled in. The gesture root is re-declared INSIDE the Modal deliberately - on Android a
 * Modal renders in its own window, outside the root view's handler tree, so a gesture declared
 * only at the app root never reaches sheet content.
 *
 * The backdrop's opacity is driven by drag position rather than a fixed value, so dragging the
 * sheet down fades the scrim with it instead of holding at full strength until release.
 *
 * Honours reduce-motion: the spring and the drag are skipped when the OS asks for less animation.
 */
export function Sheet({
  visible,
  onClose,
  maxHeightPct = 92,
  draggable = true,
  children,
}: SheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(SCREEN_H);
  const dragStart = useSharedValue(0);
  const [height, setHeight] = useState(SCREEN_H * 0.5);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduceMotion(v));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (visible) {
      translateY.value = reduceMotion
        ? 0
        : withSpring(0, { damping: 22, stiffness: 260, mass: 0.7 });
    } else {
      translateY.value = SCREEN_H;
    }
  }, [visible, reduceMotion, translateY]);

  const close = useCallback(() => {
    if (reduceMotion) {
      onClose();
      return;
    }
    translateY.value = withTiming(SCREEN_H, { duration: MOTION.fast }, (done) => {
      if (done) runOnJS(onClose)();
    });
  }, [onClose, reduceMotion, translateY]);

  const pan = Gesture.Pan()
    .enabled(draggable && !reduceMotion)
    .onStart(() => {
      dragStart.value = translateY.value;
    })
    .onUpdate((e) => {
      translateY.value = Math.max(0, dragStart.value + e.translationY);
    })
    .onEnd((e) => {
      const far = translateY.value > height * DISMISS_FRACTION;
      const flung = e.velocityY > DISMISS_VELOCITY;
      if (far || flung) {
        translateY.value = withTiming(SCREEN_H, { duration: MOTION.fast }, (done) => {
          if (done) runOnJS(onClose)();
        });
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 260 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, height], [1, 0], "clamp"),
  }));

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={close}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={[{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }, backdropStyle]}>
          <Pressable
            style={{ flex: 1 }}
            onPress={close}
            accessibilityLabel="Close"
            accessibilityRole="button"
          />
        </Animated.View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
        >
          <Animated.View
              onLayout={(e) => setHeight(e.nativeEvent.layout.height || SCREEN_H * 0.5)}
              style={[
                sheetStyle,
                {
                  backgroundColor: theme.card,
                  borderTopLeftRadius: 20,
                  borderTopRightRadius: 20,
                  maxHeight: `${maxHeightPct}%`,
                  // Safe-area pad belongs on the PANEL, not on a wrapper around the children.
                  // The hand-rolled sheets did it this way, and it matters: an extra non-flex View
                  // between a height-capped panel and content that ends in a pinned action row
                  // lets that row overflow past the panel and get clipped.
                  paddingBottom: insets.bottom + 4,
                },
              ]}
            >
              {/*
                Only the grab area is draggable.
                A pan across the whole panel competes with every ScrollView and FlatList inside a
                sheet: react-native-gesture-handler has no way to know the list is not already at
                its top, so a downward swipe over content got claimed by the sheet instead of
                scrolling. Restricting the gesture to the handle removes the conflict entirely,
                and matches how a sheet is normally dragged anyway. The area is padded to roughly
                40px so it stays an easy target.
              */}
              <GestureDetector gesture={pan}>
                <View className="items-center pt-3 pb-3" hitSlop={8}>
                  <View
                    className="w-10 h-1 rounded-full"
                    style={{ backgroundColor: theme.border }}
                  />
                </View>
              </GestureDetector>
              {children}
            </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * The previous name, kept so the sheets already using it upgrade without being edited.
 * New code should import Sheet.
 */
export const BottomSheet = Sheet;
