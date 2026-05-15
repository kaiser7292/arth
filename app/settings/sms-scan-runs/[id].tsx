import { useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { useRouter, Stack, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getScanRun, getScanDetailsBySource, type ScanRun } from "@/services/sms-scan-logging";

export default function SmsScanRunDetailScreen() {
  const router = useRouter();
  const { colors, accent, colorScheme } = useColorScheme();
  const sc = StatusColors[colorScheme];
  const { id } = useLocalSearchParams<{ id: string }>();

  const [scanRun, setScanRun] = useState<ScanRun | null>(null);
  const [detailsBySource, setDetailsBySource] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadScanRun();
    }, [id]),
  );

  async function loadScanRun() {
    setLoading(true);
    try {
      const run = await getScanRun(id!);
      if (run) {
        setScanRun(run);
        const details = await getScanDetailsBySource(id!);
        setDetailsBySource(details);
      }
    } catch (error) {
      console.error("Failed to load scan run:", error);
    } finally {
      setLoading(false);
    }
  }

  function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
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

  const categories = [
    { key: "hardcoded", label: "Hardcoded Matches", icon: "code-slash", color: sc.success },
    { key: "template", label: "Template Matches", icon: "grid", color: sc.warning },
    { key: "filtered", label: "Filtered Out", icon: "close-circle", color: sc.danger },
    { key: "unrecognized", label: "Unrecognized", icon: "help-circle", color: sc.muted },
    { key: "skipped", label: "Skipped", icon: "eye-off", color: colors.textSecondary },
  ];

  if (loading) {
    return (
      <ScreenContainer>
        <Stack.Screen
          options={{
            title: "Scan Details",
            headerLeft: () => (
              <Pressable onPress={() => router.back()} className="mr-4">
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </Pressable>
            ),
          }}
        />
        <View className="flex-1 justify-center items-center py-12">
          <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Loading scan details...</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (!scanRun) {
    return (
      <ScreenContainer>
        <Stack.Screen
          options={{
            title: "Scan Details",
            headerLeft: () => (
              <Pressable onPress={() => router.back()} className="mr-4">
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </Pressable>
            ),
          }}
        />
        <View className="flex-1 justify-center items-center py-12">
          <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Scan not found</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Stack.Screen
        options={{
          title: "Scan Details",
          headerLeft: () => (
            <Pressable onPress={() => router.back()} className="mr-4">
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView className="flex-1">
        <View className="p-4 space-y-4">
          {/* Scan Run Summary */}
          <Card className="p-4">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                {scanRun.is_manual ? "Manual Scan" : "Auto Scan"} • {formatTimestamp(scanRun.run_timestamp)}
              </Text>
              {scanRun.error_message && (
                <Ionicons name="alert-circle" size={20} color={sc.danger} />
              )}
            </View>
            {scanRun.error_message && (
              <View className="mb-2 p-2 rounded bg-danger/10">
                <Text className="text-xs text-danger">{scanRun.error_message}</Text>
              </View>
            )}
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-1">
              Date: {formatDateRange(scanRun.start_date, scanRun.end_date)}
            </Text>
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-3">
              Accounts: {formatAccountIds(scanRun.account_ids)}
            </Text>
          </Card>

          {/* Summary Counts */}
          <Card className="p-4">
            <Text className="text-xs font-semibold text-text-tertiary dark:text-text-dark-secondary uppercase tracking-wider mb-3">
              Summary
            </Text>
            <View className="grid grid-cols-2 gap-3">
              <View>
                <Text className="text-2xl font-bold text-text-primary dark:text-text-dark-primary">
                  {scanRun.sms_read_count}
                </Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">SMS Read</Text>
              </View>
              <View>
                <Text className="text-2xl font-bold text-text-primary dark:text-text-dark-primary">
                  {scanRun.sms_parsed_count}
                </Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Parsed</Text>
              </View>
              <View>
                <Text className="text-2xl font-bold text-text-primary dark:text-text-dark-primary">
                  {scanRun.sms_filtered_count}
                </Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Filtered</Text>
              </View>
              <View>
                <Text className="text-2xl font-bold text-text-primary dark:text-text-dark-primary">
                  {scanRun.expense_created_count}
                </Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Expenses Created</Text>
              </View>
            </View>
          </Card>

          {/* Categories */}
          <Card className="p-4">
            <Text className="text-xs font-semibold text-text-tertiary dark:text-text-dark-secondary uppercase tracking-wider mb-3">
              Breakdown by Category
            </Text>
            {categories.map((category) => {
              const count = detailsBySource[category.key] || 0;
              if (count === 0) return null;
              return (
                <Pressable
                  key={category.key}
                  onPress={() => router.push(`/settings/sms-scan-runs/${id}/${category.key}`)}
                  className="flex-row items-center justify-between py-3 border-b border-border-light dark:border-border-dark last:border-0"
                >
                  <View className="flex-row items-center flex-1">
                    <Ionicons name={category.icon as any} size={20} color={category.color} />
                    <Text className="text-sm text-text-primary dark:text-text-dark-primary ml-3 flex-1">
                      {category.label}
                    </Text>
                  </View>
                  <View className="flex-row items-center">
                    <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary mr-2">
                      {count}
                    </Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </View>
                </Pressable>
              );
            })}
            {Object.keys(detailsBySource).length === 0 && (
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary text-center py-4">
                No SMS details available
              </Text>
            )}
          </Card>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
