import { useCallback, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, Card, Input, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import { useAlert } from "@/hooks/use-alert";
import { getIgnoredAccountIds } from "@/services/account-ignore";
import { getActiveAccounts, updateAccountType, type AccountType, type FinancialAccount } from "@/services/financial-account";
import { getStartDate, saveBalanceToday } from "@/services/start-date";
import { formatDisplayDate } from "@/utils/date";
import { parseAmount } from "@/utils/expense-validation";
import { todayIso } from "@/utils/local-date";
import { logger } from "@/utils/logger";

/** The everyday account types a detected account can be; the rest are set up on their own screens. */
const TYPES: { type: AccountType; label: string }[] = [
  { type: "savings", label: "Bank" },
  { type: "credit_card", label: "Credit card" },
  { type: "wallet", label: "Wallet" },
];
const EVERYDAY = new Set<string>(["savings", "bank", "credit_card", "wallet"]);
const asksBalance = (type: string) => type === "savings" || type === "bank" || type === "wallet";

/**
 * Onboarding, after the accounts list: is each account the right kind, and what's in it today?
 * Prefilled from the latest balance a bank SMS reported, so most of the time it's a glance and
 * Continue. Today's figure becomes where the account starts (saveBalanceToday), so from here on
 * every expense and credit keeps it right. Cards aren't asked: their dues are worked out each month.
 */
export default function OnboardingBalances() {
  const router = useRouter();
  const theme = useTheme();
  const alert = useAlert();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [types, setTypes] = useState<Record<string, string>>({});
  const [balances, setBalances] = useState<Record<string, string>>({});
  const fresh = getStartDate() != null;

  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        try {
          const all = await getActiveAccounts(DEFAULT_USER_ID);
          const ignored = getIgnoredAccountIds();
          const list = all.filter((a) => EVERYDAY.has(a.account_type as string) && !ignored.has(a.id));
          if (!live) return;
          setAccounts(list);
          setTypes(Object.fromEntries(list.map((a) => [a.id, (a.account_type as string) === "bank" ? "savings" : a.account_type])));
          setBalances((prev) => {
            const next = { ...prev };
            for (const a of list) {
              if (next[a.id] == null && a.last_known_balance != null) next[a.id] = String(a.last_known_balance);
            }
            return next;
          });
        } catch (e) {
          logger.warn("Onboarding balances: load failed", e);
        } finally {
          if (live) setLoading(false);
        }
      })();
      return () => {
        live = false;
      };
    }, []),
  );

  const changeType = async (id: string, type: AccountType) => {
    const before = types[id];
    setTypes((t) => ({ ...t, [id]: type }));
    try {
      await updateAccountType(id, type);
    } catch (e) {
      setTypes((t) => ({ ...t, [id]: before }));
      alert("Couldn't change the type", e instanceof Error ? e.message : "Try again.");
    }
  };

  const goOn = () => router.push("/(onboarding)/setup-choice");

  const save = async () => {
    setSaving(true);
    const today = todayIso();
    try {
      for (const a of accounts) {
        if (!asksBalance(types[a.id])) continue;
        const value = parseAmount(balances[a.id] ?? "");
        if (value != null) await saveBalanceToday(a.id, value, today);
      }
      goOn();
    } catch (e) {
      logger.error("Onboarding balances: save failed", e);
      alert("Couldn't save the balances", "Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenContainer safe padTop>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text className="text-2xl font-bold text-foreground mb-2">What's in each account today?</Text>
          <Text className="text-sm text-muted-foreground mb-6 leading-5">
            {fresh
              ? "Arth starts each account from today's balance, and keeps it right as money comes and goes."
              : "Arth works back from today's balance through the months it read, then keeps it right as money comes and goes."}{" "}
            Check the type too.
          </Text>

          {loading ? (
            <LoadingState />
          ) : accounts.length === 0 ? (
            <Text className="text-sm text-muted-foreground">No bank, card or wallet accounts yet. You can add them from Settings.</Text>
          ) : (
            accounts.map((a) => {
              const type = types[a.id];
              return (
                <Card key={a.id} className="mb-3">
                  <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                    {a.account_label || a.bank_name}
                    {a.account_identifier ? <Text className="text-sm text-muted-foreground"> · XX{a.account_identifier}</Text> : null}
                  </Text>
                  <View className="flex-row flex-wrap mt-2 mb-1" style={{ gap: 8 }}>
                    {TYPES.map((t) => {
                      const selected = type === t.type;
                      return (
                        <Pressable
                          key={t.type}
                          onPress={() => !selected && void changeType(a.id, t.type)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          className="px-3 py-1.5 rounded-full border"
                          style={{
                            borderColor: selected ? theme.primary : theme.border,
                            backgroundColor: selected ? theme.alpha("primary", 0.12) : "transparent",
                          }}
                        >
                          <Text className="text-xs font-semibold" style={{ color: selected ? theme.primary : theme.mutedForeground }}>
                            {t.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {asksBalance(type) ? (
                    <>
                      <Input
                        value={balances[a.id] ?? ""}
                        onChangeText={(v) => setBalances((b) => ({ ...b, [a.id]: v }))}
                        keyboardType="decimal-pad"
                        placeholder="Balance today"
                        containerClassName="mt-2"
                        accessibilityLabel={`Balance today in ${a.account_label || a.bank_name}`}
                      />
                      {a.last_known_balance != null && a.last_balance_date && (
                        <Text className="text-xs text-muted-foreground mt-1">
                          From your bank's message on {formatDisplayDate(a.last_balance_date.slice(0, 10))}. Change it if it's moved since.
                        </Text>
                      )}
                    </>
                  ) : (
                    <Text className="text-xs text-muted-foreground mt-2">Card dues are worked out from each month's spending.</Text>
                  )}
                </Card>
              );
            })
          )}
        </ScrollView>
        <View className="px-6 pb-6 pt-2">
          <Button title="Continue" onPress={() => void save()} loading={saving} disabled={loading} className="mb-3" />
          <Button title="Skip for now" variant="ghost" onPress={goOn} />
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
