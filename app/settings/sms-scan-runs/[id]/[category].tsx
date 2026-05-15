import { useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { useRouter, Stack, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { getScanDetails, type ScanDetail } from "@/services/sms-scan-logging";

export default function SmsScanRunCategoryScreen() {
  const router = useRouter();
  const { colors, accent, colorScheme } = useColorScheme();
  const sc = StatusColors[colorScheme];
  const { id, category } = useLocalSearchParams<{ id: string; category: string }>();

  const [details, setDetails] = useState<ScanDetail[]>([]);
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadDetails();
    }, [id, category]),
  );

  async function loadDetails() {
    setLoading(true);
    try {
      const scanDetails = await getScanDetails(id!, category!);
      setDetails(scanDetails);
    } catch (error) {
      console.error("Failed to load scan details:", error);
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

  if (loading) {
    return (
      <ScreenContainer>
        <Stack.Screen
          options={{
            title: getCategoryLabel(),
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

  return (
    <ScreenContainer>
      <Stack.Screen
        options={{
          title: getCategoryLabel(),
          headerLeft: () => (
            <Pressable onPress={() => router.back()} className="mr-4">
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView className="flex-1">
        {details.length === 0 ? (
          <View className="flex-1 justify-center items-center py-12">
            <Ionicons name={getCategoryIcon()} size={48} color={getCategoryColor()} />
            <Text className="mt-4 text-sm text-text-secondary dark:text-text-dark-secondary">
              No SMS in this category
            </Text>
          </View>
        ) : (
          <View className="p-4 space-y-4">
            {details.map((detail) => (
              <Pressable
                key={detail.id}
                onPress={() => router.push(`/settings/sms-scan-runs/${id}/${category}/${detail.id}`)}
              >
                <Card className="p-4">
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                      {detail.sms_address || "Unknown Sender"} • {formatTimestamp(detail.sms_date)}
                    </Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </View>
                  <Text className="text-sm text-text-primary dark:text-text-dark-primary mb-2 line-clamp-2">
                    {detail.sms_body}
                  </Text>
                  {detail.filter_reason && (
                    <View className="flex-row items-center mt-2">
                      <Ionicons name="alert-circle" size={14} color={sc.danger} />
                      <Text className="text-xs text-danger ml-1">{detail.filter_reason}</Text>
                    </View>
                  )}
                </Card>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
