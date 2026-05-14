import { useEffect, useState } from "react";
import { View, Text, Pressable, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import { getAccountById } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import { AccountPickerSheet } from "./AccountPickerSheet";

interface Props {
  visible: boolean;
  sourceAccountId: string | null;
  onPick: (accountId: string | null) => void;
  onClose: () => void;
}

/**
 * Asks the user where the refund landed: same account as the original
 * expense, or a different one. On "Different", chains through
 * AccountPickerSheet. The chosen account id is passed to add-expense so the
 * credit row lands in the right place.
 *
 * If the original expense's account has been deleted/made inactive, we
 * auto-skip to the "Different" picker so the user can still proceed.
 */
export function RefundTargetSheet({ visible, sourceAccountId, onPick, onClose }: Props) {
  const { colors, accent, colorScheme } = useColorScheme();
  const [sourceAccount, setSourceAccount] = useState<FinancialAccount | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const slide = useSharedValue(300);

  useEffect(() => {
    if (!visible) return;
    slide.value = withTiming(0, { duration: 250 });
    if (sourceAccountId) {
      getAccountById(sourceAccountId)
        .then((a) => setSourceAccount(a && a.is_active ? a : null))
        .catch(() => setSourceAccount(null));
    } else {
      setSourceAccount(null);
    }
  }, [visible, sourceAccountId, slide]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: slide.value }] }));

  const close = () => {
    slide.value = withTiming(300, { duration: 200 }, (done) => {
      if (done) runOnJS(onClose)();
    });
  };

  const tint = ac(accent, colorScheme, 500, 200);

  return (
    <>
      <Modal visible={visible && !showPicker} transparent animationType="fade" onRequestClose={close}>
        <Pressable onPress={close} className="flex-1 bg-black/50 justify-end">
          <Animated.View
            style={[{ backgroundColor: colors.background }, style]}
            className="rounded-t-2xl"
          >
            <Pressable onPress={(e) => e.stopPropagation()}>
              <View className="px-4 pt-4 pb-2 flex-row items-center justify-between">
                <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary">
                  Where did the refund land?
                </Text>
                <Pressable onPress={close} hitSlop={12}>
                  <Ionicons name="close" size={22} color={colors.textSecondary} />
                </Pressable>
              </View>

              <View className="px-4 pb-6 pt-2">
                {/* Same account */}
                {sourceAccount && (
                  <Pressable
                    onPress={() => onPick(sourceAccount.id)}
                    className="flex-row items-center p-4 mb-3 rounded-xl border"
                    style={{ borderColor: accent[500], backgroundColor: ac(accent, colorScheme, 50, 700) }}
                  >
                    <View
                      className="w-10 h-10 rounded-full items-center justify-center mr-3"
                      style={{ backgroundColor: accent[500] + "22" }}
                    >
                      <Ionicons name="return-up-back-outline" size={20} color={tint} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                        Same account
                      </Text>
                      <Text
                        className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5"
                        numberOfLines={1}
                      >
                        Credited back to {sourceAccount.account_label ?? `****${sourceAccount.account_identifier.slice(-4)}`}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                  </Pressable>
                )}

                {/* Different account */}
                <Pressable
                  onPress={() => setShowPicker(true)}
                  className="flex-row items-center p-4 rounded-xl bg-surface-light-alt dark:bg-surface-dark-alt"
                >
                  <View className="w-10 h-10 rounded-full items-center justify-center mr-3 bg-surface-light dark:bg-surface-dark">
                    <Ionicons name="swap-horizontal-outline" size={20} color={colors.textSecondary} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                      Different account
                    </Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                      Refund came into another account or wallet
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>

                {!sourceAccount && sourceAccountId && (
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-3">
                    The original account is no longer active — pick a destination.
                  </Text>
                )}
              </View>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>

      <AccountPickerSheet
        visible={showPicker}
        title="Refund credited to"
        filterTypes={["savings", "credit_card", "wallet"]}
        onSelect={(id) => {
          setShowPicker(false);
          onPick(id);
        }}
        onClose={() => setShowPicker(false)}
      />
    </>
  );
}
