import { useColorScheme } from "@/hooks/use-color-scheme";
import { Text } from "@/components/ui";
import type { Expense } from "@/services/expense";
import { ac } from "@/utils/accent";
import { formatDisplayDate as formatDate } from "@/utils/date";
import { formatDateTimeInTimezone } from "@/utils/timezone";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  sms_auto: "SMS Auto",
  email_auto: "Email Auto",
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
}

export default function ExpenseMetadata({ expense }: ExpenseMetadataProps) {
  const { accent, colorScheme, colors } = useColorScheme();
  const [expanded, setExpanded] = useState(false);
  const [showRawSms, setShowRawSms] = useState(false);
  const router = useRouter();

  const hasRefund = expense.refund_of_expense_id != null;
  const hasRawSms = expense.raw_source_text != null;

  return (
    <View className="mx-4 mt-3 rounded-xl bg-card overflow-hidden">
      {/* Header — always visible */}
      <Pressable
        onPress={() => setExpanded(!expanded)}
        className="flex-row items-center justify-between px-4 py-3"
      >
        <Text className="text-sm font-semibold text-muted-foreground">
          Other Info
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.textSecondary}
        />
      </Pressable>

      {expanded && (
        <View className="px-4 pb-4">
          {/* Source */}
          <MetadataRow
            label="Source"
            value={SOURCE_LABELS[expense.source] ?? expense.source}
          />

          {/* Nature */}
          <MetadataRow
            label="Nature"
            value={
              expense.nature === "forecast" && expense.due_date
                ? `Forecast \u2014 due ${formatDate(expense.due_date)}`
                : expense.nature === "forecast"
                  ? "Forecast"
                  : "Realized"
            }
          />

          {/* Created */}
          <MetadataRow
            label="Created"
            value={formatTimestamp(expense.created_at)}
          />

          {/* Raw SMS */}
          {hasRawSms && (
            <View className="mt-2">
              <Pressable
                onPress={() => setShowRawSms(!showRawSms)}
                className="flex-row items-center"
              >
                <Text className="text-xs font-medium text-muted-foreground">
                  Raw SMS
                </Text>
                <Ionicons
                  name={showRawSms ? "chevron-up" : "chevron-down"}
                  size={14}
                  color={colors.textSecondary}
                  style={{ marginLeft: 4 }}
                />
              </Pressable>
              {showRawSms && (
                <View className="mt-1.5 p-3 rounded-lg bg-background">
                  <Text className="text-xs text-muted-foreground leading-4">
                    {expense.raw_source_text}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Refund link */}
          {hasRefund && (
            <View className="mt-2">
              <Pressable
                onPress={() =>
                  router.push(`/expense/${expense.refund_of_expense_id}`)
                }
                className="flex-row items-center"
              >
                <Text className="text-xs font-medium text-muted-foreground">
                  Refund of:
                </Text>
                <Text className="text-xs ml-1.5 underline" style={{ color: ac(accent, colorScheme, 500, 200) }}>
                  View original expense
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <Text className="text-xs text-muted-foreground">
        {label}
      </Text>
      <Text className="text-xs font-medium text-foreground">
        {value}
      </Text>
    </View>
  );
}
