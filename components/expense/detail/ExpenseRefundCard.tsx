import { View } from "react-native";
import { IconRow, Text } from "@/components/ui";
import { formatAmount } from "@/utils/format";
import type { Expense } from "@/services/expense";

export interface RefundRecord {
  id: string;
  amount: number;
  date: string;
}

interface ExpenseRefundCardProps {
  expense: Expense;
  refunds: RefundRecord[];
  /** Total already refunded, used to decide whether more can still be recorded. */
  refundedAmount: number;
  onUndoRefund: (refundId: string) => void;
  onRecordRefund: () => void;
}

/**
 * Refunds recorded against an expense, and the row for adding another.
 *
 * Split out of app/expense/[id].tsx. Only realized expenses can be refunded, and the "record"
 * row disappears once the full amount is back - both rules live here now rather than as two
 * separate conditions at the call site.
 */
export function ExpenseRefundCard({
  expense,
  refunds,
  refundedAmount,
  onUndoRefund,
  onRecordRefund,
}: ExpenseRefundCardProps) {
  if (expense.nature !== "realized") return null;

  // Split expenses are refunded against the original amount, not the user's share.
  const refundable = expense.split_original_amount ?? expense.amount;
  const canRecordMore = refundedAmount < refundable;

  return (
    <>
      {refunds.length > 0 && (
        <View className="mx-4 mt-3 rounded-xl bg-card overflow-hidden">
          <View className="px-4 pt-3 pb-1">
            <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Refund Details
            </Text>
          </View>

          {refunds.map((refund, idx) => (
            <View key={refund.id}>
              <IconRow
                icon="return-up-back-outline"
                title={refunds.length > 1 ? `Refund ${idx + 1}` : "Refunded"}
                right={
                  <View className="items-end">
                    <Text className="text-sm font-semibold text-foreground">
                      {formatAmount(refund.amount)}
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">{refund.date}</Text>
                  </View>
                }
              />
              <IconRow
                icon="arrow-undo-outline"
                title="Undo Refund"
                subtitle="Remove this refund record"
                onPress={() => onUndoRefund(refund.id)}
                className="mx-4 mb-3 bg-background"
              />
            </View>
          ))}
        </View>
      )}

      {canRecordMore && (
        <IconRow
          icon="return-up-back-outline"
          title="Record a Refund"
          subtitle="Money came back for this expense"
          chevron
          onPress={onRecordRefund}
          className="mx-4 mt-3 bg-card"
          accessibilityLabel="Record a refund for this expense"
        />
      )}
    </>
  );
}
