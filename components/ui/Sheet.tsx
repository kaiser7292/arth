import { useCallback, useEffect, useState } from "react";
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
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
 * LAYOUT - the part that has to stay the way it is.
 *
 * The panel is a NORMAL-FLOW child of a full-height column with justifyContent "flex-end", and the
 * backdrop sits behind it as an absolute fill. That is what pins the sheet to the bottom: the
 * container's height decides where the panel goes, so the panel's own content cannot move it.
 *
 * An earlier version positioned the panel absolutely (bottom: 0) inside a KeyboardAvoidingView
 * instead, and that broke two things at once. On Android a KeyboardAvoidingView with no `behavior`
 * renders a plain View, so the panel's parent was an auto-height box with no definite height -
 * and Yoga cannot resolve a percentage maxHeight against an indefinite parent, so it drops the cap
 * silently. The panel then grew to its full content height, the inner ScrollView never shrank or
 * scrolled, and where the sheet landed followed its content instead of the screen.
 *
 * So maxHeight is computed in PIXELS, from the Modal container's own measured height. A
 * percentage only works when every ancestor happens to have a definite height; pixels always
 * work. Measuring the container rather than the window also means the cap tracks a
 * keyboard-resized window without any extra wiring.
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
  // Live, not module-scope Dimensions: a value captured at import time is wrong after a rotation,
  // and wrong on any device whose window differs from the one present at startup.
  const { height: winH } = useWindowDimensions();
  const translateY = useSharedValue(winH);
  const dragStart = useSharedValue(0);
  const [height, setHeight] = useState(0);
  // The Modal's own container, which is what the panel is actually capped against. Measuring it
  // rather than the window means the cap follows a keyboard-resized window for free.
  const [containerH, setContainerH] = useState(0);
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
        : withSpring(0, { damping: 22, stiffness: 260, mass: 0.7, overshootClamping: true });
    } else {
      translateY.value = winH;
    }
  }, [visible, reduceMotion, translateY, winH]);

  const close = useCallback(() => {
    if (reduceMotion) {
      onClose();
      return;
    }
    translateY.value = withTiming(winH, { duration: MOTION.fast }, (done) => {
      if (done) runOnJS(onClose)();
    });
  }, [onClose, reduceMotion, translateY, winH]);

  // Until the panel reports a layout, fall back to the window height so a drag arriving before
  // first layout still has a sane distance to measure a dismiss against.
  const dismissBasis = height > 0 ? height : winH;

  const pan = Gesture.Pan()
    .enabled(draggable && !reduceMotion)
    .onStart(() => {
      dragStart.value = translateY.value;
    })
    .onUpdate((e) => {
      translateY.value = Math.max(0, dragStart.value + e.translationY);
    })
    .onEnd((e) => {
      const far = translateY.value > dismissBasis * DISMISS_FRACTION;
      const flung = e.velocityY > DISMISS_VELOCITY;
      if (far || flung) {
        translateY.value = withTiming(winH, { duration: MOTION.fast }, (done) => {
          if (done) runOnJS(onClose)();
        });
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 260, overshootClamping: true });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, dismissBasis], [1, 0], "clamp"),
  }));

  if (!visible) return null;

  return (
    <Modal
      transparent
      animationType="none"
      visible={visible}
      onRequestClose={close}
      // Deliberately NOT statusBarTranslucent. That makes the Modal window fullscreen on
      // Android, and a fullscreen window ignores adjustResize - the keyboard then covers the
      // bottom of the sheet instead of shrinking it, which hides exactly the fields a sheet
      // puts last (Notes, Until). The cap below measures the container rather than the window,
      // so it stays correct without needing the window to be fullscreen.
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View
          style={{ flex: 1, justifyContent: "flex-end" }}
          onLayout={(e) => setContainerH(e.nativeEvent.layout.height)}
        >
          <Animated.View
            style={[
              StyleSheet.absoluteFillObject,
              { backgroundColor: "rgba(0,0,0,0.45)" },
              backdropStyle,
            ]}
          >
            <Pressable
              style={{ flex: 1 }}
              onPress={close}
              accessibilityLabel="Close"
              accessibilityRole="button"
            />
          </Animated.View>

          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            // box-none so this wrapper never swallows a tap meant for the backdrop behind it.
            pointerEvents="box-none"
          >
            <Animated.View
              onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
              style={[
                sheetStyle,
                {
                  backgroundColor: theme.card,
                  borderTopLeftRadius: 20,
                  borderTopRightRadius: 20,
                  maxHeight: Math.round((containerH || winH) * (maxHeightPct / 100)),
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
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * The previous name, kept so the sheets already using it upgrade without being edited.
 * New code should import Sheet.
 */
export const BottomSheet = Sheet;
