import { FieldRow, Text } from "@/components/ui";
import { COMPONENTS } from "@/constants/design-tokens";
import type { Expense } from "@/services/expense";

import { formatDisplayDate as formatDate } from "@/utils/date";
import { formatDateTimeInTimezone } from "@/utils/timezone";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";

const SOURCE_LABELS: Record<string, string> = {
  manual: "Added by you",
  sms_auto: "Bank SMS",
  email_auto: "Email",
};

function formatTimestamp(iso: string): string {
  // SQLite datetime('now') returns YYYY-MM-DD HH:MM:SS format
  // Convert to ISO format for proper timezone conversion
  let isoString: string;
  if (iso.includes("T")) {
    isoString = iso;
  } else if (iso.includes(" ")) {
    // SQLite format: YYYY-MM-DD HH:MM:SS -> YYYY-MM-DDTHH:MM:SS
    isoString = iso.replace(" ", "T");
  } else {
    // Date only: YYYY-MM-DD -> YYYY-MM-DDT00:00:00
    isoString = iso + "T00:00:00";
  }
  return formatDateTimeInTimezone(isoString);
}

interface ExpenseMetadataProps {
  expense: Expense;
  /** Rows that belong with where this came from: the smart rule that changed it, a reminder it fulfilled. */
  children?: ReactNode;
}

/**
 * Where this transaction came from: a SOURCE card (how it got here, what a rule or reminder did to
 * it), then the bank's own message as its own card, folded until tapped.
 */
export default function ExpenseMetadata({ expense, children }: ExpenseMetadataProps) {
  const theme = useTheme();
  const [showRawSms, setShowRawSms] = useState(false);
  const router = useRouter();

  const hasRefund = expense.refund_of_expense_id != null;
  const hasRawSms = expense.raw_source_text != null;

  return (
    <>
      <View className="mx-4 mt-3 rounded-card bg-card border border-border px-4 pb-1">
        <Text className={COMPONENTS.cardHeading} accessibilityRole="header">Source</Text>
        <FieldRow divider={false} label="From" value={SOURCE_LABELS[expense.source] ?? expense.source} />
        <FieldRow
          label="Kind"
          value={
            expense.nature === "forecast" && expense.due_date
              ? `Bill due ${formatDate(expense.due_date)}`
              : expense.nature === "forecast"
                ? "Bill due"
                : expense.nature === "credit"
                  ? "Credit"
                  : expense.nature === "ledger_adjustment"
                    ? "Balance correction"
                    : "Debit"
          }
        />
        <FieldRow label="Added" value={formatTimestamp(expense.created_at)} />
        {hasRefund && (
          <FieldRow
            label="Refund of"
            value="View original expense"
            valueColor={theme.primary}
            onPress={() => router.push(`/expense/${expense.refund_of_expense_id}`)}
          />
        )}
        {children}
      </View>

      {hasRawSms && (
        <Pressable
          onPress={() => setShowRawSms(!showRawSms)}
          className="mx-4 mt-3 rounded-card bg-card border border-border px-4 py-3"
          accessibilityRole="button"
          accessibilityState={{ expanded: showRawSms }}
          accessibilityLabel="Original bank message"
        >
          <View className="flex-row items-center" style={{ minHeight: 28 }}>
            <View className="flex-1">
              <Text className="text-body font-semibold text-foreground">Original bank message</Text>
              <Text className="text-meta text-muted-foreground">{showRawSms ? "Tap to hide" : "Tap to show"}</Text>
            </View>
            <Ionicons name={showRawSms ? "chevron-up" : "chevron-down"} size={18} color={theme.mutedForeground} />
          </View>
          {showRawSms && (
            <View className="mt-3 p-3 rounded-control" style={{ backgroundColor: theme.alpha("foreground", 0.04) }}>
              <Text className="text-meta text-muted-foreground" selectable>
                {expense.raw_source_text}
              </Text>
            </View>
          )}
        </Pressable>
      )}
    </>
  );
}
