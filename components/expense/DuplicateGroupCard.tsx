import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { formatAmount, formatDateForDisplay } from "@/utils/expense-validation";
import type { DuplicateGroup } from "@/services/duplicate-detection";

interface DuplicateGroupCardProps {
  group: DuplicateGroup;
  index: number;
  onRejectDuplicate?: (expenseId: string) => void;
  onAutoResolve?: (group: DuplicateGroup) => void;
  onKeepBoth?: (group: DuplicateGroup) => void;
  onTapExpense: (expenseId: string) => void;
  /**
   * Read-only mode (used on the Dismissed Duplicates screen). Hides the
   * Keep Both / Auto-Resolve / per-row reject actions and shows a single
   * "Restore" button instead.
   */
  readOnly?: boolean;
  onRestore?: (group: DuplicateGroup) => void;
}

export function DuplicateGroupCard({
  group,
  index,
  onRejectDuplicate,
  onAutoResolve,
  onKeepBoth,
  onTapExpense,
  readOnly,
  onRestore,
}: DuplicateGroupCardProps) {
  const { colors, colorScheme } = useColorScheme();

  // Sort: latest first (the one to keep on auto-resolve)
  const sorted = [...group.expenses].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const warn = StatusColors[colorScheme].warning;
  const success = StatusColors[colorScheme].success;
  const danger = StatusColors[colorScheme].danger;

  return (
    <View className="mx-4 my-2.5 rounded-2xl bg-surface-light-alt dark:bg-surface-dark-alt border border-border-light dark:border-border-dark overflow-hidden">
      {/* ── Header ────────────────────────────────────────────────── */}
      <View className="px-4 pt-4 pb-3">
        <View className="flex-row items-center mb-2">
          <View
            className="w-8 h-8 rounded-full items-center justify-center mr-2.5"
            style={{ backgroundColor: warn + "1A" }}
          >
            <Ionicons name="copy-outline" size={16} color={warn} />
          </View>
          <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary">
            Possible Duplicate
          </Text>
          <View className="ml-auto px-2 py-0.5 rounded-full" style={{ backgroundColor: warn + "14" }}>
            <Text className="text-[11px] font-semibold" style={{ color: warn }}>
              #{index + 1}
            </Text>
          </View>
        </View>
        <Text
          className="text-xs text-text-secondary dark:text-text-dark-secondary leading-5"
          numberOfLines={3}
        >
          {group.reason}
        </Text>
      </View>

      {/* ── Entries ────────────────────────────────────────────────── */}
      <View className="border-t border-border-light dark:border-border-dark">
        {sorted.map((expense, i) => {
          const isFirst = i === 0;
          const statusColor =
            expense.status === "approved"
              ? success
              : expense.status === "pending_review"
                ? warn
                : danger;
          const statusLabel =
            expense.status === "approved"
              ? "Approved"
              : expense.status === "pending_review"
                ? "Pending"
                : "Rejected";

          return (
            <View
              key={expense.id}
              className={`px-4 py-3 flex-row items-center ${i < sorted.length - 1 ? "border-b border-border-light dark:border-border-dark" : ""}`}
            >
              {/* Lane indicator — keep vs reject */}
              <View
                className="w-9 h-9 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: (isFirst ? success : danger) + "14" }}
              >
                <Ionicons
                  name={isFirst ? "shield-checkmark-outline" : "close-outline"}
                  size={18}
                  color={isFirst ? success : danger}
                />
              </View>

              {/* Content */}
              <Pressable
                onPress={() => onTapExpense(expense.id)}
                className="flex-1 mr-2"
                accessibilityRole="button"
                accessibilityLabel={`Open ${expense.merchant_name ?? "expense"}`}
              >
                <View className="flex-row items-center justify-between">
                  <Text
                    className="text-sm font-semibold text-text-primary dark:text-text-dark-primary flex-1 mr-2"
                    numberOfLines={1}
                  >
                    {expense.description ?? expense.merchant_name ?? "No details"}
                  </Text>
                  <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary shrink-0">
                    {formatAmount(expense.amount)}
                  </Text>
                </View>
                <View className="flex-row items-center mt-1">
                  <Text className="text-xs text-text-tertiary dark:text-text-dark-secondary">
                    {formatDateForDisplay(expense.date)}
                  </Text>
                  <View className="w-1 h-1 rounded-full mx-1.5" style={{ backgroundColor: colors.textSecondary + "66" }} />
                  <View
                    className="px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: `${statusColor}14` }}
                  >
                    <Text className="text-[10px] font-semibold" style={{ color: statusColor }}>
                      {statusLabel}
                    </Text>
                  </View>
                  {isFirst && (
                    <View className="ml-1.5 px-1.5 py-0.5 rounded-full" style={{ backgroundColor: success + "14" }}>
                      <Text className="text-[10px] font-semibold" style={{ color: success }}>
                        LATEST
                      </Text>
                    </View>
                  )}
                </View>
              </Pressable>

              {/* Per-row reject — available on every row so user can keep whichever entry they prefer */}
              {!readOnly && onRejectDuplicate && (
                <Pressable
                  onPress={() => onRejectDuplicate(expense.id)}
                  className="w-9 h-9 rounded-full items-center justify-center"
                  style={{ backgroundColor: danger + "14" }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Reject this duplicate"
                >
                  <Ionicons name="trash-outline" size={16} color={danger} />
                </Pressable>
              )}
            </View>
          );
        })}
      </View>

      {/* ── Actions ────────────────────────────────────────────────── */}
      {readOnly ? (
        <View className="flex-row px-4 py-3 border-t border-border-light dark:border-border-dark">
          <Pressable
            onPress={() => onRestore?.(group)}
            className="flex-1 flex-row items-center justify-center py-2.5 rounded-xl"
            style={{ backgroundColor: warn + "14" }}
            accessibilityRole="button"
            accessibilityLabel="Restore this group for re-review"
          >
            <Ionicons name="refresh-outline" size={16} color={warn} />
            <Text className="text-xs font-semibold ml-1.5" style={{ color: warn }}>
              Restore for Re-review
            </Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-row px-4 py-3 border-t border-border-light dark:border-border-dark gap-2">
          <Pressable
            onPress={() => onKeepBoth?.(group)}
            className="flex-1 flex-row items-center justify-center py-2.5 rounded-xl"
            style={{ backgroundColor: success + "14" }}
            accessibilityRole="button"
            accessibilityLabel="Keep both - not duplicates"
          >
            <Ionicons name="checkmark-circle-outline" size={16} color={success} />
            <Text className="text-xs font-semibold ml-1.5" style={{ color: success }}>
              Keep Both
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onAutoResolve?.(group)}
            className="flex-1 flex-row items-center justify-center py-2.5 rounded-xl"
            style={{ backgroundColor: danger + "14" }}
            accessibilityRole="button"
            accessibilityLabel="Auto-resolve: keep latest, reject duplicates"
          >
            <Ionicons name="flash-outline" size={16} color={danger} />
            <Text className="text-xs font-semibold ml-1.5" style={{ color: danger }}>
              Auto-Resolve
            </Text>
          </Pressable>
        </View>
      )}

      {/* ── Footnote ───────────────────────────────────────────────── */}
      <View className="px-4 pb-3 -mt-1">
        <Text className="text-[11px] text-text-tertiary dark:text-text-dark-secondary">
          {readOnly
            ? "You marked this group as 'not duplicates'. Restore to flag it again on the next scan."
            : "Auto-Resolve keeps the latest and rejects the rest. Use the trash icons to manually keep whichever entry you prefer. Keep Both marks them as not duplicates."}
        </Text>
      </View>
    </View>
  );
}
