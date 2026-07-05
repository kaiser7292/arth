import { useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import { StatusColors } from "@/constants/theme";
import { formatAmount } from "@/utils/format";
import { getTransferById, deleteTransfer } from "@/services/account-transfer";
import { createAutoBackup } from "@/services/auto-backup";
import { getActiveAccounts, getAllAccounts } from "@/services/financial-account";
import { DEFAULT_USER_ID } from "@/constants/app";
import type { AccountTransfer } from "@/services/account-transfer";
import type { FinancialAccount } from "@/services/financial-account";

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}

function accountLabel(acct: FinancialAccount | undefined): string {
  if (!acct) return "Unknown account";
  return acct.account_label || `${acct.bank_name} ****${acct.account_identifier}`;
}

export default function TransferDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors, accent, colorScheme } = useColorScheme();
  const alert = useAlert();
  const sc = StatusColors[colorScheme];

  const [transfer, setTransfer] = useState<AccountTransfer | null>(null);
  const [accountMap, setAccountMap] = useState<Map<string, FinancialAccount>>(new Map());

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [t, active, all] = await Promise.all([
        getTransferById(id),
        getActiveAccounts(DEFAULT_USER_ID),
        getAllAccounts(DEFAULT_USER_ID),
      ]);
      setTransfer(t);
      const map = new Map<string, FinancialAccount>();
      for (const a of [...active, ...all]) {
        if (!map.has(a.id)) map.set(a.id, a);
      }
      setAccountMap(map);
    } catch {
      // db not ready
    }
  }, [id]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const handleDelete = useCallback(() => {
    if (!transfer) return;
    alert(
      "Delete Transfer",
      "Are you sure you want to delete this transfer?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              void createAutoBackup("delete-transfer");
              await deleteTransfer(transfer.id);
              router.back();
            } catch (e) {
              alert("Error", e instanceof Error ? e.message : "Could not delete transfer.");
            }
          },
        },
      ],
    );
  }, [transfer, alert, router]);

  const fromAcct = transfer ? accountMap.get(transfer.from_account_id) : undefined;
  const toAcct = transfer ? accountMap.get(transfer.to_account_id) : undefined;

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen
        options={{
          title: "Transfer Details",
          headerBackTitle: "Back",
          headerRight: () => (
            <Pressable onPress={handleDelete} hitSlop={8}>
              <Ionicons name="trash-outline" size={20} color={sc.danger} />
            </Pressable>
          ),
        }}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {transfer ? (
          <>
            {/* Amount card */}
            <Card className="mx-4 mt-3 mb-2">
              <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary uppercase tracking-wider mb-2">
                Amount
              </Text>
              <Text className="text-2xl font-bold" style={{ color: accent[500] }}>
                {formatAmount(transfer.amount)}
              </Text>
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-1">
                {formatDate(transfer.date)}
              </Text>
            </Card>

            {/* From → To card */}
            <Card className="mx-4 mb-2">
              <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary uppercase tracking-wider mb-3">
                Accounts
              </Text>
              <View className="flex-row items-center">
                <View className="flex-1">
                  <Text className="text-[10px] text-text-tertiary dark:text-text-dark-secondary uppercase tracking-wider mb-0.5">
                    From
                  </Text>
                  <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                    {accountLabel(fromAcct)}
                  </Text>
                  {fromAcct?.bank_name && (
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                      {fromAcct.bank_name}
                    </Text>
                  )}
                </View>
                <Ionicons name="arrow-forward" size={20} color={colors.textSecondary} style={{ marginHorizontal: 12 }} />
                <View className="flex-1">
                  <Text className="text-[10px] text-text-tertiary dark:text-text-dark-secondary uppercase tracking-wider mb-0.5">
                    To
                  </Text>
                  <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                    {accountLabel(toAcct)}
                  </Text>
                  {toAcct?.bank_name && (
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                      {toAcct.bank_name}
                    </Text>
                  )}
                </View>
              </View>
            </Card>

            {/* Description card */}
            {transfer.description ? (
              <Card className="mx-4 mb-2">
                <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary uppercase tracking-wider mb-1">
                  Note
                </Text>
                <Text className="text-sm text-text-primary dark:text-text-dark-primary">
                  {transfer.description}
                </Text>
              </Card>
            ) : null}

            {/* Source badge */}
            <View className="mx-4 mb-2">
              <Text className="text-xs text-text-tertiary dark:text-text-dark-secondary">
                Source: {transfer.source === "sms_auto" ? "Auto-detected from SMS" : "Manual entry"}
              </Text>
            </View>
          </>
        ) : (
          <View className="items-center py-16">
            <Ionicons name="swap-horizontal-outline" size={40} color={colors.textSecondary} />
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-3">
              Transfer not found
            </Text>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
