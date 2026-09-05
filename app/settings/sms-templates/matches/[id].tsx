import { useCallback, useState } from "react";
import { View, FlatList, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams, useFocusEffect } from "expo-router";
import { LoadingState, ScreenContainer, Text } from "@/components/ui";
import { Card } from "@/components/ui/Card";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  getUserTemplate,
  getTemplateMatches,
  type UserSmsTemplate,
  type TemplateMatchRow,
} from "@/services/sms/user-sms-templates";
import { formatAmount } from "@/utils/expense-validation";
import { useTheme } from "@/hooks/use-theme";

export default function TemplateMatchesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const accentColor = theme.primary;

  const [template, setTemplate] = useState<UserSmsTemplate | null>(null);
  const [matches, setMatches] = useState<TemplateMatchRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [tpl, rows] = await Promise.all([
        getUserTemplate(id),
        getTemplateMatches(id),
      ]);
      setTemplate(tpl);
      setMatches(rows);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const title = template ? (template.template_id ?? template.bank_name) : "Matched SMS";

  function formatSmsDate(ts: number | null): string {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen options={{ title, headerShadowVisible: false }} />

      {loading ? (
        <LoadingState />
      ) : matches.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="document-text-outline" size={48} color={colors.textSecondary} />
          <Text className="text-lg font-medium text-foreground mt-4">
            No matches yet
          </Text>
          <Text className="text-sm text-faint-foreground text-center mt-2">
            SMS detected using this template will appear here after a scan.
          </Text>
        </View>
      ) : (
        <FlatList
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          data={matches}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, paddingTop: 8 }}
          ListHeaderComponent={
            <Text className="text-xs text-faint-foreground mb-3">
              {matches.length} SMS detected using this template
            </Text>
          }
          renderItem={({ item }) => (
            <Card className="mb-3">
              <View className="flex-row items-start justify-between mb-1">
                <Text className="text-xs font-semibold text-muted-foreground flex-1 mr-2">
                  {item.sms_address ?? "Unknown sender"}
                </Text>
                <Text className="text-xs text-faint-foreground">
                  {formatSmsDate(item.sms_date)}
                </Text>
              </View>
              <View className="flex-row items-center gap-3 mb-1.5">
                {item.parsed_amount != null && (
                  <View className="flex-row items-center">
                    <Ionicons name="cash-outline" size={12} color={accentColor} />
                    <Text className="text-xs font-semibold ml-1" style={{ color: accentColor }}>
                      {formatAmount(item.parsed_amount)}
                    </Text>
                  </View>
                )}
                {item.parsed_merchant != null && item.parsed_merchant !== "" && (
                  <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                    {item.parsed_merchant}
                  </Text>
                )}
              </View>
              {item.sms_body_preview != null && item.sms_body_preview !== "" && (
                <Text
                  className="text-xs text-faint-foreground"
                  numberOfLines={2}
                >
                  {item.sms_body_preview}
                </Text>
              )}
            </Card>
          )}
        />
      )}
    </ScreenContainer>
  );
}
