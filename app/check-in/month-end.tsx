import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { CheckInDeck, DeckHeadline, DeckRow } from "@/components/check-in/CheckInDeck";
import { Money, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import type { MonthEndItem } from "@/services/month-end-check";
import { confirmMonthEnd, getCycleMonth, getMonthEndItems } from "@/services/month-end-check";
import { formatDateForDisplay } from "@/utils/expense-validation";
import { formatAmount } from "@/utils/format";

const TYPE_LABEL: Record<string, string> = {
  savings: "Bank account",
  credit_card: "Credit card",
  wallet: "Wallet",
};

function monthLabel(cycle: string): string {
  const [y, m] = cycle.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}

/** Month-end check: does Arth's balance match what the bank last said? */
export default function MonthEndCheckScreen() {
  const router = useRouter();
  const theme = useTheme();
  const cycle = useMemo(() => getCycleMonth(), []);
  const load = useCallback(() => getMonthEndItems(DEFAULT_USER_ID, cycle), [cycle]);

  return (
    <CheckInDeck<MonthEndItem>
      id="monthEnd"
      title="Month-end check"
      context={monthLabel(cycle)}
      loadItems={load}
      keyOf={(i) => i.account.id}
      renderCard={(i) => {
        const a = i.account;
        const name = `${a.account_label || a.bank_name}${a.account_identifier ? ` ••${a.account_identifier.slice(-4)}` : ""}`;
        const verdict =
          i.status === "match"
            ? { icon: "checkmark-circle" as const, color: theme.success, text: "Matches your bank" }
            : i.status === "differs"
              ? {
                  icon: "alert-circle" as const,
                  color: theme.danger,
                  text: `Off by ${formatAmount(Math.abs(i.difference))}. Something may be missing or approved twice.`,
                }
              : i.status === "stale"
                ? {
                    icon: "time-outline" as const,
                    color: theme.warning,
                    text: "You've had transactions since the bank's last balance SMS, so they can't be compared exactly. Check your bank app.",
                  }
                : {
                    icon: "help-circle-outline" as const,
                    color: theme.mutedForeground,
                    text: "No balance SMS to compare with. Check your bank app.",
                  };
        return (
          <View>
            <DeckHeadline kicker={TYPE_LABEL[a.account_type] ?? "Account"} title={name} />
            <View className="mt-3">
              <DeckRow
                label="Arth's balance"
                value={i.arthBalance != null ? <Money value={i.arthBalance} className="text-sm font-semibold text-foreground" /> : "—"}
              />
              <DeckRow
                label={i.bankDate ? `Bank SMS (${formatDateForDisplay(i.bankDate)})` : "Bank SMS"}
                value={i.bankBalance != null ? <Money value={i.bankBalance} className="text-sm font-semibold text-foreground" /> : "—"}
              />
            </View>
            <View className="flex-row items-start mt-4">
              <Ionicons name={verdict.icon} size={22} color={verdict.color} />
              <Text className="text-sm ml-2 flex-1" style={{ color: verdict.color }}>
                {verdict.text}
              </Text>
            </View>
          </View>
        );
      }}
      primary={{
        label: "Looks right",
        icon: "checkmark",
        onPress: (i) => ({
          run: async () => confirmMonthEnd(i.account.id, cycle),
          message: `${i.account.account_label || i.account.bank_name} checked`,
          outcome: "Checked",
        }),
      }}
      secondary={[
        {
          label: "Open ledger",
          icon: "list-outline",
          role: "primary",
          onPress: (i) => {
            router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: i.account.id } });
            return null;
          },
        },
      ]}
      doneTitle="Books closed for the month"
      emptyIcon="calendar-outline"
      emptyTitle="All accounts checked"
      emptySubtitle="Every bank, card and wallet account has been checked for this month."
    />
  );
}
