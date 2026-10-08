import { useEffect, useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { MOTION } from "@/constants/design-tokens";
import { timing } from "./motion";

interface CollapseProps {
  open: boolean;
  children: ReactNode;
}

/**
 * Smooth expand / collapse (height + fade) for "More options", show SMS, closed accounts and
 * similar sections. The content is measured at its natural height off to the side, so it opens to
 * exactly its size. While closed, it's hidden from screen readers and taps.
 */
export function Collapse({ open, children }: CollapseProps) {
  const [height, setHeight] = useState(0);
  const progress = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, timing(open ? MOTION.base + 40 : MOTION.base));
  }, [open, progress]);

  const style = useAnimatedStyle(() => ({
    height: height * progress.value,
    opacity: progress.value,
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    if (h !== height) setHeight(h);
  };

  return (
    <Animated.View
      style={[{ overflow: "hidden" }, style]}
      pointerEvents={open ? "auto" : "none"}
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      accessibilityElementsHidden={!open}
    >
      <View onLayout={onLayout} style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
        {children}
      </View>
    </Animated.View>
  );
}
