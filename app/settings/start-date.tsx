import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import { Button, Card, DateInput, Input, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useAlert } from "@/hooks/use-alert";
import type { FinancialAccount } from "@/services/financial-account";
import {
  clearStartDate,
  countIgnoredBefore,
  getStartBalanceAccounts,
  getStartDate,
  saveStartBalance,
  setStartDate,
} from "@/services/start-date";
import { formatDisplayDate } from "@/utils/date";
import { parseAmount } from "@/utils/expense-validation";
import { todayIso } from "@/utils/local-date";
import { logger } from "@/utils/logger";

const firstOfThisMonth = () => `${todayIso().slice(0, 7)}-01`;

/**
 * Settings > Transactions > Start date: ignore transactions before a date, then give each bank and
 * wallet account's balance on that day. Onboarding opens the second step directly, once the first
 * scan has found the accounts.
 */
export default function StartDateScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const inOnboarding = onboarding === "1";
  const current = getStartDate();

  const [step, setStep] = useState<"date" | "balances">(inOnboarding ? "balances" : "date");
  const [date, setDate] = useState(current ?? firstOfThisMonth());
  const [count, setCount] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setCount(null);
    countIgnoredBefore(DEFAULT_USER_ID, date)
      .then((n) => live && setCount(n))
      .catch((e) => logger.warn("Start date count failed:", e));
    return () => {
      live = false;
    };
  }, [date]);

  useEffect(() => {
    if (step !== "balances") return;
    getStartBalanceAccounts(DEFAULT_USER_ID)
      .then(setAccounts)
      .catch((e) => logger.warn("Start date accounts failed:", e));
  }, [step]);

  const leave = useCallback(() => {
    if (inOnboarding) router.replace("/(onboarding)/accounts-preview");
    else router.back();
  }, [inOnboarding, router]);

  const confirm = async () => {
    setSaving(true);
    try {
      await setStartDate(DEFAULT_USER_ID, date);
      setStep("balances");
    } catch (e) {
      logger.error("Setting the start date failed:", e);
      alert("Couldn't set the start date", "Nothing was changed. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const countAll = () =>
    alert("Count everything again?", "Older transactions come back everywhere in Arth.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Confirm",
        onPress: async () => {
          await clearStartDate(DEFAULT_USER_ID);
          router.back();
        },
      },
    ]);

  const done = async () => {
    setSaving(true);
    try {
      const start = getStartDate() ?? date;
      for (const a of accounts) {
        const value = parseAmount(balances[a.id] ?? "");
        if (value != null) await saveStartBalance(a.id, start, value);
      }
      leave();
    } catch (e) {
      logger.error("Saving start balances failed:", e);
      alert("Couldn't save the balances", "Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (step === "balances") {
    const on = formatDisplayDate(getStartDate() ?? date);
    return (
      <ScreenContainer padTop={false}>
        <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          <Text className="text-sm text-muted-foreground mb-4 leading-5">
            What was in each account on {on}? Arth adds up from there. An account you leave blank keeps the balance it would otherwise work out, which may be off.
          </Text>
          {accounts.length > 0 ? (
            <Card className="mb-4">
              {accounts.map((a) => (
                <Input
                  key={a.id}
                  label={`${a.account_label || a.bank_name}${a.account_identifier ? ` ****${a.account_identifier}` : ""}`}
                  value={balances[a.id] ?? ""}
                  onChangeText={(v) => setBalances((b) => ({ ...b, [a.id]: v }))}
                  keyboardType="decimal-pad"
                  placeholder="Balance"
                  containerClassName="mb-3"
                />
              ))}
            </Card>
          ) : (
            <Text className="text-sm text-muted-foreground mb-4">No bank or wallet accounts yet.</Text>
          )}
          <Button title="Done" onPress={() => void done()} loading={saving} />
        </ScrollView>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Text className="text-sm text-muted-foreground mb-4 leading-5">
          If your older data is incomplete, Arth can ignore it so it doesn't skew your figures. Starting on the 1st of a month gives the cleanest numbers.
        </Text>
        <Card className="mb-4">
          <DateInput label="Ignore transactions before" value={date} onChange={setDate} />
          <Text className="text-sm text-foreground mt-3">
            {count == null
              ? " "
              : `${count.toLocaleString("en-IN")} transaction${count === 1 ? "" : "s"} before this date will be ignored. You can undo this any time.`}
          </Text>
          <Text className="text-xs text-muted-foreground mt-2">Loans, investments and Hisaab stay as they are.</Text>
        </Card>
        <Button title="Confirm" onPress={() => void confirm()} loading={saving} className="mb-3" />
        {current && <Button title="Count everything again" variant="ghost" onPress={countAll} />}
      </ScrollView>
    </ScreenContainer>
  );
}
