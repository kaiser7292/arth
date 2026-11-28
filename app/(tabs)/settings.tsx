import { isPartOn } from "@/services/customise";
import { useCustomisation } from "@/hooks/use-customisation";
import { ContextualHeader, ScreenContainer, Segmented, Text, useToast } from "@/components/ui";
import { GroupLabel, LinkRow } from "@/components/ui/LinkRow";
import { aiReadingBuilt } from "@/services/ai/ai-reading";
import { getNanoStatus } from "@/services/ai/nano";

import { DEFAULT_USER_ID } from "@/constants/app";

import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { formatLastBackupTime, getLastScheduledBackupAt } from "@/services/backup-schedule";
import { scanAllDuplicatesCached } from "@/services/duplicate-detection";
import { getFlag } from "@/services/feature-flags";
import { getLastBackupAt, getThemePreference, ignoreNeeds, isNeedIgnored, setThemePreference } from "@/services/settings";
import { isSmsDetectionEnabled } from "@/services/sms";
import { countUnrecognisedSms } from "@/services/sms/user-sms-templates";

import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, View } from "react-native";
import { PRIVACY_POLICY_URL, TERMS_URL } from "@/components/sms/SmsDisclosure";
import { isDemoBuild, seedDemoData } from "@/services/demo-data";
import { useTheme } from "@/hooks/use-theme";
import { AppUpdateRow } from "@/components/settings/AppUpdateRow";

const THEME_OPTIONS: { value: "system" | "light" | "dark"; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "system", label: "System", icon: "phone-portrait-outline" },
  { value: "light", label: "Light", icon: "sunny-outline" },
  { value: "dark", label: "Dark", icon: "moon-outline" },
];
interface SettingsItem {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  /** Extra words the search should find this row by. */
  keywords?: string;
  onPress: () => void;
}
interface SettingsGroup {
  title: string;
  /** The group's icon colour (board: teal, blue, purple, pink, grey). */
  color?: string;
  items: SettingsItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export default function SettingsScreen() {
  useCustomisation();
  const alert = useAlert();
  const router = useRouter();
  const { colorScheme, setColorScheme } = useColorScheme();
  const uiTheme = useTheme();
  const [theme, setTheme] = useState(getThemePreference);
  // Status lines for the combined screens.
  const [messagesLine, setMessagesLine] = useState("Scan, templates, your name, duplicates");
  const [backupLine, setBackupLine] = useState("Backups, recycle bin, import, clean up");
  /** What "Needs a look" shows: only when something does. */
  const [needs, setNeeds] = useState<{ backupDays: number | null; unread: number; dupes: number }>({ backupDays: null, unread: 0, dupes: 0 });
  const toast = useToast();
  // Bumped by Ignore so the list is read again.
  const [, setIgnoreTick] = useState(0);
  // The AI row is on every phone; its line says whether Gemini Nano is here too.
  const [onDeviceAi, setOnDeviceAi] = useState(false);
  useEffect(() => {
    if (!aiReadingBuilt()) return;
    let live = true;
    getNanoStatus()
      .then((s) => live && setOnDeviceAi(s !== "unavailable"))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useFocusEffect(
    useCallback(() => {
      const manual = getLastBackupAt();
      const auto = getLastScheduledBackupAt();
      const last = !manual ? auto : !auto ? manual : manual > auto ? manual : auto;
      setBackupLine(
        last
          ? `Last backup ${formatLastBackupTime(last).toLowerCase()} · recycle bin, import, clean up`
          : "Not backed up yet · recycle bin, import, clean up",
      );
      const lastMs = last ? new Date(last).getTime() : NaN;
      const backupDays = Number.isFinite(lastMs) ? Math.floor((Date.now() - lastMs) / DAY_MS) : -1;

      const android = Platform.OS === "android";
      const smsOn = android && isSmsDetectionEnabled();
      Promise.all([
        countUnrecognisedSms().catch(() => 0),
        scanAllDuplicatesCached(DEFAULT_USER_ID).then((r) => r.duplicateGroupCount).catch(() => 0),
      ]).then(([unread, dupes]) => {
        const parts: string[] = [];
        if (unread > 0) parts.push(`${unread} unread`);
        if (dupes > 0) parts.push(`${dupes} possible duplicate${dupes === 1 ? "" : "s"}`);
        const base = !android ? "Bank messages via Shortcuts" : smsOn ? "Reading on" : "Reading off";
        setMessagesLine(parts.length > 0 ? `${base} · ${parts.join(" · ")}` : `${base} · scan, templates, your name, duplicates`);
        setNeeds({ backupDays, unread, dupes });
      });
    }, []),
  );

  const handleThemeChange = useCallback(
    (value: "system" | "light" | "dark") => {
      setThemePreference(value);
      setColorScheme(value);
      setTheme(value);
    },
    [setColorScheme],
  );

  const activeThemeLabel =
    theme === "system" ? `System (${colorScheme === "dark" ? "Dark" : "Light"})` : theme === "dark" ? "Dark" : "Light";

  const go = (path: string) => () => router.push(path as never);
  const groups: SettingsGroup[] = [
    {
      title: "Your data",
      color: uiTheme.primary,
      items: [
        { key: "categories", icon: "grid-outline", label: "Categories", subtitle: "Main categories, sub-categories, reorder", onPress: go("/settings/categories") },
        { key: "modes", icon: "card-outline", label: "Payment modes", subtitle: "Credit cards, UPI, wallets", onPress: go("/settings/payment-modes") },
        { key: "accounts", icon: "business-outline", label: "Accounts", subtitle: "Add and manage account details", keywords: "bank card wallet loan demat", onPress: go("/settings/account-master") },
        { key: "tags", icon: "pricetags-outline", label: "Tags", subtitle: "Label and organise transactions", onPress: go("/settings/tags") },
        { key: "budget", icon: "calculator-outline", label: "Budget configuration", subtitle: "Monthly budgets per category", onPress: go("/settings/budget-config") },
      ],
    },
    {
      title: "Transactions",
      color: uiTheme.data.series[3],
      items: [
        { key: "messages", icon: "chatbubbles-outline", label: "Transaction messages", subtitle: messagesLine, keywords: "sms scan templates duplicates", onPress: go("/settings/transaction-messages") },
        { key: "merchants", icon: "storefront-outline", label: "Merchants", subtitle: "Names, merged names and the category each one goes to", onPress: go("/settings/merchants") },
      ],
    },
    {
      title: "Automation",
      color: uiTheme.data.transfer,
      items: [
        { key: "fix", icon: "medkit-outline", label: "Data health", subtitle: "What looks wrong, and the way to fix each one", keywords: "fix my data duplicates transfers balance", onPress: go("/settings/fix-my-data") },
        {
          key: "ai",
          icon: "sparkles-outline",
          label: "AI",
          subtitle: onDeviceAi ? "On this phone, and with your AI assistant" : "With your AI assistant: ChatGPT, Gemini or Claude",
          keywords: "on-device ai gemini nano ai-assisted setup chatgpt claude suggestions unrecognised",
          onPress: go("/settings/ai"),
        },
        { key: "rules", icon: "flash-outline", label: "Smart rules", subtitle: "Auto-categorise by merchant, amount, account", onPress: go("/settings/smart-rules") },
        { key: "reminders", icon: "repeat-outline", label: "Reminders", subtitle: "Rent, subscriptions, anything that repeats", keywords: "recurring", onPress: go("/settings/recurring-rules") },
        { key: "voice", icon: "mic-outline", label: "Voice input", subtitle: "Voice sound, speak-back questions on or off", onPress: go("/settings/voice-input") },
        { key: "audit", icon: "list-outline", label: "Audit log", subtitle: "Every action taken on detected and manual records", onPress: go("/settings/audit-log") },
      ],
    },
    ...(getFlag("household") && isPartOn("together")
      ? [{ title: "Together", color: uiTheme.data.series[4], items: [{ key: "household", icon: "people-outline" as const, label: "Household", subtitle: "Share household spending with your partner or family", onPress: go("/settings/household") }] }]
      : []),
    ...(isPartOn("investments")
      ? [
          {
            title: "Integrations",
            color: uiTheme.data.series[4],
            items: [
              { key: "kite", icon: "trending-up-outline" as const, label: "Zerodha Kite", subtitle: "Connect your Zerodha account to sync portfolio", keywords: "broker", onPress: go("/settings/kite-connect") },
              { key: "angel", icon: "bar-chart-outline" as const, label: "Angel One", subtitle: "Connect your Angel One account to sync portfolio", keywords: "broker", onPress: go("/settings/angel-connect") },
              { key: "zebpay", icon: "logo-bitcoin" as const, label: "Zebpay", subtitle: "Connect your Zebpay account to view crypto portfolio", keywords: "crypto", onPress: go("/settings/zebpay-connect") },
            ],
          },
        ]
      : []),
    {
      title: "Backup and data",
      color: uiTheme.mutedForeground,
      items: [
        { key: "backup", icon: "cloud-upload-outline", label: "Backup and data", subtitle: backupLine, keywords: "restore recycle bin import excel clean up", onPress: go("/settings/backup-data") },
      ],
    },
    {
      title: "Preferences and security",
      color: uiTheme.mutedForeground,
      items: [
        { key: "region", icon: "globe-outline", label: "Region", subtitle: "Currency, date format, number format, financial year", keywords: "timezone", onPress: go("/settings/region") },
        { key: "notif", icon: "notifications-outline", label: "Notifications", subtitle: "Message scan alerts, due reminders", onPress: go("/settings/notifications") },
        { key: "calendar", icon: "calendar-outline", label: "Calendar sync", subtitle: "Bills, EMIs and reminders in your calendar", onPress: go("/settings/calendar-sync") },
        { key: "customise", icon: "options-outline", label: "Customise Arth", subtitle: "Switch off what you don't use, and order your Home cards", keywords: "tabs features", onPress: go("/settings/customise") },
        { key: "security", icon: "lock-closed-outline", label: "Security", subtitle: "App lock with biometric authentication", keywords: "fingerprint passcode", onPress: go("/settings/security") },
      ],
    },
    ...(isDemoBuild()
      ? [
          {
            title: "Demo build",
            items: [
              {
                key: "demo",
                icon: "flask-outline" as const,
                label: "Load sample data",
                subtitle: "Fictional accounts and transactions for screenshots",
                onPress: () =>
                  alert("Load sample data?", "Adds three months of fictional accounts, transactions, budgets, a loan, goals and a family ledger.", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Load",
                      onPress: async () => {
                        try {
                          await seedDemoData();
                          alert("Sample data loaded", "Head to the Arth tab to see it.");
                        } catch (e) {
                          alert("Couldn't load sample data", e instanceof Error ? e.message : String(e));
                        }
                      },
                    },
                  ]),
              },
            ],
          },
        ]
      : []),
    {
      title: "About and help",
      color: uiTheme.mutedForeground,
      items: [
        ...(getFlag("v15_help_center")
          ? [{ key: "help", icon: "help-circle-outline" as const, label: "Help center", subtitle: "Ask anything in plain English", onPress: go("/settings/help") }]
          : []),
        { key: "privacy", icon: "shield-checkmark-outline", label: "Privacy policy", subtitle: "What Arth reads, stores and never sends", onPress: () => Linking.openURL(PRIVACY_POLICY_URL).catch(() => {}) },
        { key: "terms", icon: "reader-outline", label: "Terms of use", onPress: () => Linking.openURL(TERMS_URL).catch(() => {}) },
        { key: "licences", icon: "document-text-outline", label: "Open-source licences", subtitle: "Libraries and models Arth is built with", onPress: go("/settings/licenses") },
      ],
    },
  ];

  // "Needs a look": only what does, and not what was set aside with Ignore.
  const needItems: SettingsItem[] = [];
  const needValues: Record<string, number> = {};
  if ((needs.backupDays === -1 || (needs.backupDays != null && needs.backupDays > 7)) && !isNeedIgnored("n-backup", 0, true))
    needItems.push({
      key: "n-backup",
      icon: "cloud-upload-outline",
      label: needs.backupDays === -1 ? "Not backed up yet" : `Last backup ${needs.backupDays} days ago`,
      subtitle: "Back up now",
      onPress: go("/settings/backup-data"),
    });
  if (needs.dupes > 0 && !isNeedIgnored("n-dupes", needs.dupes))
    needItems.push({ key: "n-dupes", icon: "copy-outline", label: `${needs.dupes} possible duplicate${needs.dupes === 1 ? "" : "s"}`, subtitle: "Check them in Data health", onPress: go("/settings/fix-my-data") });
  if (needs.unread > 0 && !isNeedIgnored("n-unread", needs.unread))
    needItems.push({ key: "n-unread", icon: "chatbubbles-outline", label: `${needs.unread} unread bank message${needs.unread === 1 ? "" : "s"}`, subtitle: "Teach Arth to read them", onPress: go("/settings/transaction-messages") });

  needValues["n-backup"] = 0;
  needValues["n-dupes"] = needs.dupes;
  needValues["n-unread"] = needs.unread;
  const ignoreAllNeeds = () => {
    ignoreNeeds(Object.fromEntries(needItems.map((i) => [i.key, needValues[i.key] ?? 0])));
    setIgnoreTick((t) => t + 1);
    toast("Hidden until there's something new");
  };

  const card = (items: (SettingsItem & { group?: string; color?: string })[], color?: string) => (
    <View className="rounded-card bg-card border border-border overflow-hidden">
      {items.map((i, idx) => (
        <LinkRow key={i.key} divider={idx > 0} icon={i.icon} color={i.color ?? color} title={i.label} sub={i.group ? `${i.group} · ${i.subtitle ?? ""}` : i.subtitle} onPress={i.onPress} />
      ))}
    </View>
  );

  const themePicker = (
    <View className="rounded-card bg-card border border-border p-4">
      <Text className="text-body font-semibold text-foreground">Theme</Text>
      <Text className="text-meta text-muted-foreground mb-3">Now: {activeThemeLabel}</Text>
      <Segmented<"system" | "light" | "dark">
        options={THEME_OPTIONS.map((o) => ({ value: o.value, label: o.label, icon: o.icon }))}
        value={theme}
        onChange={handleThemeChange}
      />
    </View>
  );

  return (
    <ScreenContainer>
      {/* Settings are found with the header's search icon (owner, Nov 2026): no second search box. */}
      <ContextualHeader title="Settings" />
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-4 pt-2" style={{ gap: 16 }}>
              {needItems.length > 0 && (
                <View>
                  <View className="flex-row items-center justify-between">
                    <GroupLabel>Needs a look</GroupLabel>
                    <Pressable onPress={ignoreAllNeeds} hitSlop={10} accessibilityRole="button" accessibilityLabel="Ignore these" className="mb-2">
                      <Text className="text-meta font-semibold" style={{ color: uiTheme.primary }}>Ignore</Text>
                    </Pressable>
                  </View>
                  <View className="rounded-card overflow-hidden" style={{ backgroundColor: uiTheme.alpha("warning", 0.08) }}>
                    {needItems.map((i, idx) => (
                      <LinkRow key={i.key} divider={idx > 0} icon={i.icon} color={uiTheme.warning} title={i.label} sub={i.subtitle} onPress={i.onPress} />
                    ))}
                  </View>
                </View>
              )}
              {groups.map((g) => (
                <View key={g.title}>
                  <GroupLabel>{g.title}</GroupLabel>
                  {card(g.items, g.color)}
                  {g.title === "Preferences and security" && <View className="mt-3">{themePicker}</View>}
                  {g.title === "About and help" && (
                    <View className="rounded-card bg-card border border-border px-4 mt-3">
                      <View className="flex-row items-center justify-between py-3 border-b border-border">
                        <Text className="text-meta text-muted-foreground">App name</Text>
                        {/* अर्थ in the phone's own font: Inter has no Devanagari, and at semi-bold the
                            owner's phone drew nothing in its place (Nov 2026). */}
                        <Text className="text-body font-semibold text-foreground">
                          Arth · <Text style={{ fontFamily: "sans-serif" }}>अर्थ</Text>
                        </Text>
                      </View>
                      <AppUpdateRow />
                      <View className="flex-row items-center justify-between py-3">
                        <Text className="text-meta text-muted-foreground">Version</Text>
                        <Text className="text-body font-semibold text-foreground">
                          {(() => {
                            const v = require("expo-constants").default.expoConfig?.version ?? "-";
                            const sha = require("@/constants/build-info").COMMIT_SHA;
                            return sha ? `${v} - ${sha}` : v;
                          })()}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              ))}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
