import { View } from "react-native";
import { Button, EmptyState } from "@/components/ui";
import type { CatchUpStats } from "@/services/catch-up";
import { formatAmount } from "@/utils/format";

interface CatchUpDoneProps {
  stats: CatchUpStats;
  onViewSpending: () => void;
  onClose: () => void;
}

export function CatchUpDone({ stats, onViewSpending, onClose }: CatchUpDoneProps) {
  const lines: string[] = [];
  if (stats.approved > 0) {
    lines.push(
      `Approved ${stats.approved}${stats.approvedSpend > 0 ? ` (${formatAmount(stats.approvedSpend)} spent)` : ""}`,
    );
  }
  if (stats.resolved > 0) lines.push(`Sorted out ${stats.resolved}`);
  if (stats.rejected > 0) lines.push(`Rejected ${stats.rejected}`);
  if (stats.skipped > 0) lines.push(`Skipped ${stats.skipped}`);

  const subtitle = [
    lines.join(" · "),
    stats.skipped > 0
      ? `${stats.skipped} skipped item${stats.skipped !== 1 ? "s are" : " is"} still in your review queue.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <EmptyState
      icon="checkmark-done-outline"
      title="You're all caught up"
      subtitle={subtitle || undefined}
      action={
        <View className="w-full px-4 mt-4 gap-3">
          <Button title="See this month's spending" onPress={onViewSpending} />
          <Button title="Done" variant="outline" onPress={onClose} />
        </View>
      }
    />
  );
}
