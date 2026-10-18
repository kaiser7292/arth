import { useCallback, useMemo, useState } from "react";
import { View, Pressable, FlatList, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { EmptyState, FAB, LoadingState, ScreenContainer, SelectSheet, Text } from "@/components/ui";
import { Card } from "@/components/ui/Card";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import {
  listUserTemplates,
  getTemplateMatchCounts,
  countUnrecognisedSms,
  deleteUserTemplate,
  diagnoseUserTemplate,
  type UserSmsTemplate,
} from "@/services/sms/user-sms-templates";
import { clearUnrecognisedSms } from "@/services/sms/sms-parser";
import { BACKLOG_DAY_OPTIONS, getBacklogDays, setBacklogDays } from "@/services/sms/template-backlog";

import { useTheme } from "@/hooks/use-theme";
import { bankKey } from "@/services/account-duplicates";

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
  const { colors } = useColorScheme();
  const theme = useTheme();
  const accentColor = theme.primary;

  const [templates, setTemplates] = useState<UserSmsTemplate[]>([]);
  /** Banks whose card is open - all closed to start with. */
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});
  const [unrecognisedCount, setUnrecognisedCount] = useState(0);
  const [backlogDays, setBacklogDaysState] = useState(getBacklogDays());
  const [daysPickerOpen, setDaysPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [diagnosingId, setDiagnosingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [rows, count, counts] = await Promise.all([
        listUserTemplates(),
        countUnrecognisedSms(),
        getTemplateMatchCounts(),
      ]);
      setTemplates(rows);
      setUnrecognisedCount(count);
      setMatchCounts(counts);
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
          lines.push(`No SMS from this bank in the last ${getBacklogDays()} days - Arth will match it once one arrives.`);
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

  // One card per bank or wallet, names compared loosely so "AXISBK", "Axis Bank" and
  // "AXISBK CC PAYMENT" land together. The card's title is the tidiest name used for it.
  const groups = useMemo(() => {
    const out: { key: string; title: string; list: UserSmsTemplate[] }[] = [];
    for (const t of templates) {
      const name = t.bank_name?.trim() || "Other";
      const k = bankKey(name) || name.toLowerCase();
      const g = out.find((x) => x.key === k || k.startsWith(x.key) || x.key.startsWith(k));
      if (g) {
        g.list.push(t);
        // Prefer a name with spaces and lower-case letters ("Axis Bank" over "AXISBK").
        const tidy = (n: string) => (/\s/.test(n) ? 2 : 0) + (/[a-z]/.test(n) ? 1 : 0) - n.length / 100;
        if (tidy(name) > tidy(g.title)) g.title = name;
        if (k.length < g.key.length) g.key = k;
      } else {
        out.push({ key: k, title: name, list: [t] });
      }
    }
    return out.sort((x, y) => x.title.localeCompare(y.title, "en", { sensitivity: "base" }));
  }, [templates]);

  return (
    <ScreenContainer padTop={false}>
      <View className="flex-1">
        <View className="px-4 pt-3 pb-2">
          <Text className="text-xs text-faint-foreground">
            Teach Arth to read a transaction message it doesn't know yet. Your templates are grouped by bank or wallet and stay on this phone.
          </Text>
        </View>

        {loading ? (
          <LoadingState />
        ) : (
          <FlatList
            initialNumToRender={12}
            data={groups}
            keyExtractor={(g) => g.key}
            ListHeaderComponent={
              // v15.11.1: wrap in <Card> to match the template cards below —
              // pre-fix used a bespoke surface-alt box that broke the design
              // system (different radius, no elevation, custom padding).
              <Card className="mb-3">
                <Pressable
                  onPress={() =>
                    router.push("/settings/sms-templates/unrecognised")
                  }
                  className="flex-row items-center"
                >
                  <Ionicons
                    name={unrecognisedCount > 0 ? "help-circle-outline" : "checkmark-done-circle-outline"}
                    size={20}
                    color={accentColor}
                  />
                  <View className="flex-1 ml-3">
                    <Text className="text-sm font-semibold text-foreground">
                      {unrecognisedCount > 0
                        ? `Browse unrecognised SMS (${unrecognisedCount})`
                        : "No unrecognised SMS"}
                    </Text>
                    <Text className="text-xs text-faint-foreground mt-0.5">
                      {unrecognisedCount > 0
                        ? `Last ${backlogDays} days of transaction messages Arth couldn't read. Tap any to teach Arth.`
                        : `Arth has read every transaction message from the last ${backlogDays} days.`}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textSecondary}
                  />
                </Pressable>
                {/* How far back a new template reads unread messages (live count + "Read them now"). */}
                <Pressable
                  onPress={() => setDaysPickerOpen(true)}
                  className="flex-row items-center mt-2 pt-2 border-t border-border"
                  accessibilityRole="button"
                >
                  <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
                  <View className="flex-1 ml-3">
                    <Text className="text-sm text-foreground">Read past messages from</Text>
                    <Text className="text-xs text-faint-foreground mt-0.5">
                      When you teach a template, Arth checks unread messages this far back.
                    </Text>
                  </View>
                  <Text className="text-sm font-semibold" style={{ color: accentColor }}>
                    Last {backlogDays} days
                  </Text>
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
                    className="mt-2 pt-2 border-t border-border"
                  >
                    <Text className="text-xs font-medium text-center" style={{ color: theme.danger }}>
                      Clear all unrecognised messages
                    </Text>
                  </Pressable>
                )}
              </Card>
            }
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96 }}
            renderItem={({ item: g }) => {
              const isOpen = open.has(g.key);
              const matched = g.list.reduce((n, t) => n + (matchCounts[t.id] ?? 0), 0);
              return (
                <Card className="mb-3">
                  {/* A bank or wallet: closed until tapped. */}
                  <Pressable
                    onPress={() =>
                      setOpen((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.key)) next.delete(g.key);
                        else next.add(g.key);
                        return next;
                      })
                    }
                    className="flex-row items-center"
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isOpen }}
                    accessibilityLabel={`${g.title}, ${g.list.length} templates`}
                  >
                    <View className="w-9 h-9 rounded-xl items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                      <Ionicons name="business-outline" size={17} color={accentColor} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-foreground">{g.title}</Text>
                      <Text className="text-xs text-muted-foreground mt-0.5">
                        {g.list.length} template{g.list.length === 1 ? "" : "s"} · {matched} message{matched === 1 ? "" : "s"} read
                      </Text>
                    </View>
                    <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                  </Pressable>

                  {isOpen &&
                    g.list.map((item) => {
                      const matchCount = matchCounts[item.id] ?? 0;
                      return (
                        <View key={item.id} className="mt-3 pt-3 border-t border-border">
                          <Pressable onPress={() => router.push(`/settings/sms-templates/${item.id}`)} accessibilityRole="button">
                            <View className="flex-row items-center mb-1">
                              <Text className="text-sm font-medium text-foreground flex-1" numberOfLines={1}>
                                {item.template_id ?? `${item.bank_name} template`}
                              </Text>
                              <View className="px-2 py-0.5 rounded-md" style={{ backgroundColor: theme.alpha("foreground", 0.06) }}>
                                <Text className="text-label text-muted-foreground">
                                  {item.tx_type === "credit" ? "Money in" : item.tx_type === "debit" ? "Money out" : item.tx_type === "refund" ? "Refund" : "Auto"}
                                </Text>
                              </View>
                            </View>
                            {item.sample_sms && (
                              <Text className="text-xs text-muted-foreground" numberOfLines={2}>
                                {item.sample_sms}
                              </Text>
                            )}
                          </Pressable>
                          <View className="flex-row mt-2" style={{ gap: 16 }}>
                            <Pressable onPress={() => router.push(`/settings/sms-templates/${item.id}`)} hitSlop={6}>
                              <Text className="text-xs font-medium" style={{ color: accentColor }}>Edit</Text>
                            </Pressable>
                            <Pressable onPress={() => router.push(`/settings/sms-templates/matches/${item.id}`)} hitSlop={6} disabled={matchCount === 0}>
                              <Text className="text-xs font-medium" style={{ color: matchCount > 0 ? accentColor : colors.textSecondary }}>
                                Read {matchCount}
                              </Text>
                            </Pressable>
                            <Pressable onPress={() => handleDiagnose(item)} hitSlop={6} disabled={diagnosingId === item.id}>
                              <Text className="text-xs font-medium text-muted-foreground">{diagnosingId === item.id ? "Checking…" : "Diagnose"}</Text>
                            </Pressable>
                            <Pressable onPress={() => confirmDelete(item)} hitSlop={6} style={{ marginLeft: "auto" }}>
                              <Text className="text-xs font-medium" style={{ color: theme.danger }}>Delete</Text>
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}
                </Card>
              );
            }}
            ListEmptyComponent={
              <EmptyState
                icon="construct-outline"
                title={"No templates yet"}
                subtitle={"If your bank's SMS isn't being detected, tap the button below to teach Arth how to read it."}
              />
            }
          />
        )}

        <FAB
          icon="add"
          onPress={() => router.push("/settings/sms-templates/new")}
          accessibilityLabel="Teach Arth a new SMS"
        />
      </View>
      <SelectSheet
        visible={daysPickerOpen}
        title="Read past messages from"
        options={BACKLOG_DAY_OPTIONS.map((d) => ({
          value: String(d),
          label: d === 365 ? "Last year" : `Last ${d} days`,
          description: d === 90 ? "Recommended" : undefined,
        }))}
        value={String(backlogDays)}
        onChange={(v) => {
          setBacklogDays(Number(v));
          setBacklogDaysState(Number(v));
        }}
        onClose={() => setDaysPickerOpen(false)}
      />
    </ScreenContainer>
  );
}
