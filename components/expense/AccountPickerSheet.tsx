import { useState, useEffect, useCallback } from "react";
import { Sheet, Text } from "@/components/ui";
import { View, Pressable,  FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { getActiveAccounts } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import { getPickerBalances, withPickerBalance } from "@/services/account-picker-balance";
import {
  batchInvestmentProducts,
  isDematLikeAccount,
  isPensionLikeAccount,
  type InvestmentProduct,
} from "@/services/investment-accounts";
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

/** "demat"/"pension" resolved through the Phase-2 alias, else the raw account_type. */
function resolvedType(
  account: { id: string; account_type: string },
  investmentProducts: Map<string, InvestmentProduct>,
): string {
  const product = investmentProducts.get(account.id);
  if (isDematLikeAccount(account, product)) return "demat";
  if (isPensionLikeAccount(account, product)) return "pension";
  return account.account_type;
}

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
  const [balances, setBalances] = useState<Record<string, number | null>>({});
  const [investmentProducts, setInvestmentProducts] = useState<Map<string, InvestmentProduct>>(new Map());

  const loadAccounts = useCallback(async () => {
    const all = await getActiveAccounts(DEFAULT_USER_ID);
    const investmentIds = all.filter((a) => a.account_type === "investment").map((a) => a.id);
    const products = await batchInvestmentProducts(investmentIds);
    setInvestmentProducts(products);
    const filtered = all.filter((a) =>
      filterTypes.includes(resolvedType(a, products) as FinancialAccount["account_type"]) &&
      (!excludeAccountId || a.id !== excludeAccountId),
    );
    setAccounts(filtered);
    setBalances(await getPickerBalances(filtered));
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
                  name={ACCOUNT_ICONS[resolvedType(item, investmentProducts)] ?? "wallet-outline"}
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
                  {withPickerBalance(
                    ACCOUNT_TYPE_LABELS[resolvedType(item, investmentProducts)] ?? item.account_type,
                    balances[item.id],
                  )}
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
