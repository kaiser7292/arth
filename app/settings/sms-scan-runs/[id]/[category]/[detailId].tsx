import { useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { useRouter, Stack, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { getScanDetails, type ScanDetail } from "@/services/sms-scan-logging";

export default function SmsDetailScreen() {
  const router = useRouter();
  const { colors, accent, colorScheme } = useColorScheme();
  const sc = StatusColors[colorScheme];
  const { id, category, detailId } = useLocalSearchParams<{ id: string; category: string; detailId: string }>();

  const [detail, setDetail] = useState<ScanDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadDetail();
    }, [id, detailId]),
  );

  async function loadDetail() {
    setLoading(true);
    try {
      const scanDetails = await getScanDetails(id!);
      const found = scanDetails.find((d) => d.id === detailId);
      setDetail(found || null);
    } catch (error) {
      console.error("Failed to load SMS detail:", error);
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

  function getCategoryLabel(): string {
    const labels: Record<string, string> = {
      hardcoded: "Hardcoded Matches",
      template: "Template Matches",
      filtered: "Filtered Out",
      unrecognized: "Unrecognized",
      skipped: "Skipped",
    };
    return labels[category!] || category!;
  }

  function getCategoryIcon(): keyof typeof Ionicons.glyphMap {
    const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
      hardcoded: "code-slash",
      template: "grid",
      filtered: "close-circle",
      unrecognized: "help-circle",
      skipped: "eye-off",
    };
    return icons[category!] || "document-text";
  }

  function getCategoryColor(): string {
    const colorsMap: Record<string, string> = {
      hardcoded: sc.success,
      template: sc.warning,
      filtered: sc.danger,
      unrecognized: sc.muted,
      skipped: colors.textSecondary,
    };
    return colorsMap[category!] || colors.textSecondary;
  }

  function parseParseResult(): any {
    if (!detail?.parse_result) return null;
    try {
      return JSON.parse(detail.parse_result);
    } catch {
      return null;
    }
  }

  if (loading) {
    return (
      <ScreenContainer>
        <Stack.Screen
          options={{
            title: "SMS Detail",
            headerLeft: () => (
              <Pressable onPress={() => router.back()} className="mr-4">
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </Pressable>
            ),
          }}
        />
        <View className="flex-1 justify-center items-center py-12">
          <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">Loading SMS details...</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (!detail) {
    return (
      <ScreenContainer>
        <Stack.Screen
          options={{
            title: "SMS Detail",
            headerLeft: () => (
              <Pressable onPress={() => router.back()} className="mr-4">
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </Pressable>
            ),
          }}
        />
        <View className="flex-1 justify-center items-center py-12">
          <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">SMS not found</Text>
        </View>
      </ScreenContainer>
    );
  }

  const parsedData = parseParseResult();

  return (
    <ScreenContainer>
      <Stack.Screen
        options={{
          title: "SMS Detail",
          headerLeft: () => (
            <Pressable onPress={() => router.back()} className="mr-4">
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView className="flex-1">
        <View className="p-4 space-y-4">
          {/* SMS Header */}
          <Card className="p-4">
            <View className="flex-row items-center mb-2">
              <Ionicons name={getCategoryIcon()} size={20} color={getCategoryColor()} />
              <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary ml-2">
                {getCategoryLabel()}
              </Text>
            </View>
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-1">
              {detail.sms_address || "Unknown Sender"} • {formatTimestamp(detail.sms_date)}
            </Text>
          </Card>

          {/* SMS Body */}
          <Card className="p-4">
            <Text className="text-xs font-semibold text-text-tertiary dark:text-text-dark-secondary uppercase tracking-wider mb-2">
              SMS Body
            </Text>
            <Pressable onPress={() => setExpanded(!expanded)}>
              <Text className={`text-sm text-text-primary dark:text-text-dark-primary ${expanded ? "" : "line-clamp-3"}`}>
                {detail.sms_body}
              </Text>
              <Text className="text-xs text-blue mt-1">
                {expanded ? "Show less" : "Show more"}
              </Text>
            </Pressable>
          </Card>

          {/* Parse Result */}
          {parsedData && (
            <Card className="p-4">
              <Text className="text-xs font-semibold text-text-tertiary dark:text-text-dark-secondary uppercase tracking-wider mb-2">
                Parsed Data
              </Text>
              {parsedData.amount && (
                <View className="flex-row items-center mb-1">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary w-24">Amount:</Text>
                  <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
                    ₹{parsedData.amount}
                  </Text>
                </View>
              )}
              {parsedData.merchant && (
                <View className="flex-row items-center mb-1">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary w-24">Merchant:</Text>
                  <Text className="text-sm text-text-primary dark:text-text-dark-primary">{parsedData.merchant}</Text>
                </View>
              )}
              {parsedData.cardLast4 && (
                <View className="flex-row items-center mb-1">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary w-24">Card:</Text>
                  <Text className="text-sm text-text-primary dark:text-text-dark-primary">••••{parsedData.cardLast4}</Text>
                </View>
              )}
              {parsedData.bank && (
                <View className="flex-row items-center mb-1">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary w-24">Bank:</Text>
                  <Text className="text-sm text-text-primary dark:text-text-dark-primary">{parsedData.bank}</Text>
                </View>
              )}
              {parsedData.type && (
                <View className="flex-row items-center mb-1">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary w-24">Type:</Text>
                  <Text className="text-sm text-text-primary dark:text-text-dark-primary">{parsedData.type}</Text>
                </View>
              )}
              {parsedData.date && (
                <View className="flex-row items-center mb-1">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary w-24">Date:</Text>
                  <Text className="text-sm text-text-primary dark:text-text-dark-primary">{parsedData.date}</Text>
                </View>
              )}
            </Card>
          )}

          {/* Filter Reason */}
          {detail.filter_reason && (
            <Card className="p-4">
              <View className="flex-row items-center mb-2">
                <Ionicons name="alert-circle" size={16} color={sc.danger} />
                <Text className="text-xs font-semibold text-text-tertiary dark:text-text-dark-secondary uppercase tracking-wider ml-2">
                  Filter Reason
                </Text>
              </View>
              <Text className="text-sm text-danger">{detail.filter_reason}</Text>
            </Card>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
