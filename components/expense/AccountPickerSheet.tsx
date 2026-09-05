import { useState, useEffect, useCallback } from "react";
import { Sheet, Text } from "@/components/ui";
import { View, Pressable,  FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { getActiveAccounts } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import { getComputedBalances } from "@/services/account-balance";
import { formatAmount } from "@/utils/format";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";

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
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  // Computed balances from the ledger (opening - expenses + credits - transfers).
  // Always preferred over last_known_balance, which reflects only the latest SMS
  // and ignores subsequent debits, credits, and transfers.
  const [computedBalances, setComputedBalances] = useState<Record<string, number | null>>({});

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

    }
  }, [visible, loadAccounts]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleSelect = useCallback(
    (accountId: string) => {
      onSelect(accountId);
    },
    [onSelect],
  );



  const getLabel = (a: FinancialAccount) =>
    a.account_label || `${a.bank_name} ****${a.account_identifier}`;

  if (!visible) return null;

  return (
    <Sheet visible={visible} onClose={handleClose}>
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
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
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
                style={{ backgroundColor: theme.primary + "1A" }}
              >
                <Ionicons
                  name={ACCOUNT_ICONS[item.account_type] ?? "wallet-outline"}
                  size={18}
                  color={theme.primary}
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
    </Sheet>
  );
}
