import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { enterUp } from "./motion";

interface AppearProps {
  /** Position among siblings arriving together; each step adds MOTION.stagger (60ms). */
  index?: number;
  /** Extra wait before this one starts, on top of the stagger. */
  delay?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * Fades its children in while lifting them 12px, the first time it mounts.
 *
 * It runs on mount only, so it plays when a screen first opens and not when useDataRefresh reloads
 * data on focus (that re-renders, it doesn't re-mount). Wrap each card on a screen with a rising
 * `index` to have them arrive in sequence.
 */
export function Appear({ index = 0, delay = 0, style, children }: AppearProps) {
  return (
    <Animated.View entering={enterUp(index, delay)} style={style}>
      {children}
    </Animated.View>
  );
}
