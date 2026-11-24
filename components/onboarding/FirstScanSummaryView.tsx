import { View } from "react-native";
import { Text } from "@/components/ui";
import type { FirstScanSummary } from "@/services/first-scan";
import { formatAmount } from "@/utils/format";
import { formatDateForDisplay } from "@/utils/expense-validation";

/** "Here's your money" — the numbers from the first SMS scan. */
export function FirstScanSummaryView({
  summary,
  reviewLabel = "Waiting for review",
  splitAi = false,
}: {
  summary: FirstScanSummary;
  /** Onboarding approves the scan, so only possible duplicates are left to look at there. */
  reviewLabel?: string;
  /** Show what on-device AI read on its own row, and leave it out of reviewLabel's count. */
  splitAi?: boolean;
}) {
  const aiRow = splitAi && summary.readByAi > 0;
  const others = aiRow ? Math.max(0, summary.toReview - summary.readByAi) : summary.toReview;
  const rows: [string, string][] = [
    ["Accounts found", String(summary.accountsFound)],
    ["Top spend", summary.topMerchant ? `${summary.topMerchant.name} · ${formatAmount(summary.topMerchant.amount)}` : "—"],
    [
      "Next due",
      summary.nextDue ? `${summary.nextDue.label} · ${formatDateForDisplay(summary.nextDue.dueDate)}` : "Nothing found",
    ],
    ["FDs and transfers spotted", String(summary.fdsAndTransfers)],
  ];

  return (
    <View>
      <View className="flex-row gap-3 mb-3">
        <View className="flex-1 rounded-xl bg-background p-3">
          <Text className="text-xs text-muted-foreground">Money in</Text>
          <Text className="text-lg font-bold text-success mt-0.5">{formatAmount(summary.moneyIn)}</Text>
        </View>
        <View className="flex-1 rounded-xl bg-background p-3">
          <Text className="text-xs text-muted-foreground">Money out</Text>
          <Text className="text-lg font-bold text-danger mt-0.5">{formatAmount(summary.moneyOut)}</Text>
        </View>
      </View>
      {rows.map(([label, value]) => (
        <View key={label} className="flex-row justify-between py-2 border-b border-border">
          <Text className="text-sm text-muted-foreground">{label}</Text>
          <Text className="text-sm text-foreground ml-3 shrink" numberOfLines={1}>
            {value}
          </Text>
        </View>
      ))}
      <View className={`flex-row justify-between py-2${aiRow ? " border-b border-border" : ""}`}>
        <Text className="text-sm text-muted-foreground">{reviewLabel}</Text>
        <Text className="text-sm font-semibold text-foreground">{others}</Text>
      </View>
      {aiRow && (
        <View className="flex-row justify-between py-2">
          <Text className="text-sm text-muted-foreground">Read by on-device AI, to check</Text>
          <Text className="text-sm font-semibold text-foreground">{summary.readByAi}</Text>
        </View>
      )}
    </View>
  );
}
