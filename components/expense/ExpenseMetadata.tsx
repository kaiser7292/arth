import { FieldRow, SectionTitle, Text } from "@/components/ui";
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
  sms_auto: "Read from an SMS",
  email_auto: "Read from an email",
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
 * The Source card: how this transaction got here. The details and the bank's message are folded
 * away; anything a rule or reminder did to it stays visible above the fold.
 */
export default function ExpenseMetadata({ expense, children }: ExpenseMetadataProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [showRawSms, setShowRawSms] = useState(false);
  const router = useRouter();

  const hasRefund = expense.refund_of_expense_id != null;
  const hasRawSms = expense.raw_source_text != null;

  return (
    <View className="mx-4 mt-3 rounded-card bg-card border border-border px-4 pt-4 pb-1">
      <Pressable
        onPress={() => setExpanded(!expanded)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        className="pb-3"
      >
        <SectionTitle
          icon={expense.source === "sms_auto" ? "chatbubble-outline" : "information-circle-outline"}
          title="Source"
          hint={SOURCE_LABELS[expense.source] ?? expense.source}
          right={<Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={theme.mutedForeground} />}
        />
      </Pressable>

      {children}

      {expanded && (
        <View>
          <FieldRow
            label="Kind"
            value={
              expense.nature === "forecast" && expense.due_date
                ? `Forecast, due ${formatDate(expense.due_date)}`
                : expense.nature === "forecast"
                  ? "Forecast"
                  : expense.nature === "credit"
                    ? "Money in"
                    : "Spent"
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
          {hasRawSms && (
            <View className="border-t border-border py-3">
              <Pressable
                onPress={() => setShowRawSms(!showRawSms)}
                className="flex-row items-center justify-between"
                style={{ minHeight: 32 }}
                accessibilityRole="button"
                accessibilityState={{ expanded: showRawSms }}
              >
                <Text className="text-meta text-muted-foreground">Original bank message</Text>
                <Text className="text-meta font-semibold" style={{ color: theme.primary }}>
                  {showRawSms ? "Hide" : "Tap to show"}
                </Text>
              </Pressable>
              {showRawSms && (
                <View className="mt-2 p-3 rounded-control" style={{ backgroundColor: theme.alpha("foreground", 0.04) }}>
                  <Text className="text-meta text-muted-foreground" selectable>
                    {expense.raw_source_text}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}
