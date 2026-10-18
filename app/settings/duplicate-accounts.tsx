import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, EmptyState, LoadingState, ScreenContainer, Text, useToast } from "@/components/ui";
import { useAlert } from "@/hooks/use-alert";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import {
  dismissDuplicateGroup,
  findDuplicateAccounts,
  mergeAccounts,
  type DuplicateAccount,
  type DuplicateGroup,
} from "@/services/account-duplicates";
import { formatAmount } from "@/utils/format";
import { formatDisplayDate } from "@/utils/date";

const TYPE_LABEL: Record<string, string> = {
  savings: "Savings",
  bank: "Savings",
  credit_card: "Credit card",
  wallet: "Wallet",
  loan: "Loan",
  pension: "Pension",
  demat: "Demat",
  investment: "Investment",
};

/**
 * Accounts recorded twice (same bank, same last digits). Pick the one to keep and merge the rest
 * into it, or say they're not the same. See services/account-duplicates.ts.
 */
export default function DuplicateAccountsScreen() {
  const theme = useTheme();
  const alert = useAlert();
  const toast = useToast();
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  /** Which account to keep, per group (defaults to the suggestion). */
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useDataRefresh(
    useCallback(async () => {
      try {
        setGroups(await findDuplicateAccounts());
      } catch {
        setGroups([]);
      }
    }, []),
  );

  const merge = (g: DuplicateGroup) => {
    const keepId = keep[g.key] ?? g.suggestedKeepId;
    const kept = g.accounts.find((a) => a.id === keepId)!;
    const others = g.accounts.filter((a) => a.id !== keepId);
    const moving = others.reduce((s, a) => s + a.txCount, 0);
    alert(
      "Merge these accounts?",
      `${moving} transaction${moving === 1 ? "" : "s"} and everything else on the other account${others.length === 1 ? "" : "s"} move to ${kept.name} (${TYPE_LABEL[kept.account_type] ?? kept.account_type} ••${kept.account_identifier.slice(-4)}). The other account${others.length === 1 ? " is" : "s are"} then removed. This can't be undone, so back up first if you're unsure.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Merge",
          style: "destructive",
          onPress: async () => {
            setBusy(g.key);
            try {
              for (const o of others) await mergeAccounts(keepId, o.id);
              toast(`Merged into ${kept.name}`);
            } catch (e) {
              alert("Couldn't merge", e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  if (!groups) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState icon="copy-outline" message="Looking for accounts recorded twice…" />
      </ScreenContainer>
    );
  }
  if (groups.length === 0) {
    return (
      <ScreenContainer padTop={false}>
        <EmptyState icon="checkmark-done-circle-outline" title="No duplicate accounts" subtitle="Every account has its own bank and digits." />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text className="text-xs text-muted-foreground mb-3 px-1">
          These accounts have the same bank and the same last digits, so they're probably one account recorded twice - often a savings account that was also saved as a credit card. Pick the one to keep.
        </Text>
        {groups.map((g) => {
          const keepId = keep[g.key] ?? g.suggestedKeepId;
          return (
            <Card key={g.key} className="mb-3">
              {g.accounts.map((a, i) => (
                <AccountChoice
                  key={a.id}
                  account={a}
                  selected={a.id === keepId}
                  first={i === 0}
                  onPress={() => setKeep((k) => ({ ...k, [g.key]: a.id }))}
                />
              ))}
              {!g.canMerge && (
                <Text className="text-xs mt-2" style={{ color: theme.warning }}>
                  More than one of these has a loan or investment attached, so they can't be merged here. Edit them from the account screen instead.
                </Text>
              )}
              <View className="flex-row mt-3" style={{ gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button title="Not the same" variant="outline" onPress={() => dismissDuplicateGroup(g.key)} />
                </View>
                <View style={{ flex: 1 }}>
                  {busy === g.key ? (
                    <View className="items-center justify-center py-3"><ActivityIndicator color={theme.primary} /></View>
                  ) : (
                    <Button title="Merge" onPress={() => merge(g)} disabled={!g.canMerge || busy != null} />
                  )}
                </View>
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </ScreenContainer>
  );
}

function AccountChoice({ account: a, selected, first, onPress }: { account: DuplicateAccount; selected: boolean; first: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center py-2.5"
      style={first ? undefined : { borderTopWidth: 1, borderTopColor: theme.border }}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? theme.primary : theme.mutedForeground} />
      <View className="flex-1 ml-3">
        <Text className="text-sm font-medium text-foreground">
          {a.name} · {TYPE_LABEL[a.account_type] ?? a.account_type} ••{a.account_identifier.slice(-4)}
        </Text>
        <Text className="text-xs text-muted-foreground mt-0.5">
          {a.addedByYou ? "Added by you" : "Created from a message"} · {formatDisplayDate(a.created_at.slice(0, 10))} · {a.txCount} transaction{a.txCount === 1 ? "" : "s"}
          {a.last_known_balance != null ? ` · ${formatAmount(a.last_known_balance)}` : ""}
        </Text>
      </View>
      {selected && <Text className="text-xs font-semibold" style={{ color: theme.primary }}>Keep</Text>}
    </Pressable>
  );
}
