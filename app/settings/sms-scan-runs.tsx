import { useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { useRouter, Stack } from "expo-router";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getScanRuns, type ScanRun } from "@/services/sms-scan-logging";
import { formatAmount } from "@/utils/format";

export default function SmsScanRunsScreen() {
  const router = useRouter();
  const { colors, accent, colorScheme } = useColorScheme();
  const sc = StatusColors[colorScheme];

  const [scanRuns, setScanRuns] = useState<ScanRun[]>([]);
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadScanRuns();
    }, []),
  );

  async function loadScanRuns() {
    setLoading(true);
    try {
      const runs = await getScanRuns(DEFAULT_USER_ID);
      setScanRuns(runs);
    } catch (error) {
      console.error("Failed to load scan runs:", error);
    } finally {
      setLoading(false);
    }
  }

  function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatDateRange(startDate: string | null, endDate: string | null): string {
    if (!startDate && !endDate) return "All time";
    if (startDate && endDate) return `${startDate} to ${endDate}`;
    if (startDate) return `Since ${startDate}`;
    if (endDate) return `Until ${endDate}`;
    return "Custom range";
  }

  function formatAccountIds(accountIds: string | null): string {
    if (!accountIds) return "All accounts";
    try {
      const ids = JSON.parse(accountIds);
      return `${ids.length} account${ids.length > 1 ? "s" : ""} selected`;
    } catch {
      return "Custom selection";
    }
  }

  return (
    <ScreenContainer>
      <Stack.Screen
        options={{
          title: "SMS Scan Runs",
          headerLeft: () => (
            <Pressable onPress={() => router.back()} className="mr-4">
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView className="flex-1">
        {loading ? (
          <View className="flex-1 justify-center items-center py-12">
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Loading scan runs...</Text>
          </View>
        ) : scanRuns.length === 0 ? (
          <View className="flex-1 justify-center items-center py-12">
            <Ionicons name="document-text-outline" size={48} color={colors.textSecondary} />
            <Text className="mt-4 text-sm text-text-secondary dark:text-text-dark-secondary">No scan runs yet</Text>
          </View>
        ) : (
          <View className="p-4 space-y-4">
            {scanRuns.map((run) => (
              <Pressable
                key={run.id}
                onPress={() => router.push(`/settings/sms-scan-runs/${run.id}`)}
              >
                <Card className="p-4">
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                      {run.is_manual ? "Manual Scan" : "Auto Scan"} • {formatTimestamp(run.run_timestamp)}
                    </Text>
                    {run.error_message ? (
                      <Ionicons name="alert-circle" size={20} color={sc.danger} />
                    ) : (
                      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                    )}
                  </View>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-1">
                    Date: {formatDateRange(run.start_date, run.end_date)}
                  </Text>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-3">
                    Accounts: {formatAccountIds(run.account_ids)}
                  </Text>
                  <View className="flex-row items-center space-x-2">
                    <Text className="text-xs text-text-primary dark:text-text-dark-primary">
                      {run.sms_read_count} SMS read
                    </Text>
                    <Text className="text-xs text-text-tertiary dark:text-text-dark-tertiary">•</Text>
                    <Text className="text-xs text-text-primary dark:text-text-dark-primary">
                      {run.sms_parsed_count} parsed
                    </Text>
                    <Text className="text-xs text-text-tertiary dark:text-text-dark-tertiary">•</Text>
                    <Text className="text-xs text-text-primary dark:text-text-dark-primary">
                      {run.sms_filtered_count} filtered
                    </Text>
                    <Text className="text-xs text-text-tertiary dark:text-text-dark-tertiary">•</Text>
                    <Text className="text-xs text-text-primary dark:text-text-dark-primary">
                      {run.expense_created_count} expenses created
                    </Text>
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
