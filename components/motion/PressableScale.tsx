import type { ReactNode } from "react";
import { Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { usePressScale } from "./motion";

interface PressableScaleProps extends Omit<PressableProps, "style" | "children"> {
  /** Layout only (margins, flex) - applied to a plain outer View. */
  className?: string;
  /** Style for the Pressable itself. */
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * A Pressable that shrinks slightly while pressed and springs back on release - the press feedback
 * for tappable cards and rows. The animated layer carries only a transform; the className goes on
 * a plain View outside it, so NativeWind styles never touch an animated component.
 */
export function PressableScale({ className, style, onPressIn, onPressOut, disabled, children, ...rest }: PressableScaleProps) {
  const press = usePressScale(!disabled);
  const inner = (
    <Animated.View style={press.style}>
      <Pressable
        {...rest}
        disabled={disabled}
        style={style}
        onPressIn={(e) => {
          press.onPressIn();
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          press.onPressOut();
          onPressOut?.(e);
        }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
  return className ? <View className={className}>{inner}</View> : inner;
}
