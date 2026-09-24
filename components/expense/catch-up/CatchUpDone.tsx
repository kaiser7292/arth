import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { Button, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import type { CatchUpStats } from "@/services/catch-up";
import { formatAmount } from "@/utils/format";

interface CatchUpDoneProps {
  stats: CatchUpStats;
  onViewSpending: () => void;
  onClose: () => void;
}

export function CatchUpDone({ stats, onViewSpending, onClose }: CatchUpDoneProps) {
  const theme = useTheme();
  const lines: string[] = [];
  if (stats.approved > 0) {
    lines.push(
      `Approved ${stats.approved}${stats.approvedSpend > 0 ? ` (${formatAmount(stats.approvedSpend)} spent)` : ""}`,
    );
  }
  if (stats.resolved > 0) lines.push(`Sorted out ${stats.resolved}`);
  if (stats.rejected > 0) lines.push(`Rejected ${stats.rejected}`);
  if (stats.skipped > 0) lines.push(`Skipped ${stats.skipped}`);

  return (
    <View className="flex-1 items-center justify-center px-8">
      <View
        className="w-20 h-20 rounded-full items-center justify-center mb-5"
        style={{ backgroundColor: theme.alpha("success", 0.12) }}
      >
        <Ionicons name="checkmark-done" size={40} color={theme.success} />
      </View>
      <Text className="text-xl font-bold text-foreground text-center">You're all caught up</Text>
      {lines.length > 0 && (
        <Text className="text-sm text-muted-foreground text-center mt-2">{lines.join(" · ")}</Text>
      )}
      {stats.skipped > 0 && (
        <Text className="text-xs text-muted-foreground text-center mt-3">
          {stats.skipped} skipped item{stats.skipped !== 1 ? "s are" : " is"} still in your review queue.
        </Text>
      )}
      <View className="w-full mt-8">
        <Button title="See this month's spending" onPress={onViewSpending} />
        <View className="h-3" />
        <Button title="Done" variant="secondary" onPress={onClose} />
      </View>
    </View>
  );
}
