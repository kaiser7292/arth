import { useState, useEffect, useCallback } from "react";

import { Sheet, Text } from "@/components/ui";
import { View, Pressable,  ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { formatAmount } from "@/utils/format";
import { getPersonsWithBalances, type HisaabPersonWithBalance } from "@/services/hisaab";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";

/**
 * Person-picker sheet for "Mark credit as settlement from hisaab person".
 *
 * Same slide-up-from-bottom pattern as RecurringRuleSheet / DematTransferTargetSheet.
 * Shows each person with their current balance so the user can pick the right
 * one (positive = owes them, negative = they owe).
 */

interface Props {
  visible: boolean;
  creditAmount: number;
  onPick: (personId: string) => void;
  onClose: () => void;
}

export function HisaabSettlementPickerSheet({
  visible,
  creditAmount,
  onPick,
  onClose,
}: Props) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [persons, setPersons] = useState<HisaabPersonWithBalance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;

    (async () => {
      setLoading(true);
      try {
        const list = await getPersonsWithBalances(DEFAULT_USER_ID);
        // Sort: people who currently owe YOU (positive balance) first — they're
        // the likely candidates for a settlement-from-them.
        list.sort((a, b) => b.balance - a.balance);
        setPersons(list);
      } catch {
        setPersons([]);
      }
      setLoading(false);
    })();
  }, [visible]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handlePick = useCallback(
    (personId: string) => {
      onPick(personId);
    },
    [onPick],
  );



  if (!visible) return null;

  return (
    <Sheet visible={visible} onClose={handleClose}>

      {/* Header */}
      <View className="px-5 pb-3">
        <Text className="text-base font-bold" style={{ color: colors.text }}>
          Mark as settlement
        </Text>
        <Text className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>
          Who paid you this {formatAmount(creditAmount)}? It'll apply against their hisaab balance.
        </Text>
      </View>

      {loading ? (
        <View className="px-5 py-8 items-center">
          <Text className="text-sm" style={{ color: colors.textSecondary }}>
            Loading people…
          </Text>
        </View>
      ) : persons.length === 0 ? (
        <View className="px-5 py-8 items-center">
          <Ionicons name="people-outline" size={40} color={colors.textSecondary} />
          <Text className="text-sm mt-3 text-center" style={{ color: colors.textSecondary }}>
            No hisaab people yet. Add one from the Settings tab → Hisaab.
          </Text>
        </View>
      ) : (
        <ScrollView
          className="px-5"
          contentContainerStyle={{ paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
          scrollEnabled={persons.length > 4}
          alwaysBounceVertical={false}
        >
          {persons.map((p) => {
            const owesYou = p.balance > 0;
            const youOwe = p.balance < 0;
            const balanceColor = owesYou
              ? theme.success
              : youOwe
                ? theme.danger
                : colors.textSecondary;
            const balanceLabel = owesYou
              ? `Owes you ${formatAmount(p.balance)}`
              : youOwe
                ? `You owe ${formatAmount(Math.abs(p.balance))}`
                : "Settled up";

            return (
              <Pressable
                key={p.id}
                onPress={() => handlePick(p.id)}
                accessibilityRole="button"
                accessibilityLabel={`Mark settlement from ${p.name}. ${balanceLabel}.`}
                className="flex-row items-center py-3 px-4 rounded-xl mb-2"
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <View
                  className="w-9 h-9 rounded-full items-center justify-center mr-3"
                  style={{ backgroundColor: theme.alpha("primary", 0.1) }}
                >
                  <Ionicons
                    name="person-outline"
                    size={18}
                    color={theme.primary}
                  />
                </View>
                <View className="flex-1">
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: colors.text }}
                  >
                    {p.name}
                  </Text>
                  <Text className="text-xs mt-0.5" style={{ color: balanceColor }}>
                    {balanceLabel}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* Cancel */}
      <View className="px-5 pt-3">
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          className="py-3 rounded-xl items-center"
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
        >
          <Text className="text-sm font-semibold" style={{ color: colors.textSecondary }}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </Sheet>
  );
}
