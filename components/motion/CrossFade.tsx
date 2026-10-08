import type { ReactNode } from "react";
import Animated from "react-native-reanimated";
import { fadeIn, fadeOut } from "./motion";

interface CrossFadeProps {
  /** True while data loads: the placeholder shows. */
  loading: boolean;
  /** A skeleton shaped like the content (components/ui/Skeleton). */
  placeholder: ReactNode;
  children: ReactNode;
}

/**
 * Placeholder -> content as a cross-fade, instead of a spinner followed by everything popping in.
 * The placeholder fades out in MOTION.fast while the content fades in over MOTION.base.
 */
export function CrossFade({ loading, placeholder, children }: CrossFadeProps) {
  return loading ? (
    <Animated.View key="placeholder" exiting={fadeOut()}>
      {placeholder}
    </Animated.View>
  ) : (
    <Animated.View key="content" entering={fadeIn()} style={{ flex: 1 }}>
      {children}
    </Animated.View>
  );
}
