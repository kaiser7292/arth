import { useState, useCallback } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ActionRow, EmptyState, FieldRow, ScreenContainer, SectionTitle, Text, moneyTone } from "@/components/ui";
import { useAlert } from "@/hooks/use-alert";

import { formatAmount } from "@/utils/format";
import { getTransferById, deleteTransfer } from "@/services/account-transfer";
import { getActiveAccounts, getAllAccounts } from "@/services/financial-account";
import { DEFAULT_USER_ID } from "@/constants/app";
import type { AccountTransfer } from "@/services/account-transfer";
import type { FinancialAccount } from "@/services/financial-account";
import { useTheme } from "@/hooks/use-theme";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";

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
  const theme = useTheme();
  const alert = useAlert();

  const [transfer, setTransfer] = useState<AccountTransfer | null>(null);
  const [accountMap, setAccountMap] = useState<Map<string, FinancialAccount>>(new Map());

  const [loadFailed, setLoadFailed] = useState(false);
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
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      // db not ready
    }
  }, [id]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const handleDelete = useCallback(() => {
    if (!transfer) return;
    alert(
      "Delete transfer",
      "Are you sure you want to delete this transfer?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
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
      {loadFailed && <LoadFailedBanner onRetry={loadData} />}
      <Stack.Screen
        options={{
          title: "Transfer",
          headerBackTitle: "Back",
        }}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {transfer ? (
          <>
            {/* Hero: icon, what, the amount in the moved tone, one meta line */}
            <View className="px-4 pt-5 pb-4 items-center">
              <View className="w-14 h-14 rounded-card items-center justify-center mb-3" style={{ backgroundColor: moneyTone(theme, "moved").bg }}>
                <Ionicons name="swap-horizontal" size={26} color={moneyTone(theme, "moved").fg} />
              </View>
              <Text className="text-heading font-semibold text-foreground text-center" numberOfLines={2}>
                {transfer.description || "Transfer"}
              </Text>
              <Text className="text-hero font-bold mt-2" style={{ color: moneyTone(theme, "moved").fg }}>
                {formatAmount(transfer.amount)}
              </Text>
              <Text className="text-meta text-muted-foreground mt-1.5 text-center">
                {formatDate(transfer.date)} · {transfer.source === "sms_auto" ? "From SMS" : "Added by you"}
              </Text>
            </View>

            <ActionRow
              className="mx-4 mb-1"
              items={[
                { key: "from", label: "From ledger", icon: "business-outline", onPress: () => router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: transfer.from_account_id } }) },
                { key: "to", label: "To ledger", icon: "enter-outline", onPress: () => router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: transfer.to_account_id } }) },
                { key: "delete", label: "Delete", icon: "trash-outline", onPress: handleDelete, danger: true },
              ]}
            />

            <View className="mx-4 mt-3 rounded-card bg-card border border-border px-4 pt-4 pb-1">
              <SectionTitle icon="swap-horizontal-outline" title="Where it moved" className="mb-2" />
              <FieldRow divider={false} label="From" value={fromAcct ? `${accountLabel(fromAcct)}${fromAcct.bank_name ? ` · ${fromAcct.bank_name}` : ""}` : "Unknown account"} />
              <FieldRow label="To" value={toAcct ? `${accountLabel(toAcct)}${toAcct.bank_name ? ` · ${toAcct.bank_name}` : ""}` : "Unknown account"} />
            </View>

            {transfer.description ? (
              <View className="mx-4 mt-3 rounded-card bg-card border border-border px-4 pt-4 pb-1">
                <SectionTitle icon="pricetags-outline" title="What" className="mb-2" />
                <FieldRow divider={false} label="Note" value={transfer.description} multiline />
              </View>
            ) : null}
          </>
        ) : (
          <EmptyState icon="swap-horizontal-outline" title="Transfer not found" subtitle="It may have been deleted." />
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
