import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, ScrollView, View } from "react-native";

import { AlertBanner, Badge, Card, SectionHeader, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import type { ExpenseClassificationRow } from "@/services/analytics/classifier";
import {
  EVERY,
  amountText,
  countedBills,
  dayText,
  groupPatterns,
  monthlyEquivalent,
} from "@/utils/analytics/pattern-display";
import { formatDateForDisplay } from "@/utils/expense-validation";
import { formatAmount } from "@/utils/format";

interface PatternLibraryViewProps {
  patterns: ExpenseClassificationRow[];
  rescanning: boolean;
  onRescan: () => void;
  onConfirm: (pattern: ExpenseClassificationRow) => void;
  onNotBill: (pattern: ExpenseClassificationRow) => void;
  onEdit: (pattern: ExpenseClassificationRow) => void;
  /** Take back a "not a bill" answer. */
  onForget: (pattern: ExpenseClassificationRow) => void;
}

/**
 * The regular payments Arth has learned — the same list the month-end projection counts as
 * bills. Presentational only, so the preview harness can render it without a database.
 */
export function PatternLibraryView({
  patterns,
  rescanning,
  onRescan,
  onConfirm,
  onNotBill,
  onEdit,
  onForget,
}: PatternLibraryViewProps) {
  const theme = useTheme();
  const groups = groupPatterns(patterns);
  const counted = countedBills(patterns);
  const perMonth = counted.reduce((s, c) => s + monthlyEquivalent(c), 0);

  if (patterns.length === 0) {
    return (
      <View className="items-center py-16 px-8">
        <Ionicons name="repeat-outline" size={48} color={theme.faintForeground} />
        <Text className="text-lg font-medium text-foreground mt-4">No regular payments yet</Text>
        <Text className="text-sm text-muted-foreground mt-1 text-center">
          Arth looks for payments at a steady rhythm — rent, a subscription, a school fee. It needs to see one
          at least three times in the last 6 months.
        </Text>
        <RescanButton rescanning={rescanning} onPress={onRescan} className="mt-4" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>
      <View className="mt-3">
        <AlertBanner
          severity="info"
          message={
            counted.length > 0
              ? `${counted.length} regular payment${counted.length !== 1 ? "s" : ""}, about ${formatAmount(Math.round(perMonth))} a month, are counted as bills in your month-end projection.`
              : "No regular payments are counted in your month-end projection right now."
          }
        />
      </View>

      <View className="px-4 mt-3 flex-row items-center justify-between">
        <Text className="text-xs text-muted-foreground flex-1 mr-3">Learned from the last 6 months, refreshed daily.</Text>
        <RescanButton rescanning={rescanning} onPress={onRescan} />
      </View>

      {groups.toConfirm.length > 0 && (
        <View className="px-4 mt-4">
          <SectionHeader title="Is this a regular bill?" />
          <Card>
            {groups.toConfirm.map((p, i) => (
              <PatternRow
                key={p.id}
                pattern={p}
                isLast={i === groups.toConfirm.length - 1}
                onPress={() => onEdit(p)}
                trailing={
                  <View className="flex-row items-center" style={{ gap: 8 }}>
                    <RoundButton icon="checkmark" role="success" label={`Yes, ${p.merchant_normalized} is a bill`} onPress={() => onConfirm(p)} />
                    <RoundButton icon="close" role="danger" label={`No, ${p.merchant_normalized} varies`} onPress={() => onNotBill(p)} />
                  </View>
                }
              />
            ))}
          </Card>
        </View>
      )}

      {groups.yours.length > 0 && (
        <View className="px-4 mt-4">
          <SectionHeader title="Your bills" />
          <Card>
            {groups.yours.map((p, i) => (
              <PatternRow
                key={p.id}
                pattern={p}
                isLast={i === groups.yours.length - 1}
                onPress={() => onEdit(p)}
                trailing={<Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />}
              />
            ))}
          </Card>
        </View>
      )}

      {groups.paused.length > 0 && (
        <View className="px-4 mt-4">
          <SectionHeader title="Paused" />
          <Text className="text-xs text-muted-foreground mb-2">
            Not seen lately, so left out of the projection. They come back on their own when you pay again.
          </Text>
          <Card>
            {groups.paused.map((p, i) => (
              <PatternRow
                key={p.id}
                pattern={p}
                isLast={i === groups.paused.length - 1}
                onPress={() => onEdit(p)}
                trailing={<Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />}
              />
            ))}
          </Card>
        </View>
      )}

      {groups.notBills.length > 0 && (
        <View className="px-4 mt-4">
          <SectionHeader title="Not bills" />
          <Text className="text-xs text-muted-foreground mb-2">
            You said these vary, so they count as everyday spending.
          </Text>
          <Card>
            {groups.notBills.map((p, i) => (
              <Pressable
                key={p.id}
                onPress={() => onForget(p)}
                className={`flex-row items-center justify-between ${i < groups.notBills.length - 1 ? "border-b border-border" : ""}`}
                style={{ minHeight: 48 }}
                accessibilityRole="button"
                accessibilityLabel={`${p.merchant_normalized}, not a bill. Tap to let Arth decide again.`}
              >
                <Text className="text-sm font-medium text-foreground capitalize flex-1 mr-3" numberOfLines={1}>
                  {p.merchant_normalized}
                </Text>
                <Text className="text-xs font-medium" style={{ color: theme.primary }}>Undo</Text>
              </Pressable>
            ))}
          </Card>
        </View>
      )}
    </ScrollView>
  );
}

function PatternRow({
  pattern,
  isLast,
  onPress,
  trailing,
}: {
  pattern: ExpenseClassificationRow;
  isLast: boolean;
  onPress: () => void;
  trailing: React.ReactNode;
}) {
  const every = EVERY[pattern.frequency ?? "monthly"] ?? pattern.frequency ?? "";
  // "Around the 5th" only means something for a monthly rhythm.
  const when = pattern.frequency === "monthly" ? dayText(pattern.expected_day_of_month).toLowerCase() : null;
  const seen = `Seen ${pattern.occurrence_count} time${pattern.occurrence_count !== 1 ? "s" : ""} in 6 months`;
  const last = pattern.last_seen_date ? `last ${formatDateForDisplay(pattern.last_seen_date)}` : null;

  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center py-3 ${!isLast ? "border-b border-border" : ""}`}
      accessibilityRole="button"
      accessibilityLabel={`${pattern.merchant_normalized}, ${amountText(pattern)} ${every}. Tap to edit.`}
    >
      <View className="flex-1 mr-3">
        <View className="flex-row items-center">
          <Text className="text-sm font-medium text-foreground capitalize flex-shrink mr-2" numberOfLines={1}>
            {pattern.merchant_normalized}
          </Text>
          {pattern.classification === "semi_fixed" && <Badge label="Amount varies" variant="neutral" size="sm" />}
        </View>
        <Text className="text-xs text-muted-foreground mt-0.5">
          {[amountText(pattern), every, when].filter(Boolean).join(" · ")}
        </Text>
        <Text className="text-xs text-faint-foreground mt-0.5">
          {[seen, last].filter(Boolean).join(" · ")}
        </Text>
      </View>
      {trailing}
    </Pressable>
  );
}

function RoundButton({
  icon,
  role,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  role: "success" | "danger";
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      className="w-9 h-9 rounded-full items-center justify-center"
      style={{ backgroundColor: theme.alpha(role, 0.1) }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={18} color={theme[role]} />
    </Pressable>
  );
}

function RescanButton({
  rescanning,
  onPress,
  className = "",
}: {
  rescanning: boolean;
  onPress: () => void;
  className?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={rescanning}
      className={`flex-row items-center px-3 rounded-full border border-border ${className}`}
      style={{ minHeight: 36, opacity: rescanning ? 0.5 : 1 }}
      accessibilityRole="button"
    >
      <Ionicons name={rescanning ? "sync" : "refresh-outline"} size={14} color={theme.primary} />
      <Text className="text-xs font-medium ml-1.5" style={{ color: theme.primary }}>
        {rescanning ? "Scanning..." : "Re-scan"}
      </Text>
    </Pressable>
  );
}
