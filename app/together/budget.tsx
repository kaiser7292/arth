import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Card, Input, ScreenContainer, Text, useToast } from "@/components/ui";
import { formatAmount } from "@/utils/format";
import { formatError } from "@/utils/error-message";
import { getActiveHousehold, getHouseholdCategories } from "@/services/household/store";
import { acceptBudget, getBudgetState, proposeBudget, suggestBudget, type BudgetProposal } from "@/services/household/plans";

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * Household budget: propose one (amounts per household category, suggested from the last three
 * months), or review someone else's proposal and accept it or suggest changes. It starts once
 * everyone has accepted.
 */
export default function HouseholdBudgetScreen() {
  const router = useRouter();
  const toast = useToast();
  const { review } = useLocalSearchParams<{ review?: string }>();
  const [proposal, setProposal] = useState<BudgetProposal | null>(null);
  const [editing, setEditing] = useState(!review);
  const [cats, setCats] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const h = await getActiveHousehold();
      if (!h) return;
      const names = (await getHouseholdCategories(h.id)).map((c) => c.name);
      setCats(names);
      const st = await getBudgetState(h, thisMonth());
      const p = review ? (st.pending?.id === review ? st.pending : null) : null;
      setProposal(p);
      const base = p?.amounts ?? st.active?.amounts ?? (await suggestBudget(h, thisMonth()));
      setAmounts(Object.fromEntries(names.map((n) => [n, base[n] ? String(base[n]) : ""])));
    })();
  }, [review]);

  const total = Object.values(amounts).reduce((s, v) => s + (Number(v) || 0), 0);

  const send = async () => {
    setBusy(true);
    try {
      await proposeBudget(Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, Number(v) || 0])), note);
      toast("Sent. It starts when everyone accepts.");
      router.back();
    } catch (e) {
      toast(formatError("Budget", e), { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (!proposal) return;
    setBusy(true);
    try {
      await acceptBudget(proposal.id);
      toast("Accepted");
      router.back();
    } catch (e) {
      toast(formatError("Budget", e), { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {proposal && !editing ? (
          <>
            <Card className="mb-3">
              <Text className="text-xs text-muted-foreground">{proposal.by.name} proposed</Text>
              <Text className="text-xl font-bold text-foreground mt-1">{formatAmount(Object.values(proposal.amounts).reduce((s, v) => s + v, 0))} a month</Text>
              {proposal.note ? <Text className="text-sm text-foreground mt-2">&quot;{proposal.note}&quot;</Text> : null}
            </Card>
            <Card className="mb-4">
              {Object.entries(proposal.amounts).map(([c, v]) => (
                <View key={c} className="flex-row justify-between py-2 border-b border-border">
                  <Text className="text-sm text-foreground">{c}</Text>
                  <Text className="text-sm text-foreground">{formatAmount(v)}</Text>
                </View>
              ))}
            </Card>
            <View className="flex-row gap-2">
              <Button title="Suggest changes" variant="outline" className="flex-1" onPress={() => setEditing(true)} />
              <Button title="Accept" className="flex-1" loading={busy} onPress={() => void accept()} />
            </View>
          </>
        ) : (
          <>
            <Text className="text-sm text-muted-foreground mb-3 leading-5">
              {proposal
                ? `Change what you'd like and send it back to ${proposal.by.name}.`
                : "Suggested from what you've spent together over the last three months. It starts once everyone accepts."}
            </Text>
            <Card className="mb-3">
              {cats.map((c) => (
                <View key={c} className="flex-row items-center py-1.5">
                  <Text className="text-sm text-foreground flex-1">{c}</Text>
                  <View style={{ width: 130 }}>
                    <Input
                      value={amounts[c] ?? ""}
                      onChangeText={(v) => setAmounts((a) => ({ ...a, [c]: v.replace(/[^0-9]/g, "") }))}
                      keyboardType="numeric"
                      placeholder="0"
                    />
                  </View>
                </View>
              ))}
              <View className="flex-row justify-between pt-3 mt-1 border-t border-border">
                <Text className="text-sm font-semibold text-foreground">Total</Text>
                <Text className="text-sm font-semibold text-foreground">{formatAmount(total)} a month</Text>
              </View>
            </Card>
            <Input label="Note (optional)" value={note} onChangeText={setNote} placeholder="Let's eat out less and save for Goa" maxLength={140} />
            <Button title={proposal ? `Send back to ${proposal.by.name}` : "Send to the household"} className="mt-4" loading={busy} onPress={() => void send()} />
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
