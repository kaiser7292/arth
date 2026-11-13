import { useCallback, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Card, EmptyState, Input, ScreenContainer, Text, useToast } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useAlert } from "@/hooks/use-alert";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getBalanceLines, saveBalanceUpdates, type BalanceLine } from "@/services/balance-update";
import { parseAmount } from "@/utils/expense-validation";
import { formatAmount } from "@/utils/format";
import { formatDisplayDate } from "@/utils/date";

/**
 * Update balances: what's really in each bank account and wallet, and what's owed on each card.
 * Each box starts at the figure from the bank's latest SMS when there is one, otherwise at Arth's
 * own figure for the user to replace. Where a figure differs from Arth's, Arth adds one balance
 * transaction for the difference, with the note if one is given: a spend (kept out of the budget
 * unless "Count in budget" is on) or money in. Both count in money in and out. Opened from
 * Settings and from the Home balance check.
 */
export default function UpdateBalancesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const alert = useAlert();
  const toast = useToast();
  const [lines, setLines] = useState<BalanceLine[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  /** Per account: count a spend difference against the budget. Off unless switched on. */
  const [inBudget, setInBudget] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const l = await getBalanceLines(DEFAULT_USER_ID);
      setLines(l);
      // Start each box at the bank's SMS figure, else Arth's, keeping anything already typed.
      setValues((prev) => {
        const next = { ...prev };
        for (const x of l) if (next[x.accountId] == null) next[x.accountId] = String(x.sms?.value ?? x.current);
        return next;
      });
    } catch {
      setLines([]);
    }
  }, []);
  useDataRefresh(load);

  const changed = (lines ?? []).filter((l) => {
    const v = parseAmount(values[l.accountId] ?? "");
    return v != null && Math.abs(v - l.current) >= 1;
  });

  const save = async () => {
    setSaving(true);
    try {
      const n = await saveBalanceUpdates(
        DEFAULT_USER_ID,
        changed.map((line) => ({ line, value: parseAmount(values[line.accountId] ?? "") ?? line.current, note: notes[line.accountId], countInBudget: !!inBudget[line.accountId] })),
      );
      toast(n === 0 ? "Everything already matched" : `Updated ${n} ${n === 1 ? "account" : "accounts"}`, { tone: "success" });
      router.back();
    } catch (e) {
      alert("Couldn't update", e instanceof Error ? e.message : "Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!lines) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={theme.primary} />
        </View>
      </ScreenContainer>
    );
  }
  if (lines.length === 0) {
    return (
      <ScreenContainer padTop={false}>
        <EmptyState icon="wallet-outline" title="No accounts yet" subtitle="Add a bank account, wallet or card first." />
      </ScreenContainer>
    );
  }

  const section = (kind: BalanceLine["kind"], title: string) => {
    const list = lines.filter((l) => l.kind === kind);
    if (list.length === 0) return null;
    return (
      <>
        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 mt-2">{title}</Text>
        {list.map((l) => {
          const v = parseAmount(values[l.accountId] ?? "");
          const diff = v != null ? v - l.current : 0;
          const isChanged = v != null && Math.abs(diff) >= 1;
          return (
            <Card key={l.accountId} className="mb-2">
              <Text className="text-sm font-semibold text-foreground">{l.name}</Text>
              <Text className="text-xs text-muted-foreground mt-0.5">
                Arth: {formatAmount(l.current)}
                {kind === "card_due" ? " owed" : ""}
                {kind === "card_due" && l.limit ? ` of ${formatAmount(l.limit)} limit` : ""}
              </Text>
              <Text className="text-xs mt-0.5" style={{ color: l.sms ? theme.primary : theme.mutedForeground }}>
                {l.sms
                  ? `Filled in from your bank's SMS${l.sms.date ? ` on ${formatDisplayDate(l.sms.date.slice(0, 10))}` : ""}. Change it if it's moved since.`
                  : "No balance from your bank's SMS. Replace Arth's figure with what your bank app shows."}
              </Text>
              <Input
                value={values[l.accountId] ?? ""}
                onChangeText={(t) => setValues((s) => ({ ...s, [l.accountId]: t }))}
                keyboardType="decimal-pad"
                placeholder={kind === "card_due" ? "Owed now" : "Balance now"}
                containerClassName="mt-2"
                accessibilityLabel={`${kind === "card_due" ? "Owed now on" : "Balance now in"} ${l.name}`}
              />
              {isChanged && (
                <>
                  <Text className="text-xs mt-1" style={{ color: theme.warning }}>
                    {(kind === "balance" ? diff < 0 : diff > 0)
                      ? `${formatAmount(Math.abs(diff))} counted as money out`
                      : `${formatAmount(Math.abs(diff))} counted as money in`}
                  </Text>
                  {(kind === "balance" ? diff < 0 : diff > 0) && (
                    <View className="flex-row items-center mt-2">
                      <View className="flex-1 mr-3">
                        <Text className="text-sm text-foreground">Count in budget</Text>
                        <Text className="text-xs text-muted-foreground">
                          {inBudget[l.accountId] ? "Counts as uncategorised spending this month" : "Money out, but not against your budget"}
                        </Text>
                      </View>
                      <Switch
                        value={!!inBudget[l.accountId]}
                        onValueChange={(v) => setInBudget((b) => ({ ...b, [l.accountId]: v }))}
                        accessibilityLabel={`Count ${l.name}'s difference in budget`}
                      />
                    </View>
                  )}
                  <Input
                    value={notes[l.accountId] ?? ""}
                    onChangeText={(t) => setNotes((s) => ({ ...s, [l.accountId]: t }))}
                    placeholder="Note (optional): cash withdrawal, bank charges…"
                    containerClassName="mt-2"
                    maxLength={120}
                    accessibilityLabel={`Note for ${l.name}`}
                  />
                </>
              )}
            </Card>
          );
        })}
      </>
    );
  };

  return (
    <ScreenContainer padTop={false}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <Text className="text-sm text-muted-foreground mb-3 leading-5">
            Each box starts at your bank&apos;s latest SMS figure where there is one, otherwise at Arth&apos;s. Check them against your bank
            and card apps. Wherever a box differs from Arth&apos;s figure, the difference is recorded in that account&apos;s ledger as money
            out or money in. Money out stays out of your budget unless you switch on Count in budget.
          </Text>
          {section("balance", "Bank accounts and wallets")}
          {section("card_due", "Credit cards")}
          <Button
            title={changed.length === 0 ? "Nothing changed" : `Update ${changed.length} ${changed.length === 1 ? "account" : "accounts"}`}
            onPress={() => void save()}
            disabled={changed.length === 0}
            loading={saving}
            className="mt-3"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
