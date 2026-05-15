import { useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ScreenContainer, Card, SectionHeader, LoadingState, AlertBanner } from "@/components/ui";
import { StatusPill } from "@/components/ui/StatusPill";
import { PatternEditSheet } from "@/components/analytics/PatternEditSheet";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useAlert } from "@/hooks/use-alert";
import { StatusColors } from "@/constants/theme";
import {
  getRecurringTransactions,
  confirmRecurring,
  dismissRecurring,
  detectRecurringTransactionsDetailed,
  type RecurringTransaction,
  type DetectionSummary,
} from "@/services/recurring-detector";
import { getCategories } from "@/services/category";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";
import { getErrorMessage } from "@/utils/error-message";

type PatternType = "fixed" | "semi" | "variable";

interface PatternGroup {
  type: PatternType;
  title: string;
  items: RecurringTransaction[];
}

export default function PatternLibraryScreen() {
  const alert = useAlert();
  const { colorScheme, colors } = useColorScheme();
  const statusColors = StatusColors[colorScheme];
  const [patterns, setPatterns] = useState<RecurringTransaction[]>([]);
  const [categories, setCategories] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [editingPattern, setEditingPattern] = useState<RecurringTransaction | null>(null);
  const [showEditSheet, setShowEditSheet] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [lastSummary, setLastSummary] = useState<DetectionSummary | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [recurrings, cats] = await Promise.all([
        getRecurringTransactions(DEFAULT_USER_ID),
        getCategories(DEFAULT_USER_ID),
      ]);
      setPatterns(recurrings);
      setCategories(new Map(cats.map((c) => [c.id, c.name])));
    } catch {
      // DB not ready
    } finally {
      setLoading(false);
    }
  }, []);

  useDataRefresh(loadData);

  const handleConfirm = async (id: string) => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await confirmRecurring(id);
  };

  const handleDismiss = async (id: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await dismissRecurring(id);
  };

  const handleEdit = (pattern: RecurringTransaction) => {
    setEditingPattern(pattern);
    setShowEditSheet(true);
  };

  const handleRescan = useCallback(async () => {
    setRescanning(true);
    try {
      const summary = await detectRecurringTransactionsDetailed(DEFAULT_USER_ID);
      setLastSummary(summary);
      await loadData();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Build a concise human-readable breakdown of why merchants were skipped.
      const skippedCounts = summary.skipped.reduce(
        (acc, s) => {
          acc[s.outcome] = (acc[s.outcome] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      const skipParts: string[] = [];
      if (skippedCounts.single_occurrence) skipParts.push(`${skippedCounts.single_occurrence} seen only once`);
      if (skippedCounts.amount_variance) skipParts.push(`${skippedCounts.amount_variance} with inconsistent amounts`);
      if (skippedCounts.irregular_interval) skipParts.push(`${skippedCounts.irregular_interval} with irregular timing`);

      const topSkipped = summary.skipped
        .filter((s) => s.outcome === "irregular_interval")
        .slice(0, 3)
        .map((s) => `${s.merchant} (~${s.avgIntervalDays?.toFixed(0)}d)`)
        .join(", ");

      const lines = [
        `Scanned ${summary.scannedExpenses} expenses across ${summary.uniqueMerchants} merchants.`,
        `${summary.detected} pattern${summary.detected !== 1 ? "s" : ""} detected.`,
      ];
      if (skipParts.length > 0) lines.push(`Skipped: ${skipParts.join(", ")}.`);
      if (topSkipped) lines.push(`Irregular examples: ${topSkipped}.`);

      alert("Pattern Scan Complete", lines.join("\n\n"));
    } catch (e) {
      alert("Scan failed", getErrorMessage(e));
    } finally {
      setRescanning(false);
    }
  }, [loadData, alert]);

  if (loading) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Loading patterns..." />
      </ScreenContainer>
    );
  }

  // Group patterns
  const groups = groupPatterns(patterns);
  const confirmedCount = patterns.filter((p) => p.is_confirmed === 1).length;
  const dataMonths = patterns.length > 0 ? Math.max(2, Math.min(patterns.reduce((max, p) => Math.max(max, p.occurrence_count), 0), 12)) : 0;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>
        {/* Re-scan button — manually re-run detection on full expense history. */}
        <View className="px-4 mt-3 flex-row items-center justify-end">
          <Pressable
            onPress={handleRescan}
            disabled={rescanning}
            className="flex-row items-center px-3 py-2 rounded-full border border-border-light dark:border-border-dark"
            style={{ opacity: rescanning ? 0.5 : 1 }}
          >
            <Ionicons
              name={rescanning ? "sync" : "refresh-outline"}
              size={14}
              color={colors.tint}
            />
            <Text className="text-xs font-medium ml-1.5" style={{ color: colors.tint }}>
              {rescanning ? "Scanning..." : "Re-scan patterns"}
            </Text>
          </Pressable>
        </View>

        {/* Learning Status Banner */}
        {patterns.length > 0 && (
          <View className="mt-3">
            <AlertBanner
              severity="info"
              message={`Based on ~${dataMonths} months of data. ${patterns.length} patterns detected, ${confirmedCount} confirmed. Tap any pattern to edit.`}
            />
          </View>
        )}

        {/* Last scan summary (shown after a manual re-scan) */}
        {lastSummary && (
          <View className="mx-4 mt-2 px-3 py-2 rounded-lg bg-surface-light-alt dark:bg-surface-dark-alt">
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
              Last scan: {lastSummary.scannedExpenses} expenses · {lastSummary.uniqueMerchants} merchants · {lastSummary.detected} patterns · {lastSummary.skipped.length} skipped
            </Text>
          </View>
        )}

        {/* Pattern Groups */}
        {groups.map((group) => (
          <View key={group.type} className="px-4 mt-4">
            <SectionHeader title={group.title} />
            <Card>
              {group.items.map((item, idx) => (
                <PatternRow
                  key={item.id}
                  pattern={item}
                  categoryName={item.category_id ? categories.get(item.category_id) ?? "Unknown" : "Uncategorized"}
                  statusColors={statusColors}
                  isLast={idx === group.items.length - 1}
                  onEdit={() => handleEdit(item)}
                  onConfirm={() => handleConfirm(item.id)}
                  onDismiss={() => handleDismiss(item.id)}
                />
              ))}
            </Card>
          </View>
        ))}

        {/* Empty State */}
        {patterns.length === 0 && (
          <View className="items-center py-16 px-8">
            <Ionicons name="bulb-outline" size={48} color={statusColors.muted} />
            <Text className="text-lg font-medium text-text-primary dark:text-text-dark-primary mt-4">
              No patterns detected yet
            </Text>
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-1 text-center">
              Keep tracking expenses for 2-3 months and recurring costs will be identified automatically.
            </Text>
            <Pressable
              onPress={handleRescan}
              disabled={rescanning}
              className="mt-4 px-4 py-2.5 rounded-full border border-border-light dark:border-border-dark"
              style={{ opacity: rescanning ? 0.5 : 1 }}
            >
              <Text className="text-sm font-medium" style={{ color: colors.tint }}>
                {rescanning ? "Scanning..." : "Scan now →"}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Edit Sheet */}
      {editingPattern && (
        <PatternEditSheet
          visible={showEditSheet}
          pattern={editingPattern}
          onClose={() => {
            setShowEditSheet(false);
            setEditingPattern(null);
          }}
        />
      )}
    </ScreenContainer>
  );
}

// ─── Pattern Row ───

function PatternRow({
  pattern,
  categoryName,
  statusColors,
  isLast,
  onEdit,
  onConfirm,
  onDismiss,
}: {
  pattern: RecurringTransaction;
  categoryName: string;
  statusColors: { success: string; successBg: string; danger: string; dangerBg: string; warning: string; warningBg: string; muted: string };
  isLast: boolean;
  onEdit: () => void;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const confidence = pattern.is_confirmed === 1 ? 100 : Math.min(95, pattern.occurrence_count * 15 + 40);
  const isConfirmed = pattern.is_confirmed === 1;
  const expectedDay = new Date(pattern.last_seen_date).getDate();

  return (
    <Pressable
      onPress={onEdit}
      className={`py-3 ${!isLast ? "border-b border-border-light dark:border-border-dark" : ""}`}
      accessibilityLabel={`${pattern.merchant_normalized}, ${formatAmount(pattern.amount)} ${pattern.frequency}. Confidence: ${confidence}%. Double tap to edit.`}
      accessibilityHint="Double tap to edit pattern"
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1 mr-3">
          <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary capitalize">
            {pattern.merchant_normalized}
          </Text>
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
            {formatAmount(pattern.amount)} · {capitalizeFirst(pattern.frequency)} · ~Day {expectedDay}
          </Text>
          <View className="flex-row items-center gap-2 mt-1">
            <StatusPill
              label={isConfirmed ? "Confirmed" : "Auto-detected"}
              color={isConfirmed ? statusColors.success : statusColors.muted}
              icon={isConfirmed ? "checkmark-circle" : "scan-outline"}
            />
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
              {confidence}%
            </Text>
          </View>
        </View>

        {!isConfirmed && (
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={onConfirm}
              className="w-8 h-8 rounded-full items-center justify-center"
              style={{ backgroundColor: statusColors.success + "18" }}
              accessibilityLabel="Confirm pattern"
            >
              <Ionicons name="checkmark" size={16} color={statusColors.success} />
            </Pressable>
            <Pressable
              onPress={onDismiss}
              className="w-8 h-8 rounded-full items-center justify-center"
              style={{ backgroundColor: statusColors.danger + "18" }}
              accessibilityLabel="Dismiss pattern"
            >
              <Ionicons name="close" size={16} color={statusColors.danger} />
            </Pressable>
          </View>
        )}

        {isConfirmed && (
          <Pressable onPress={onEdit} accessibilityLabel="Edit pattern">
            <Text className="text-xs font-medium" style={{ color: statusColors.muted }}>
              Edit
            </Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

// ─── Helpers ───

function groupPatterns(patterns: RecurringTransaction[]): PatternGroup[] {
  const fixed = patterns.filter((p) => p.frequency === "monthly" || p.frequency === "yearly");
  const semi = patterns.filter((p) => p.frequency === "weekly" || p.frequency === "quarterly");

  const groups: PatternGroup[] = [];
  if (fixed.length > 0) groups.push({ type: "fixed", title: "Fixed Monthly", items: fixed });
  if (semi.length > 0) groups.push({ type: "semi", title: "Semi-Fixed", items: semi });
  return groups;
}


function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
