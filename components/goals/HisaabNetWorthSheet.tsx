import { useCallback, useEffect, useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import { Sheet, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount } from "@/utils/format";
import { logger } from "@/utils/logger";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getPersonsWithBalances,
  setPersonExcludedFromNetWorth,
  type HisaabPersonWithBalance,
} from "@/services/hisaab";

/**
 * Pick which Hisaab people count towards net worth. A switched-off person's balance is left out
 * of the balance sheet (and everything built on it); their Hisaab ledger is untouched.
 */
export function HisaabNetWorthSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const [persons, setPersons] = useState<HisaabPersonWithBalance[] | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    getPersonsWithBalances(DEFAULT_USER_ID)
      .then((list) => {
        if (!cancelled) setPersons(list);
      })
      .catch((e) => {
        logger.error("Load hisaab persons failed:", e);
        if (!cancelled) setPersons([]);
      });
    return () => { cancelled = true; };
  }, [visible]);

  const toggle = useCallback((person: HisaabPersonWithBalance, include: boolean) => {
    // Optimistic: flip the row now, write in the background, roll back on failure.
    setPersons((prev) => prev?.map((p) => (p.id === person.id ? { ...p, exclude_from_net_worth: include ? 0 : 1 } : p)) ?? prev);
    setPersonExcludedFromNetWorth(person.id, !include).catch((e) => {
      logger.error("Update net worth inclusion failed:", e);
      setPersons((prev) => prev?.map((p) => (p.id === person.id ? person : p)) ?? prev);
    });
  }, []);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="px-5 pt-2 pb-6">
        <Text className="text-lg font-bold text-foreground">Hisaab in Net Worth</Text>
        <Text className="text-sm text-muted-foreground mt-1 mb-3">
          Switch off anyone whose balance you don't expect to get back or pay. Their Hisaab stays
          as it is - only net worth changes.
        </Text>

        {persons === null ? null : persons.length === 0 ? (
          <Text className="text-sm text-muted-foreground py-4">No people in Hisaab yet.</Text>
        ) : (
          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
            {persons.map((p) => {
              const included = p.exclude_from_net_worth !== 1;
              const owesMe = p.balance > 0;
              return (
                <View key={p.id} className="flex-row items-center py-3 border-b border-border">
                  <View className="flex-1 mr-3">
                    <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text
                      className="text-xs mt-0.5"
                      style={{ color: p.balance === 0 ? theme.mutedForeground : owesMe ? theme.success : theme.danger }}
                    >
                      {p.balance === 0
                        ? "Settled"
                        : owesMe
                          ? `Owes you ${formatAmount(p.balance)}`
                          : `You owe ${formatAmount(Math.abs(p.balance))}`}
                    </Text>
                  </View>
                  <Switch
                    value={included}
                    onValueChange={(v) => toggle(p, v)}
                    accessibilityLabel={`Count ${p.name} in net worth`}
                    trackColor={{ false: theme.border, true: theme.alpha("primary", 0.35) }}
                    thumbColor={included ? theme.primary : theme.mutedForeground}
                  />
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Sheet>
  );
}
