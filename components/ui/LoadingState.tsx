import { useEffect, useRef } from "react";
import { View, Text, Animated, Easing } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";

interface LoadingStateProps {
  message?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

export function LoadingState({
  message = "Loading...",
  icon = "wallet-outline",
}: LoadingStateProps) {
  const { colors, accent } = useColorScheme();
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <View className="flex-1 items-center justify-center">
      <Animated.View style={{ opacity: pulseAnim }}>
        <View
          className="w-14 h-14 rounded-2xl items-center justify-center mb-4"
          style={{ backgroundColor: accent[500] + "14" }}
        >
          <Ionicons name={icon} size={28} color={accent[500]} />
        </View>
      </Animated.View>
      <Text className="text-sm text-muted-foreground">
        {message}
      </Text>
    </View>
  );
}
