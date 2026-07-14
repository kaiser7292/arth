import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { findReminderCandidateExpenses } from "@/services/expense";
import type { Expense } from "@/services/expense";
import { formatAmount } from "@/utils/format";

/**
 * "Link to an existing expense" sheet. Shown when the user taps a pending
 * reminder. Lists recent realized expenses that might fulfill this cycle:
 * same merchant + within the last 30 days + not already linked.
 *
 * Actions:
 *   - Pick one → onPickExisting(expenseId). Parent runs fulfillReminder.
 *   - "Log new expense" → onLogNew(). Parent navigates to add-expense
 *     prefilled via ?fulfillsReminderId=<rule.id>.
 */

interface LinkExpenseSheetProps {
  visible: boolean;
  ruleId: string;
  ruleDescription: string;
  /** When provided, skips the fetch and uses these candidates directly. */
  preloadedCandidates?: Expense[];
  onPickExisting: (expenseId: string) => void;
  onLogNew: () => void;
  onClose: () => void;
}

export function LinkExpenseSheet({
  visible,
  ruleId,
  ruleDescription,
  preloadedCandidates,
  onPickExisting,
  onLogNew,
  onClose,
}: LinkExpenseSheetProps) {
  const { colors, accent, colorScheme } = useColorScheme();
  const insets = useSafeAreaInsets();
  const [candidates, setCandidates] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const slideAnim = useSharedValue(400);
  void colorScheme;

  useEffect(() => {
    if (!visible) return;
    slideAnim.value = withTiming(0, { duration: 250 });
    if (preloadedCandidates) {
      setCandidates(preloadedCandidates);
      setLoading(false);
      return;
    }
    setLoading(true);
    findReminderCandidateExpenses(ruleId)
      .then(setCandidates)
      .catch(() => setCandidates([]))
      .finally(() => setLoading(false));
  }, [visible, ruleId, preloadedCandidates, slideAnim]);

  const close = useCallback(() => {
    slideAnim.value = withTiming(400, { duration: 200 }, () => {
      runOnJS(onClose)();
    });
  }, [slideAnim, onClose]);

  const pickExisting = useCallback(
    (expenseId: string) => {
      slideAnim.value = withTiming(400, { duration: 200 }, () => {
        runOnJS(onPickExisting)(expenseId);
      });
    },
    [slideAnim, onPickExisting],
  );

  const logNew = useCallback(() => {
    slideAnim.value = withTiming(400, { duration: 200 }, () => {
      runOnJS(onLogNew)();
    });
  }, [slideAnim, onLogNew]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: slideAnim.value }],
  }));

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={close}>
      <Pressable
        className="flex-1 bg-black/40"
        onPress={close}
        accessibilityLabel="Close"
        accessibilityRole="button"
      />
      <Animated.View
        style={[
          animStyle,
          { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: Math.max(insets.bottom, 8) },
        ]}
      >
        <View className="items-center pt-3 pb-1">
          <View className="w-10 h-1 rounded-full bg-border-light dark:bg-border-dark" />
        </View>

        <View className="px-5 pb-3">
          <Text className="text-base font-bold" style={{ color: colors.text }}>
            Link to an expense
          </Text>
          <Text className="text-sm mt-0.5" style={{ color: colors.textSecondary }} numberOfLines={2}>
            {ruleDescription}
          </Text>
        </View>

        {/* Candidate list */}
        <View className="px-2" style={{ maxHeight: 320 }}>
          {loading ? (
            <View className="items-center py-8">
              <ActivityIndicator size="small" color={colors.blue} />
            </View>
          ) : candidates.length === 0 ? (
            <View className="px-3 py-6">
              <Text className="text-sm text-center" style={{ color: colors.textSecondary }}>
                No matching expenses in the last 30 days.
              </Text>
              <Text className="text-xs text-center mt-1" style={{ color: colors.textSecondary }}>
                Log a new expense to fulfill this reminder.
              </Text>
            </View>
          ) : (
            <FlatList
              data={candidates}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => pickExisting(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Link to ${item.merchant_name ?? "expense"} ${formatAmount(item.amount)}`}
                  className="flex-row items-center px-3 py-2.5 rounded-lg"
                >
                  <View className="flex-1">
                    <Text
                      className="text-sm font-medium"
                      style={{ color: colors.text }}
                      numberOfLines={1}
                    >
                      {item.description ?? item.merchant_name ?? "Expense"}
                    </Text>
                    <Text className="text-xs" style={{ color: colors.textSecondary }}>
                      {item.date}
                    </Text>
                  </View>
                  <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                    {formatAmount(item.amount)}
                  </Text>
                </Pressable>
              )}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>

        {/* Log-new button */}
        <View className="px-5 pt-3">
          <Pressable
            onPress={logNew}
            accessibilityRole="button"
            accessibilityLabel="Log new expense"
            className="py-3 rounded-xl items-center flex-row justify-center"
            style={{ backgroundColor: accent[500] }}
          >
            <Ionicons name="add-outline" size={18} color="#fff" />
            <Text className="text-sm font-semibold text-white ml-1">
              Log new expense
            </Text>
          </Pressable>
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            className="py-3 mt-2 rounded-xl items-center"
          >
            <Text className="text-sm font-semibold" style={{ color: colors.textSecondary }}>
              Cancel
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}
