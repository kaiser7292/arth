import type { ReactNode } from "react";
import Animated from "react-native-reanimated";
import { popIn } from "./motion";

/** Springs its child in when it appears - wrap the tick on a selected option. */
export function Pop({ children }: { children: ReactNode }) {
  return <Animated.View entering={popIn()}>{children}</Animated.View>;
}
