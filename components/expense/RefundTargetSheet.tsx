import { useEffect, useState } from "react";
import { Sheet, Text } from "@/components/ui";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { getAccountById } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import { AccountPickerSheet } from "./AccountPickerSheet";
import { useTheme } from "@/hooks/use-theme";

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
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [sourceAccount, setSourceAccount] = useState<FinancialAccount | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (sourceAccountId) {
      getAccountById(sourceAccountId)
        .then((a) => setSourceAccount(a && a.is_active ? a : null))
        .catch(() => setSourceAccount(null));
    } else {
      setSourceAccount(null);
    }
  }, [visible, sourceAccountId]);

  const close = onClose;

  const tint = theme.primary;

  return (
    <>
      <Sheet visible={visible && !showPicker} onClose={close}>
              <View className="px-4 pt-4 pb-2 flex-row items-center justify-between">
                <Text className="text-base font-semibold text-foreground">
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
                    style={{ borderColor: theme.primary, backgroundColor: theme.alpha("primary", 0.1) }}
                  >
                    <View
                      className="w-10 h-10 rounded-full items-center justify-center mr-3"
                      style={{ backgroundColor: theme.alpha("primary", 0.13) }}
                    >
                      <Ionicons name="return-up-back-outline" size={20} color={tint} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-foreground">
                        Same account
                      </Text>
                      <Text
                        className="text-xs text-muted-foreground mt-0.5"
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
                  className="flex-row items-center p-4 rounded-xl bg-card"
                >
                  <View className="w-10 h-10 rounded-full items-center justify-center mr-3 bg-background">
                    <Ionicons name="swap-horizontal-outline" size={20} color={colors.textSecondary} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">
                      Different account
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      Refund came into another account or wallet
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>

                {!sourceAccount && sourceAccountId && (
                  <Text className="text-xs text-muted-foreground mt-3">
                    The original account is no longer active - pick a destination.
                  </Text>
                )}
              </View>
      </Sheet>

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
