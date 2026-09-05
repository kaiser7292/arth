import { useState, useEffect, useCallback } from "react";
import { Text } from "@/components/ui";
import { View, Pressable, Modal, FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { getActiveAccounts } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import { getComputedBalances } from "@/services/account-balance";
import { formatAmount } from "@/utils/format";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import { DEFAULT_USER_ID } from "@/constants/app";

interface AccountPickerSheetProps {
  visible: boolean;
  onSelect: (accountId: string) => void;
  onClose: () => void;
  title?: string;
  filterTypes?: FinancialAccount["account_type"][];
  excludeAccountId?: string;
}

const ACCOUNT_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  savings: "wallet-outline",
  credit_card: "card-outline",
  wallet: "phone-portrait-outline",
  loan: "cash-outline",
  demat: "trending-up-outline",
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  savings: "Savings",
  credit_card: "Credit Card",
  wallet: "Wallet",
  loan: "Loan",
  demat: "Demat",
};

export function AccountPickerSheet({
  visible,
  onSelect,
  onClose,
  title = "Select Account",
  filterTypes = ["savings", "wallet"],
  excludeAccountId,
}: AccountPickerSheetProps) {
  const { colors, accent, colorScheme } = useColorScheme();
  const insets = useSafeAreaInsets();
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  // Computed balances from the ledger (opening - expenses + credits - transfers).
  // Always preferred over last_known_balance, which reflects only the latest SMS
  // and ignores subsequent debits, credits, and transfers.
  const [computedBalances, setComputedBalances] = useState<Record<string, number | null>>({});
  const slideAnim = useSharedValue(300);

  const loadAccounts = useCallback(async () => {
    const all = await getActiveAccounts(DEFAULT_USER_ID);
    const filtered = all.filter((a) =>
      filterTypes.includes(a.account_type) &&
      (!excludeAccountId || a.id !== excludeAccountId),
    );
    setAccounts(filtered);
    if (filtered.length > 0) {
      const balances = await getComputedBalances(filtered.map((a) => a.id));
      setComputedBalances(balances);
    } else {
      setComputedBalances({});
    }
  }, [filterTypes, excludeAccountId]);

  useEffect(() => {
    if (visible) {
      loadAccounts();
      slideAnim.value = withTiming(0, { duration: 250 });
    }
  }, [visible, loadAccounts, slideAnim]);

  const handleClose = useCallback(() => {
    slideAnim.value = withTiming(300, { duration: 200 }, () => {
      runOnJS(onClose)();
    });
  }, [slideAnim, onClose]);

  const handleSelect = useCallback(
    (accountId: string) => {
      slideAnim.value = withTiming(300, { duration: 200 }, () => {
        runOnJS(onSelect)(accountId);
      });
    },
    [slideAnim, onSelect],
  );

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: slideAnim.value }],
  }));

  const getLabel = (a: FinancialAccount) =>
    a.account_label || `${a.bank_name} ****${a.account_identifier}`;

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={handleClose}>
      <Pressable
        className="flex-1 bg-black/40"
        onPress={handleClose}
        accessibilityLabel="Close picker"
        accessibilityRole="button"
      />
      <Animated.View
        style={[
          animStyle,
          { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: Math.max(insets.bottom, 8) },
        ]}
      >
        <View className="items-center pt-3 pb-1">
          <View className="w-10 h-1 rounded-full bg-border" />
        </View>
        <Text
          className="text-base font-bold px-5 pb-3"
          style={{ color: colors.text }}
        >
          {title}
        </Text>

        {accounts.length === 0 ? (
          <View className="items-center py-8">
            <Ionicons name="wallet-outline" size={36} color={colors.textSecondary} />
            <Text className="text-sm mt-2" style={{ color: colors.textSecondary }}>
              No accounts found
            </Text>
          </View>
        ) : (
          <FlatList
            data={accounts}
            keyExtractor={(item) => item.id}
            scrollEnabled={accounts.length > 5}
            style={{ maxHeight: 320 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => handleSelect(item.id)}
                accessibilityLabel={`Select ${getLabel(item)}`}
                accessibilityRole="button"
                className="flex-row items-center px-5 py-3 active:opacity-70"
              >
                <View
                  className="w-9 h-9 rounded-full items-center justify-center mr-3"
                  style={{ backgroundColor: ac(accent, colorScheme, 500, 200) + "1A" }}
                >
                  <Ionicons
                    name={ACCOUNT_ICONS[item.account_type] ?? "wallet-outline"}
                    size={18}
                    color={ac(accent, colorScheme, 500, 200)}
                  />
                </View>
                <View className="flex-1">
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: colors.text }}
                  >
                    {getLabel(item)}
                  </Text>
                  <Text className="text-xs" style={{ color: colors.textSecondary }}>
                    {ACCOUNT_TYPE_LABELS[item.account_type] ?? item.account_type}
                    {(() => {
                      // Prefer the ledger-computed balance (accounts for expenses,
                      // credits, and transfers since the last SMS). Fall back to
                      // last_known_balance only when the account is unseeded.
                      const computed = computedBalances[item.id];
                      const balance = computed ?? item.last_known_balance;
                      return balance != null
                        ? ` · Bal: ${formatAmount(balance)}`
                        : "";
                    })()}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </Pressable>
            )}
          />
        )}
      </Animated.View>
    </Modal>
  );
}
