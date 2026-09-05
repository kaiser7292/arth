import { memo } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { formatAmount } from "@/utils/format";
import type { BreachedAccount } from "@/services/min-balance";
import { StatusColors } from "@/constants/theme";

/**
 * v15.5.0 — Home screen card shown when a savings account drops below
 * its user-set minimum balance.
 *
 * One card per breached account. Stacks if multiple.
 *
 * Tap card body → account ledger.
 * Tap Dismiss   → acknowledge for current month (via parent's callback).
 */

export interface MinBalanceAlertProps {
  breach: BreachedAccount;
  onDismiss: (accountId: string) => void;
}

function MinBalanceAlertImpl({ breach, onDismiss }: MinBalanceAlertProps) {
  const router = useRouter();
  const { colors, colorScheme } = useColorScheme();
  const dangerColor = StatusColors[colorScheme].danger;

  const { account, currentBalance, threshold, shortfall } = breach;
  const accountLabel = account.account_label || `${account.bank_name} •••${account.account_identifier}`;

  return (
    <View
      className="mx-4 mb-3 p-3 rounded-xl flex-row items-center"
      style={{ backgroundColor: dangerColor + "14" }}
    >
      <Pressable
        onPress={() =>
          router.push({
            pathname: "/reconciliation/account-ledger",
            params: { accountId: account.id },
          } as never)
        }
        className="flex-1 flex-row items-center"
        accessibilityRole="button"
        accessibilityLabel={`Minimum balance breached on ${accountLabel}. Tap to view ledger.`}
      >
        <Ionicons name="warning" size={18} color={dangerColor} />
        <View className="flex-1 ml-2">
          <Text
            className="text-sm font-semibold"
            numberOfLines={1}
            style={{ color: dangerColor }}
          >
            {accountLabel} is below minimum
          </Text>
          <Text className="text-xs text-muted-foreground mt-0.5">
            {formatAmount(currentBalance)} of min {formatAmount(threshold)} · shortfall {formatAmount(shortfall)}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={() => onDismiss(account.id)}
        hitSlop={8}
        className="ml-2 px-2 py-1"
        accessibilityRole="button"
        accessibilityLabel="Dismiss this alert for the rest of the month"
      >
        <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
          Dismiss
        </Text>
      </Pressable>
    </View>
  );
}

export const MinBalanceAlert = memo(MinBalanceAlertImpl);
