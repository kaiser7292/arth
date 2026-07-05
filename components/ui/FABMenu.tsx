import { useState } from "react";
import { Pressable, View, Text, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useColorScheme } from "@/hooks/use-color-scheme";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import { Shadows } from "@/constants/theme";

export interface FABMenuItem {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}

interface FABMenuProps {
  items: FABMenuItem[];
  hidden?: boolean;
  accessibilityLabel?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const FAB_SIZE = 64;

export function FABMenu({ items, hidden = false, accessibilityLabel = "Add" }: FABMenuProps) {
  const [open, setOpen] = useState(false);
  const { accent, colors } = useColorScheme();

  const progress = useSharedValue(0);
  const scale = useSharedValue(1);

  const fabStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { rotate: `${interpolate(progress.value, [0, 1], [0, 45], Extrapolation.CLAMP)}deg` },
    ],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
  }));

  const menuStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [12, 0], Extrapolation.CLAMP) },
    ],
  }));

  const toggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !open;
    setOpen(next);
    progress.value = withSpring(next ? 1 : 0, { damping: 18, stiffness: 320 });
  };

  const handleItemPress = (onPress: () => void) => {
    setOpen(false);
    progress.value = withSpring(0, { damping: 18, stiffness: 320 });
    onPress();
  };

  if (hidden) return null;

  return (
    <>
      {/* Backdrop — always rendered but pointer-events gated by JS state */}
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={[
          { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 40, backgroundColor: "rgba(0,0,0,0.25)" },
          backdropStyle,
        ]}
      >
        <Pressable style={{ flex: 1 }} onPress={toggle} />
      </Animated.View>

      {/* Menu items — always rendered, animated in/out */}
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={[
          {
            position: "absolute",
            bottom: 24 + FAB_SIZE + 12,
            right: 24,
            zIndex: 41,
            alignItems: "flex-end",
          },
          menuStyle,
        ]}
      >
        {items.map((item, idx) => (
          <Pressable
            key={idx}
            onPress={() => handleItemPress(item.onPress)}
            style={[
              {
                flexDirection: "row",
                alignItems: "center",
                marginBottom: 8,
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: colors.surface,
                minWidth: 160,
              },
              Platform.select({
                ios: {
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.1,
                  shadowRadius: 8,
                },
                default: { elevation: 4 },
              }),
            ]}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                marginRight: 12,
                backgroundColor: item.color + "20",
              }}
            >
              <Ionicons name={item.icon} size={16} color={item.color} />
            </View>
            <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </Animated.View>

      {/* FAB button */}
      <AnimatedPressable
        onPress={toggle}
        onPressIn={() => { scale.value = withSpring(0.9, { damping: 15, stiffness: 300 }); }}
        onPressOut={() => { scale.value = withSpring(1, { damping: 15, stiffness: 300 }); }}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        style={[
          {
            width: FAB_SIZE,
            height: FAB_SIZE,
            borderRadius: FAB_SIZE / 2,
            overflow: "hidden",
            position: "absolute",
            bottom: 24,
            right: 24,
            zIndex: 42,
          },
          Shadows.fab,
          fabStyle,
        ]}
      >
        <LinearGradient
          colors={[accent[400], accent[600]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="add" size={32} color="#FFFFFF" />
        </LinearGradient>
      </AnimatedPressable>
    </>
  );
}
