import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, EmptyState, LoadingState, ScreenContainer, Text, useToast } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useAlert } from "@/hooks/use-alert";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getAllAccounts } from "@/services/financial-account";
import { convertDebitToTransfer, findTransferCandidates, type TransferCandidate } from "@/services/transfer-detect";
import { formatAmount } from "@/utils/format";
import { formatDisplayDate } from "@/utils/date";

/**
 * Payments already recorded as spending that look like money moving between your own accounts:
 * an IMPS to one of your accounts, a credit card bill paid from your bank. Convert them (all, or
 * one by one) and they leave your spending and budgets. Ones going to an account Arth doesn't
 * know yet can add it, filled in, and convert in the same step. Nothing changes until you tap.
 */
export default function TransferReviewScreen() {
  const router = useRouter();
  const theme = useTheme();
  const alert = useAlert();
  const toast = useToast();
  const [list, setList] = useState<TransferCandidate[] | null>(null);
  const [names, setNames] = useState<Map<string, { name: string; bank: string }>>(new Map());
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useDataRefresh(
    useCallback(async () => {
      try {
        const [candidates, accounts] = await Promise.all([findTransferCandidates(DEFAULT_USER_ID), getAllAccounts(DEFAULT_USER_ID)]);
        setNames(
          new Map(
            accounts.map((a) => [
              a.id,
              { name: `${a.account_label || a.bank_name} ··${(a.account_identifier ?? "").slice(-4)}`, bank: a.bank_name },
            ]),
          ),
        );
        setList(candidates);
      } catch {
        setList([]);
      }
    }, []),
  );

  const ready = useMemo(() => (list ?? []).filter((c) => c.toAccountId), [list]);
  const missing = useMemo(() => {
    const groups = new Map<string, TransferCandidate[]>();
    for (const c of list ?? []) if (!c.toAccountId && c.missingDigits) groups.set(c.missingDigits, [...(groups.get(c.missingDigits) ?? []), c]);
    return [...groups.entries()];
  }, [list]);
  const ticked = ready.filter((c) => !skip.has(c.expenseId));

  const convert = () =>
    alert(
      `Make ${ticked.length} payment${ticked.length === 1 ? "" : "s"} transfers?`,
      "They stop counting as spending and leave your budgets. You can undo any of them from the transaction.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Convert",
          onPress: async () => {
            setBusy(true);
            let done = 0;
            for (const c of ticked) {
              try {
                await convertDebitToTransfer(DEFAULT_USER_ID, c.expenseId, c.toAccountId!);
                done++;
              } catch {
                // Left as it was; it stays in the list.
              }
            }
            setBusy(false);
            setSkip(new Set());
            toast(`${done} payment${done === 1 ? "" : "s"} made transfers`);
          },
        },
      ],
    );

  if (!list) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState icon="swap-horizontal-outline" message="Looking for payments between your accounts…" />
      </ScreenContainer>
    );
  }
  if (list.length === 0) {
    return (
      <ScreenContainer padTop={false}>
        <EmptyState icon="checkmark-done-circle-outline" title="Nothing to fix" subtitle="No payments between your own accounts are counted as spending." />
      </ScreenContainer>
    );
  }

  const Row = ({ c, tickable }: { c: TransferCandidate; tickable: boolean }) => {
    const on = !skip.has(c.expenseId);
    return (
      <Pressable
        disabled={!tickable}
        onPress={() =>
          setSkip((s) => {
            const n = new Set(s);
            if (n.has(c.expenseId)) n.delete(c.expenseId);
            else n.add(c.expenseId);
            return n;
          })
        }
        className="flex-row items-center py-3 border-b border-border"
        style={{ minHeight: 56 }}
        accessibilityRole={tickable ? "checkbox" : undefined}
        accessibilityState={tickable ? { checked: on } : undefined}
      >
        <View className="flex-1 mr-3">
          <Text className="text-sm font-medium text-foreground" numberOfLines={1}>{c.merchant ?? "Payment"}</Text>
          <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
            {formatDisplayDate(c.date)} · {names.get(c.fromAccountId)?.name ?? "Account"}
            {c.toAccountId ? ` → ${names.get(c.toAccountId)?.name ?? "your account"}` : ""}
          </Text>
        </View>
        <Text className="text-sm font-semibold text-foreground mr-2">{formatAmount(c.amount)}</Text>
        {tickable && <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? theme.primary : theme.border} />}
      </Pressable>
    );
  };

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text className="text-xs text-muted-foreground mb-3 px-1">
          These are counted as spending, but the money went to one of your own accounts or cards. As transfers they leave your
          spending and budgets.
        </Text>

        {ready.length > 0 && (
          <>
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
              Ready to convert · {ready.length}
            </Text>
            <Card>
              {ready.map((c) => (
                <Row key={c.expenseId} c={c} tickable />
              ))}
              <View className="mt-3">
                {busy ? (
                  <ActivityIndicator color={theme.primary} />
                ) : (
                  <Button title={`Convert ${ticked.length}`} onPress={convert} disabled={ticked.length === 0} />
                )}
              </View>
            </Card>
          </>
        )}

        {missing.map(([digits, items]) => {
          const card = items.some((c) => c.kind === "card");
          return (
            <View key={digits} className="mt-5">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                To ··{digits} · not in Arth yet
              </Text>
              <Card>
                {items.map((c) => (
                  <Row key={c.expenseId} c={c} tickable={false} />
                ))}
                <Text className="text-xs text-muted-foreground mt-3">
                  If ··{digits} is yours, add it and {items.length === 1 ? "this payment becomes a transfer." : "the first becomes a transfer; the rest move up to Ready to convert."}
                </Text>
                <View className="mt-2">
                  <Button
                    title={`Add ${card ? "card" : "account"} ··${digits}`}
                    variant="outline"
                    onPress={() =>
                      router.push({
                        pathname: "/settings/account-add",
                        params: {
                          presetType: card ? "credit_card" : "savings",
                          presetDigits: digits,
                          ...(card ? { presetBank: names.get(items[0].fromAccountId)?.bank ?? "" } : {}),
                          transferExpenseId: items[0].expenseId,
                        },
                      })
                    }
                  />
                </View>
              </Card>
            </View>
          );
        })}
      </ScrollView>
    </ScreenContainer>
  );
}
