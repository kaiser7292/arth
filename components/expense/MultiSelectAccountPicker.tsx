import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, Modal, FlatList } from "react-native";
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

interface MultiSelectAccountPickerProps {
  visible: boolean;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onClose: () => void;
  title?: string;
  filterTypes?: FinancialAccount["account_type"][];
}

const ACCOUNT_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  savings: "wallet-outline",
  credit_card: "card-outline",
  wallet: "phone-portrait-outline",
  loan: "cash-outline",
  demat: "trending-up-outline",
  pension: "briefcase-outline",
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  savings: "Savings",
  credit_card: "Credit Card",
  wallet: "Wallet",
  loan: "Loan",
  demat: "Demat",
  pension: "Pension",
};

export function MultiSelectAccountPicker({
  visible,
  selectedIds,
  onSelect,
  onClose,
  title = "Select Accounts",
  filterTypes = ["savings", "wallet", "credit_card", "loan", "demat", "pension"],
}: MultiSelectAccountPickerProps) {
  const { colors, accent, colorScheme } = useColorScheme();
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [computedBalances, setComputedBalances] = useState<Record<string, number | null>>({});
  const [tempSelected, setTempSelected] = useState<string[]>([]);
  const slideAnim = useSharedValue(300);

  const loadAccounts = useCallback(async () => {
    const all = await getActiveAccounts(DEFAULT_USER_ID);
    const filtered = all.filter((a) => filterTypes.includes(a.account_type));
    setAccounts(filtered);
    if (filtered.length > 0) {
      const balances = await getComputedBalances(filtered.map((a) => a.id));
      setComputedBalances(balances);
    } else {
      setComputedBalances({});
    }
  }, [filterTypes]);

  useEffect(() => {
    if (visible) {
      loadAccounts();
      setTempSelected(selectedIds);
      slideAnim.value = withTiming(0, { duration: 250 });
    }
  }, [visible, loadAccounts, selectedIds, slideAnim]);

  const handleClose = useCallback(() => {
    slideAnim.value = withTiming(300, { duration: 200 }, () => {
      runOnJS(onClose)();
    });
  }, [slideAnim, onClose]);

  const handleSave = useCallback(() => {
    onSelect(tempSelected);
    slideAnim.value = withTiming(300, { duration: 200 }, () => {
      runOnJS(onClose)();
    });
  }, [tempSelected, onSelect, slideAnim, onClose]);

  const handleToggle = useCallback((accountId: string) => {
    setTempSelected((prev) => {
      if (prev.includes(accountId)) {
        return prev.filter((id) => id !== accountId);
      } else {
        return [...prev, accountId];
      }
    });
  }, []);

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
          { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
        ]}
        className="pb-8"
      >
        <View className="items-center pt-3 pb-1">
          <View className="w-10 h-1 rounded-full bg-border-light dark:bg-border-dark" />
        </View>
        <View className="flex-row items-center justify-between px-5 pb-3">
          <Text
            className="text-base font-bold"
            style={{ color: colors.text }}
          >
            {title}
          </Text>
          <Pressable onPress={handleSave} className="px-3 py-1 rounded" style={{ backgroundColor: accent[500] }}>
            <Text className="text-sm font-semibold text-white">Save</Text>
          </Pressable>
        </View>

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
            renderItem={({ item }) => {
              const isSelected = tempSelected.includes(item.id);
              return (
                <Pressable
                  onPress={() => handleToggle(item.id)}
                  accessibilityLabel={`Toggle ${getLabel(item)}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  className="flex-row items-center px-5 py-3 active:opacity-70"
                >
                  <View
                    className="w-6 h-6 rounded-full items-center justify-center mr-3 border-2"
                    style={{
                      borderColor: isSelected ? accent[500] : colors.border,
                      backgroundColor: isSelected ? accent[500] : "transparent",
                    }}
                  >
                    {isSelected && (
                      <Ionicons name="checkmark" size={14} color="white" />
                    )}
                  </View>
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
                        const computed = computedBalances[item.id];
                        const balance = computed ?? item.last_known_balance;
                        return balance != null
                          ? ` · Bal: ${formatAmount(balance)}`
                          : "";
                      })()}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
        )}
      </Animated.View>
    </Modal>
  );
}
