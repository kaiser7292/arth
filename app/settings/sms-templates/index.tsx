import { useCallback, useState } from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, FAB } from "@/components/ui";
import { Card } from "@/components/ui/Card";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import {
  listUserTemplates,
  countUnrecognisedSms,
  deleteUserTemplate,
  diagnoseUserTemplate,
  type UserSmsTemplate,
} from "@/services/sms/user-sms-templates";
import { clearUnrecognisedSms } from "@/services/sms/sms-parser";
import { StatusColors } from "@/constants/theme";

/**
 * v15.7.0 — Smart SMS Templates list.
 *
 * Changes since v15.6.x:
 *   - "Browse unrecognised SMS" header is ALWAYS visible, not only when count>0.
 *     Shows the count inline so the user can see at a glance whether Arth has
 *     SMS waiting to be taught.
 *   - Each template card has a "Diagnose" action that runs the regex against
 *     the last 30 days of SMS and reports how many it would match + sample
 *     matches and misses. Makes broken templates visible.
 */
export default function SmartSmsTemplatesListScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors, colorScheme, accent } = useColorScheme();
  const accentColor = colorScheme === "dark" ? accent[400] : accent[500];

  const [templates, setTemplates] = useState<UserSmsTemplate[]>([]);
  const [unrecognisedCount, setUnrecognisedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [diagnosingId, setDiagnosingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [rows, count] = await Promise.all([
        listUserTemplates(),
        countUnrecognisedSms(),
      ]);
      setTemplates(rows);
      setUnrecognisedCount(count);
    } catch (e) {
      alert(
        "Couldn't load templates",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setLoading(false);
    }
  }, [alert]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

  const confirmDelete = useCallback(
    (tpl: UserSmsTemplate) => {
      alert(
        "Delete template?",
        `"${tpl.template_id ?? tpl.bank_name}" will stop matching new SMS. Existing expenses are not affected.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                await deleteUserTemplate(tpl.id);
                await load();
              } catch (e) {
                alert(
                  "Delete failed",
                  e instanceof Error ? e.message : String(e),
                );
              }
            },
          },
        ],
      );
    },
    [alert, load],
  );

  const handleDiagnose = useCallback(
    async (tpl: UserSmsTemplate) => {
      setDiagnosingId(tpl.id);
      try {
        const result = await diagnoseUserTemplate(tpl.id);
        if (!result) {
          alert("Couldn't diagnose", "Template not found.");
          return;
        }
        const { matched, scanned, sampleMatches, sampleMisses } = result;
        const lines: string[] = [];
        lines.push(`Scanned ${scanned} recent SMS for ${tpl.bank_name}.`);
        lines.push(`✅ Matched: ${matched}`);
        if (matched === 0 && scanned > 0) {
          lines.push("");
          lines.push("Your template didn't match any recent SMS. Here are a few SMS that looked related:");
          sampleMisses.forEach((s, i) => lines.push(`  ${i + 1}. ${s}…`));
          lines.push("");
          lines.push("Tip: open the template, run 'Guess it for me' or long-press to tag just the digits.");
        } else if (matched > 0) {
          lines.push("");
          lines.push("Sample matches:");
          sampleMatches.forEach((s, i) => lines.push(`  ${i + 1}. ${s}…`));
        }
        if (scanned === 0) {
          lines.push("");
          lines.push("No SMS from this bank in the last 30 days - Arth will match it once one arrives.");
        }
        alert(`Diagnose: ${tpl.template_id ?? tpl.bank_name}`, lines.join("\n"));
      } catch (e) {
        alert("Diagnose failed", e instanceof Error ? e.message : String(e));
      } finally {
        setDiagnosingId(null);
      }
    },
    [alert],
  );

  return (
    <ScreenContainer padTop={false}>
      <View className="flex-1">
        <View className="px-4 pt-3 pb-2">
          <Text className="text-xs text-text-tertiary">
            Teach Arth to read SMS from any bank by pasting a sample and tapping the amount, merchant, and card number. Your templates are device-local.
          </Text>
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={accentColor} />
          </View>
        ) : (
          <FlatList
            data={templates}
            keyExtractor={(t) => t.id}
            ListHeaderComponent={
              // v15.11.1: wrap in <Card> to match the template cards below —
              // pre-fix used a bespoke surface-alt box that broke the design
              // system (different radius, no elevation, custom padding).
              <Card className="mb-3">
                <Pressable
                  onPress={() =>
                    router.push("/settings/sms-templates/unrecognised" as never)
                  }
                  className="flex-row items-center"
                >
                  <Ionicons
                    name={unrecognisedCount > 0 ? "help-circle-outline" : "checkmark-done-circle-outline"}
                    size={20}
                    color={accentColor}
                  />
                  <View className="flex-1 ml-3">
                    <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                      {unrecognisedCount > 0
                        ? `Browse unrecognised SMS (${unrecognisedCount})`
                        : "No unrecognised SMS"}
                    </Text>
                    <Text className="text-xs text-text-tertiary mt-0.5">
                      {unrecognisedCount > 0
                        ? "Last 30 days of bank SMS that didn't parse. Tap any to teach Arth."
                        : "Arth has read every bank SMS from the last 30 days."}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textSecondary}
                  />
                </Pressable>
                {unrecognisedCount > 0 && (
                  <Pressable
                    onPress={() => {
                      alert("Clear all unrecognised SMS", `Remove all ${unrecognisedCount} unrecognised messages? This won't affect any expenses already created.`, [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Clear all",
                          style: "destructive",
                          onPress: async () => {
                            const { DEFAULT_USER_ID } = require("@/constants/app");
                            await clearUnrecognisedSms(DEFAULT_USER_ID);
                            setUnrecognisedCount(0);
                          },
                        },
                      ]);
                    }}
                    className="mt-2 pt-2 border-t border-border-light dark:border-border-dark"
                  >
                    <Text className="text-xs font-medium text-center" style={{ color: StatusColors[colorScheme].danger }}>
                      Clear all unrecognised messages
                    </Text>
                  </Pressable>
                )}
              </Card>
            }
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96 }}
            renderItem={({ item }) => (
              <Card className="mb-3">
                <Pressable
                  onPress={() =>
                    router.push(`/settings/sms-templates/${item.id}` as never)
                  }
                >
                  <View className="flex-row items-center mb-1">
                    <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary flex-1">
                      {item.template_id ?? `${item.bank_name} template`}
                    </Text>
                    <View className="px-2 py-0.5 bg-surface-light-alt dark:bg-surface-dark-alt rounded">
                      <Text className="text-xs text-text-tertiary capitalize">
                        {item.tx_type}
                      </Text>
                    </View>
                  </View>
                  <Text className="text-xs text-text-tertiary mb-2">
                    {item.bank_name}
                  </Text>
                  {item.sample_sms && (
                    <Text
                      className="text-xs text-text-secondary dark:text-text-dark-secondary"
                      numberOfLines={2}
                    >
                      {item.sample_sms}
                    </Text>
                  )}
                </Pressable>
                <View className="flex-row items-center justify-end mt-3 pt-3 border-t border-border-light dark:border-border-dark" style={{ gap: 16 }}>
                  <Pressable
                    onPress={() => handleDiagnose(item)}
                    hitSlop={8}
                    disabled={diagnosingId === item.id}
                  >
                    <Text
                      className="text-sm"
                      style={{ color: diagnosingId === item.id ? colors.textSecondary : accentColor }}
                    >
                      {diagnosingId === item.id ? "Scanning…" : "Diagnose"}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => confirmDelete(item)} hitSlop={8}>
                    <Text
                      className="text-sm"
                      style={{ color: StatusColors[colorScheme].danger }}
                    >
                      Delete
                    </Text>
                  </Pressable>
                </View>
              </Card>
            )}
            ListEmptyComponent={
              <View className="items-center justify-center mt-16 px-8">
                <Ionicons
                  name="construct-outline"
                  size={48}
                  color={colors.textSecondary}
                />
                <Text className="text-lg font-medium text-text-primary dark:text-text-dark-primary mt-4">
                  No templates yet
                </Text>
                <Text className="text-sm text-text-tertiary text-center mt-2">
                  If your bank's SMS isn't being detected, tap the button below to teach Arth how to read it.
                </Text>
              </View>
            }
          />
        )}

        <FAB
          icon="add"
          onPress={() => router.push("/settings/sms-templates/new" as never)}
          accessibilityLabel="Teach Arth a new SMS"
        />
      </View>
    </ScreenContainer>
  );
}
