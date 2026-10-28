import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, Input, ScreenContainer, Text, useToast } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount } from "@/utils/format";
import { formatError } from "@/utils/error-message";
import { toIsoDate } from "@/utils/date";
import { getActiveHousehold } from "@/services/household/store";
import { getBalances, recordSettleUp, settleUpCandidates, type Balance } from "@/services/household/settle";

/**
 * Settle up with one household member: who paid whom and how much, and (when I paid) which bank
 * payment it was, so that payment isn't counted as spending on top of my share of the bills.
 */
export default function SettleScreen() {
  const router = useRouter();
  const toast = useToast();
  const theme = useTheme();
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState<"me" | "them">("me");
  const [payments, setPayments] = useState<{ id: string; amount: number; date: string; merchant: string | null }[]>([]);
  const [payment, setPayment] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = toIsoDate(new Date());

  useEffect(() => {
    (async () => {
      const h = await getActiveHousehold();
      if (!h) return;
      const b = (await getBalances(h)).find((x) => x.memberId === memberId) ?? null;
      setBalance(b);
      if (b) {
        setPaidBy(b.amount < 0 ? "me" : "them");
        setAmount(String(Math.round(Math.abs(b.amount))));
      }
    })();
  }, [memberId]);

  useEffect(() => {
    const n = Number(amount);
    if (paidBy !== "me" || !(n > 0)) {
      setPayments([]);
      return;
    }
    settleUpCandidates(n, today).then(setPayments).catch(() => setPayments([]));
  }, [amount, paidBy, today]);

  if (!balance) return <ScreenContainer padTop={false}>{null}</ScreenContainer>;

  const save = async () => {
    setBusy(true);
    try {
      await recordSettleUp({ memberId: balance.memberId, amount: Number(amount), date: today, paidBy, paymentExpenseId: payment });
      toast("Settle-up recorded. It'll show on both phones.");
      router.back();
    } catch (e) {
      toast(formatError("Settle up", e), { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const Choice = ({ value, label }: { value: "me" | "them"; label: string }) => (
    <Pressable
      onPress={() => setPaidBy(value)}
      className="flex-1 py-2.5 rounded-xl items-center border"
      style={{ borderColor: paidBy === value ? theme.primary : theme.alpha("foreground", 0.15), backgroundColor: paidBy === value ? theme.alpha("primary", 0.1) : "transparent" }}
      accessibilityRole="radio"
      accessibilityState={{ checked: paidBy === value }}
    >
      <Text className="text-sm" style={{ color: paidBy === value ? theme.primary : theme.mutedForeground }}>{label}</Text>
    </Pressable>
  );

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Card className="mb-3">
          <Text className="text-xs text-muted-foreground">Right now</Text>
          <Text className="text-lg font-semibold text-foreground mt-1">
            {balance.amount < -0.5
              ? `You owe ${balance.name} ${formatAmount(-balance.amount)}`
              : balance.amount > 0.5
                ? `${balance.name} owes you ${formatAmount(balance.amount)}`
                : `All square with ${balance.name}`}
          </Text>
        </Card>

        <View className="flex-row gap-2 mb-3">
          <Choice value="me" label={`I paid ${balance.name}`} />
          <Choice value="them" label={`${balance.name} paid me`} />
        </View>
        <Input label="Amount" value={amount} onChangeText={setAmount} keyboardType="numeric" />

        {paidBy === "me" && payments.length > 0 && (
          <Card className="mt-3">
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Which payment was it?</Text>
            <Text className="text-xs text-muted-foreground mb-2 leading-4">
              Picking it keeps it out of your spending: you&apos;ve already counted your share of the bills.
            </Text>
            {payments.map((p) => {
              const on = payment === p.id;
              return (
                <Pressable key={p.id} onPress={() => setPayment(on ? null : p.id)} className="flex-row items-center py-2" accessibilityRole="radio" accessibilityState={{ checked: on }}>
                  <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={18} color={on ? theme.primary : theme.mutedForeground} />
                  <Text className="text-sm text-foreground flex-1 ml-2" numberOfLines={1}>{p.merchant ?? "Payment"} · {p.date.slice(5, 10)}</Text>
                  <Text className="text-sm text-foreground">{formatAmount(p.amount)}</Text>
                </Pressable>
              );
            })}
          </Card>
        )}

        <Text className="text-xs text-muted-foreground mt-3 leading-4">
          This goes into your Hisaab with {balance.name} now, and into theirs when their phone syncs.
        </Text>
        <Button title="Record settle-up" className="mt-4" loading={busy} onPress={() => void save()} />
      </ScrollView>
    </ScreenContainer>
  );
}
