import { useCallback, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, Card, Input, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import { useAlert } from "@/hooks/use-alert";
import { getIgnoredAccountIds } from "@/services/account-ignore";
import { computeUnseededBalance, getEarliestAccountActivity } from "@/services/account-balance";
import {
  getAccountTypeDoubts,
  getActiveAccounts,
  updateAccountType,
  type AccountType,
  type AccountTypeDoubt,
  type FinancialAccount,
} from "@/services/financial-account";
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
const TYPE_NAME: Record<string, string> = { savings: "a bank account", credit_card: "a credit card", wallet: "a wallet", loan: "a loan" };

/** Where a prefilled balance came from, said under the box. */
type Source = { kind: "sms"; date: string | null } | { kind: "worked_out" };

/**
 * Onboarding, after the accounts list: is each account the right kind, and what's in it today?
 * Each balance is filled in from the latest one a bank SMS reported; failing that, from what the
 * scanned transactions add up to; failing that, left for you. Accounts whose type Arth isn't sure
 * of come first, marked, so most of the time it's a glance and Continue. Today's figure becomes where the account starts (saveBalanceToday), so from here on
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
  const [sources, setSources] = useState<Record<string, Source>>({});
  const [doubts, setDoubts] = useState<Map<string, AccountTypeDoubt>>(new Map());
  const fresh = getStartDate() != null;

  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        try {
          const all = await getActiveAccounts(DEFAULT_USER_ID);
          const ignored = getIgnoredAccountIds();
          const kept = all.filter((a) => EVERYDAY.has(a.account_type as string) && !ignored.has(a.id));
          const unsure = await getAccountTypeDoubts(kept.map((a) => a.id)).catch(() => new Map<string, AccountTypeDoubt>());
          // Unsure ones first, so they're seen.
          const list = [...kept].sort((a, b) => Number(unsure.has(b.id)) - Number(unsure.has(a.id)));

          // Balances: the bank's own figure from SMS, else what the transactions add up to (only
          // with history kept: started fresh, there's nothing to add up yet).
          const prefill: Record<string, string> = {};
          const from: Record<string, Source> = {};
          const month = todayIso().slice(0, 7);
          for (const a of list) {
            if (!asksBalance(a.account_type as string)) continue;
            if (a.last_known_balance != null) {
              prefill[a.id] = String(a.last_known_balance);
              from[a.id] = { kind: "sms", date: a.last_balance_date };
            } else if (!fresh && (await getEarliestAccountActivity(a.id).catch(() => null))) {
              const worked = await computeUnseededBalance(a.id, month).catch(() => null);
              if (worked) {
                prefill[a.id] = String(Math.round(worked.closing * 100) / 100);
                from[a.id] = { kind: "worked_out" };
              }
            }
          }
          if (!live) return;
          setAccounts(list);
          setDoubts(unsure);
          setTypes(Object.fromEntries(list.map((a) => [a.id, (a.account_type as string) === "bank" ? "savings" : a.account_type])));
          setSources((prev) => ({ ...from, ...prev }));
          setBalances((prev) => ({ ...prefill, ...prev }));
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
    // Answered: no need to keep flagging it.
    setDoubts((d) => {
      const next = new Map(d);
      next.delete(id);
      return next;
    });
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
            {doubts.size > 0 ? ` Arth isn't sure what ${doubts.size === 1 ? "one account is" : `${doubts.size} accounts are`}: tap the right type.` : " Check the type too."}
          </Text>

          {loading ? (
            <LoadingState />
          ) : accounts.length === 0 ? (
            <Text className="text-sm text-muted-foreground">No bank, card or wallet accounts yet. You can add them from Settings.</Text>
          ) : (
            accounts.map((a) => {
              const type = types[a.id];
              const doubt = doubts.get(a.id);
              return (
                <Card key={a.id} className="mb-3">
                  {doubt && (
                    <View className="flex-row items-center self-start px-2 py-0.5 rounded-full mb-2" style={{ backgroundColor: theme.alpha("warning", 0.14) }}>
                      <Text className="text-xs font-semibold" style={{ color: theme.warning }}>
                        {doubt.suggested && TYPE_NAME[doubt.suggested] ? `Looks like ${TYPE_NAME[doubt.suggested]}. Which is it?` : "Not sure what this is. Which is it?"}
                      </Text>
                    </View>
                  )}
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
                      <Text className="text-xs text-muted-foreground mt-1">
                        {sources[a.id]?.kind === "sms"
                          ? `From your bank's message${(sources[a.id] as { date: string | null }).date ? ` on ${formatDisplayDate(((sources[a.id] as { date: string | null }).date ?? "").slice(0, 10))}` : ""}. Change it if it's moved since.`
                          : sources[a.id]?.kind === "worked_out"
                            ? "Worked out from your transactions; your bank didn't send a balance. Check it against your bank app."
                            : "Your bank didn't send a balance. Enter what's in it today."}
                      </Text>
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
