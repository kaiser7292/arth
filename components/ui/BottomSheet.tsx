import { useColorScheme } from "@/hooks/use-color-scheme";
import { useEffect } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Max sheet height as a % of screen height. Default: 92 */
  maxHeightPct?: number;
  children: React.ReactNode;
}

/**
 * Shared bottom-sheet wrapper used by all slide-up form sheets.
 *
 * Usage:
 *   <BottomSheet visible={visible} onClose={handleClose}>
 *     {header}
 *     <ScrollView>…</ScrollView>
 *     {actionRow}
 *   </BottomSheet>
 *
 * Callers are responsible for their own Modal-level sub-pickers (CalendarModal,
 * SearchablePicker, etc.) — render them as siblings outside <BottomSheet>.
 */
export function BottomSheet({
  visible,
  onClose,
  maxHeightPct = 92,
  children,
}: BottomSheetProps) {
  const { colors } = useColorScheme();
  const insets = useSafeAreaInsets();
  const slideAnim = useSharedValue(600);

  useEffect(() => {
    if (visible) {
      slideAnim.value = withTiming(0, { duration: 240 });
    }
  }, [visible, slideAnim]);

  const handleClose = () => {
    slideAnim.value = withTiming(600, { duration: 200 }, () => {
      runOnJS(onClose)();
    });
  };

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: slideAnim.value }],
  }));

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={handleClose}>
      <Pressable
        className="flex-1 bg-black/40"
        onPress={handleClose}
        accessibilityLabel="Close"
        accessibilityRole="button"
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
      >
        <Animated.View
          style={[
            animStyle,
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              maxHeight: `${maxHeightPct}%`,
            },
          ]}
        >
          <View className="items-center pt-3 pb-1">
            <View className="w-10 h-1 rounded-full bg-border" />
          </View>
          <View style={{ paddingBottom: insets.bottom + 4, backgroundColor: colors.surface }}>
            {children}
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
