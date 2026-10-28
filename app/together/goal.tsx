import { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, Input, ScreenContainer, Text, useToast } from "@/components/ui";
import { Avatar } from "@/components/household/HouseholdBits";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";
import { formatError } from "@/utils/error-message";
import { getActiveHousehold } from "@/services/household/store";
import { closeGoal, createGoal, getGoals, setMyGoalPart, type Goal } from "@/services/household/plans";
import type { Household } from "@/services/household/types";

/**
 * A shared goal: start one (name, amount, by when), or see one with each person's part and set
 * your own: one of your investment buckets (kept up to date from it) or an amount.
 */
export default function GoalScreen() {
  const router = useRouter();
  const toast = useToast();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const [id, setId] = useState<string | undefined>(params.id);
  const [h, setH] = useState<Household | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [buckets, setBuckets] = useState<{ id: string; name: string; current_contributed: number }[]>([]);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [by, setBy] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const hh = await getActiveHousehold();
    setH(hh);
    if (!hh || !id) return;
    setGoal((await getGoals(hh)).find((g) => g.id === id) ?? null);
    setBuckets(
      await getDatabase().getAllAsync(
        "SELECT id, name, current_contributed FROM investment_buckets WHERE user_id = ? AND is_active = 1 ORDER BY financial_year DESC, sort_order;",
        DEFAULT_USER_ID,
      ),
    );
  }, [id]);
  useDataRefresh(load);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      toast(formatError("Goal", e), { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  if (!id) {
    return (
      <ScreenContainer padTop={false}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text className="text-sm text-muted-foreground mb-3 leading-5">
            Something you&apos;re saving for together. Each of you adds your own part: one of your investment buckets, or an amount.
          </Text>
          <Input label="What for" value={name} onChangeText={setName} placeholder="Goa trip" maxLength={40} />
          <View className="h-3" />
          <Input label="Amount" value={target} onChangeText={(v) => setTarget(v.replace(/[^0-9]/g, ""))} keyboardType="numeric" placeholder="150000" />
          <View className="h-3" />
          <Input label="By (optional)" value={by} onChangeText={setBy} placeholder="2027-01-31" maxLength={10} />
          <Button
            title="Start goal"
            className="mt-5"
            loading={busy}
            onPress={() =>
              void run(async () => {
                if (!name.trim() || !(Number(target) > 0)) throw new Error("Enter what it's for and the amount");
                const date = /^\d{4}-\d{2}-\d{2}$/.test(by.trim()) ? by.trim() : null;
                setId(await createGoal(name, Number(target), date));
              })
            }
          />
        </ScrollView>
      </ScreenContainer>
    );
  }

  if (!goal || !h) return <ScreenContainer padTop={false}>{null}</ScreenContainer>;
  const pct = goal.target > 0 ? Math.min(100, (goal.total / goal.target) * 100) : 0;
  const mineStarted = goal.startedBy?.id === h.my_member_id;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Card className="mb-3">
          <Text className="text-lg font-bold text-foreground">{goal.name}</Text>
          <Text className="text-2xl font-bold text-foreground mt-1">
            {formatAmount(goal.total)} <Text className="text-sm text-muted-foreground">of {formatAmount(goal.target)}</Text>
          </Text>
          <View className="flex-row h-2 rounded-full overflow-hidden mt-2" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
            {goal.parts.map((p) => (
              <View key={p.member.id} style={{ width: `${goal.target > 0 ? (p.amount / goal.target) * 100 : 0}%`, backgroundColor: p.member.colour ?? theme.primary }} />
            ))}
          </View>
          <Text className="text-xs text-muted-foreground mt-2">
            {Math.round(pct)}% there
            {goal.by ? ` · by ${goal.by}` : ""}
            {goal.perMonthNeeded ? ` · ${formatAmount(goal.perMonthNeeded)} a month together to make it` : ""}
          </Text>
        </Card>

        <Card className="mb-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Each person&apos;s part</Text>
          {goal.parts.length === 0 ? <Text className="text-sm text-muted-foreground">Nobody has added a part yet.</Text> : null}
          {goal.parts.map((p) => (
            <View key={p.member.id} className="flex-row items-center py-2">
              <Avatar member={p.member} size={24} />
              <Text className="text-sm text-foreground flex-1 ml-2">
                {p.member.id === h.my_member_id ? "You" : p.member.name}
                {p.bucketName ? <Text className="text-xs text-muted-foreground"> · from {p.bucketName}</Text> : null}
              </Text>
              <Text className="text-sm text-foreground">{formatAmount(p.amount)}</Text>
            </View>
          ))}
        </Card>

        <Card className="mb-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Your part</Text>
          <Text className="text-xs text-muted-foreground mb-2 leading-4">Link one of your investment buckets and it stays up to date by itself.</Text>
          {buckets.map((b) => {
            const on = goal.myBucketId === b.id;
            return (
              <Pressable
                key={b.id}
                onPress={() => void run(() => setMyGoalPart(goal.id, { bucketId: b.id }))}
                className="flex-row items-center py-2"
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
              >
                <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={18} color={on ? theme.primary : theme.mutedForeground} />
                <Text className="text-sm text-foreground flex-1 ml-2">{b.name}</Text>
                <Text className="text-sm text-muted-foreground">{formatAmount(b.current_contributed ?? 0)}</Text>
              </Pressable>
            );
          })}
          <View className="flex-row items-end gap-2 mt-2">
            <View className="flex-1">
              <Input label="Or an amount" value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9]/g, ""))} keyboardType="numeric" placeholder="48000" />
            </View>
            <Button title="Save" variant="outline" loading={busy} onPress={() => void run(() => setMyGoalPart(goal.id, { amount: Number(amount) || 0 }))} />
          </View>
        </Card>

        {mineStarted && (
          <Button
            title="Close this goal"
            variant="ghost"
            onPress={() =>
              void run(async () => {
                await closeGoal(goal.id);
                router.back();
              })
            }
          />
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
