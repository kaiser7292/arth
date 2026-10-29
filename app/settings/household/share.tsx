import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, ScreenContainer, Text, useToast } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getActiveAccounts } from "@/services/financial-account";
import { setSharingChoices } from "@/services/household/household";
import { previewThisMonth } from "@/services/household/publisher";
import { choicesOf, getActiveHousehold, getBalanceAccountIds, setBalanceAccounts } from "@/services/household/store";
import type { Household, SharingChoices } from "@/services/household/types";
import { formatAmount } from "@/utils/format";
import { formatError } from "@/utils/error-message";

const SHARED_ACCOUNT_TYPES = new Set(["savings", "bank", "credit_card", "wallet"]);

/**
 * What I share with my household, with a live "Others will see" preview of this month.
 * Design: docs/HOUSEHOLD_PHASE1_DESIGN.md §2.4.
 */
export default function ShareScreen() {
  const router = useRouter();
  const toast = useToast();
  const theme = useTheme();
  const [h, setH] = useState<Household | null>(null);
  const [choices, setChoices] = useState<SharingChoices | null>(null);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [balanceIds, setBalanceIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ category: string; amount: number; detail: "each" | "total" }[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const hh = await getActiveHousehold();
      if (!hh) return;
      setH(hh);
      setChoices(choicesOf(hh));
      setBalanceIds(await getBalanceAccountIds(hh.id));
      const all = await getActiveAccounts(DEFAULT_USER_ID);
      setAccounts(all.filter((a) => SHARED_ACCOUNT_TYPES.has(a.account_type)).map((a) => ({ id: a.id, name: a.account_label || a.bank_name })));
    })();
  }, []);

  const refreshPreview = useCallback(async (hh: Household, c: SharingChoices) => {
    setPreview(null);
    try {
      setPreview(
        await previewThisMonth({
          ...hh,
          share_household_categories: c.householdCategories ? 1 : 0,
          share_other_totals: c.otherTotals ? 1 : 0,
          share_all_transactions: c.allTransactions ? 1 : 0,
          share_savings_rate: 0,
          share_balances: 0,
        }),
      );
    } catch {
      setPreview([]);
    }
  }, []);

  useEffect(() => {
    if (h && choices) void refreshPreview(h, choices);
  }, [h, choices?.householdCategories, choices?.otherTotals, choices?.allTransactions, refreshPreview]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!h || !choices) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </ScreenContainer>
    );
  }

  const set = (patch: Partial<SharingChoices>) => setChoices({ ...choices, ...patch });

  const save = async () => {
    setBusy(true);
    try {
      await setBalanceAccounts(h.id, choices.balances ? balanceIds : []);
      await setSharingChoices(choices);
      toast("Saved. It'll reach the others when your phones next sync.");
      router.back();
    } catch (e) {
      toast(formatError("Sharing", e), { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ title, body, value, onChange, disabled }: { title: string; body: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
    <View className="flex-row items-center py-3 border-b border-border" style={{ opacity: disabled ? 0.4 : 1 }}>
      <View className="flex-1 mr-3">
        <Text className="text-sm font-medium text-foreground">{title}</Text>
        <Text className="text-xs text-muted-foreground mt-0.5 leading-4">{body}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={title} />
    </View>
  );

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Card className="mb-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Spending</Text>
          <Row
            title="Show household spending by default"
            body="Spends in household categories appear in Together, in full but not split. Split one from its screen to share the cost; hide one there too."
            value={choices.householdCategories}
            onChange={(v) => set({ householdCategories: v })}
          />
          <Row
            title="Every transaction"
            body="Your personal spends too, in full but not split, like a joint account. Income is never shared."
            value={choices.allTransactions}
            onChange={(v) => set({ allTransactions: v })}
          />
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-4">Money</Text>
          <Row
            title="Savings rate"
            body="A percentage each month, from your yearly plan. Never your salary."
            value={choices.savingsRate}
            onChange={(v) => set({ savingsRate: v })}
          />
          <Row title="Account balances" body="The balance of the accounts you pick below." value={choices.balances} onChange={(v) => set({ balances: v })} />
          {choices.balances &&
            accounts.map((a) => {
              const on = balanceIds.includes(a.id);
              return (
                <Pressable
                  key={a.id}
                  className="flex-row items-center py-2 pl-2"
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => setBalanceIds(on ? balanceIds.filter((x) => x !== a.id) : [...balanceIds, a.id])}
                >
                  <Ionicons name={on ? "checkbox" : "square-outline"} size={20} color={on ? theme.primary : theme.mutedForeground} />
                  <Text className="text-sm text-foreground ml-2">{a.name}</Text>
                </Pressable>
              );
            })}
        </Card>

        <Card className="mb-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Others will see · this month</Text>
          {preview === null ? (
            <ActivityIndicator />
          ) : preview.length === 0 ? (
            <Text className="text-sm text-muted-foreground">No spending this month with these choices.</Text>
          ) : (
            preview.slice(0, 12).map((p) => (
              <View key={p.category} className="flex-row justify-between py-1">
                <Text className="text-sm text-foreground">
                  {p.category}
                  <Text className="text-xs text-muted-foreground">{p.detail === "total" ? "  · total only" : ""}</Text>
                </Text>
                <Text className="text-sm text-foreground">{formatAmount(p.amount)}</Text>
              </View>
            ))
          )}
          <Text className="text-xs text-muted-foreground mt-2 leading-4">
            Never shared: pending items, income, message text, notes, account numbers, the Vault, loans and investments.
          </Text>
        </Card>

        <Button title="Share this" onPress={() => void save()} loading={busy} />
      </ScrollView>
    </ScreenContainer>
  );
}
