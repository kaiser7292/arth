import { View, KeyboardAvoidingView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ViewProps } from "react-native";

interface ScreenContainerProps extends ViewProps {
  /** Wrap in SafeAreaView for bezel-less phones. Defaults to true. */
  safe?: boolean;
  centered?: boolean;
  /** Screens with a Tab/Stack header already handle safe area — pass padTop={false} to avoid double padding. */
  padTop?: boolean;
  /** Wraps children in KeyboardAvoidingView so bottom fields aren't hidden by the keyboard. */
  keyboardAware?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function ScreenContainer({
  safe = true,
  centered = false,
  padTop = true,
  keyboardAware = false,
  className = "",
  children,
  ...props
}: ScreenContainerProps) {
  const baseClasses = `flex-1 bg-background ${centered ? "items-center justify-center" : ""} ${className}`;

  const inner = keyboardAware ? (
    <KeyboardAvoidingView
      behavior="padding"
      className="flex-1"
    >
      {children}
    </KeyboardAvoidingView>
  ) : (
    children
  );

  if (safe) {
    return (
      <SafeAreaView
        className={baseClasses}
        edges={padTop ? ["top", "left", "right"] : ["left", "right"]}
        {...props}
      >
        {inner}
      </SafeAreaView>
    );
  }

  return (
    <View className={baseClasses} {...props}>
      {inner}
    </View>
  );
}
