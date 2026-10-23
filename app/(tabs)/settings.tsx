import { Card, ContextualHeader, ScreenContainer, Text } from "@/components/ui";
import { PressableScale } from "@/components/motion";

import { DEFAULT_USER_ID } from "@/constants/app";

import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { formatLastBackupTime, getLastScheduledBackupAt } from "@/services/backup-schedule";
import { scanAllDuplicatesCached } from "@/services/duplicate-detection";
import { getFlag } from "@/services/feature-flags";
import { getLastBackupAt, getThemePreference, setThemePreference } from "@/services/settings";
import { isSmsDetectionEnabled } from "@/services/sms";
import { countUnrecognisedSms } from "@/services/sms/user-sms-templates";

import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, View } from "react-native";
import { PRIVACY_POLICY_URL, TERMS_URL } from "@/components/sms/SmsDisclosure";
import { isDemoBuild, seedDemoData } from "@/services/demo-data";
import { useTheme } from "@/hooks/use-theme";

const THEME_OPTIONS: { value: "system" | "light" | "dark"; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "system", label: "System", icon: "phone-portrait-outline" },
  { value: "light", label: "Light", icon: "sunny-outline" },
  { value: "dark", label: "Dark", icon: "moon-outline" },
];

interface SettingsRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  onPress: () => void;
  disabled?: boolean;
  iconColor?: string;
}

function SettingsRow({ icon, label, subtitle, onPress, disabled, iconColor }: SettingsRowProps) {
  const { colors: themeColors } = useColorScheme();
  const uiTheme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="border-b border-border"
      style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, opacity: disabled ? 0.4 : 1 }}
    >
      <Ionicons name={icon} size={20} color={iconColor ?? themeColors.textSecondary} />
      <View className="flex-1 ml-3">
        <Text className="text-base text-foreground">
          {label}
        </Text>
        {subtitle && (
          <Text className="text-xs text-faint-foreground mt-0.5">{subtitle}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={themeColors.textSecondary} />
    </PressableScale>
  );
}

export default function SettingsScreen() {
  const alert = useAlert();
  const router = useRouter();
  const { colorScheme, setColorScheme, colors } = useColorScheme();
  const uiTheme = useTheme();
  const [theme, setTheme] = useState(getThemePreference);
  // Status lines for the combined screens.
  const [messagesLine, setMessagesLine] = useState("Scan, templates, your name, duplicates");
  const [backupLine, setBackupLine] = useState("Backups, recycle bin, import, clean up");

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

      const android = Platform.OS === "android";
      const smsOn = android && isSmsDetectionEnabled();
      Promise.all([
        android ? countUnrecognisedSms().catch(() => 0) : Promise.resolve(0),
        scanAllDuplicatesCached(DEFAULT_USER_ID).then((r) => r.duplicateGroupCount).catch(() => 0),
      ]).then(([unread, dupes]) => {
        const needs: string[] = [];
        if (unread > 0) needs.push(`${unread} unread`);
        if (dupes > 0) needs.push(`${dupes} possible duplicate${dupes === 1 ? "" : "s"}`);
        const base = !android ? "Bank messages via Shortcuts" : smsOn ? "Reading on" : "Reading off";
        setMessagesLine(needs.length > 0 ? `${base} · ${needs.join(" · ")}` : `${base} · scan, templates, your name, duplicates`);
      });
    }, []),
  );

  const handleThemeChange = useCallback((value: "system" | "light" | "dark") => {
    setThemePreference(value);
    setColorScheme(value);
    setTheme(value);
  }, [setColorScheme]);

  const activeThemeLabel = theme === "system"
    ? `System (${colorScheme === "dark" ? "Dark" : "Light"})`
    : theme === "dark" ? "Dark" : "Light";

  return (
    <ScreenContainer>
      <ContextualHeader title="Settings" />
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-4 py-4">
          <Card title="Data Management" className="mb-4">
            <SettingsRow icon="grid-outline" label="Categories" subtitle="Manage expense categories" onPress={() => router.push("/settings/categories")} />
            <SettingsRow icon="card-outline" label="Payment Modes" subtitle="Credit cards, UPI, wallets" onPress={() => router.push("/settings/payment-modes")} />
            <SettingsRow icon="business-outline" label="Accounts" subtitle="Add & manage account details" onPress={() => router.push("/settings/account-master")} />
            <SettingsRow icon="pricetags-outline" label="Tags" subtitle="Label and organize expenses" onPress={() => router.push("/settings/tags")} />
            <SettingsRow icon="calculator-outline" label="Budget Configuration" subtitle="Set monthly budgets per category" onPress={() => router.push("/settings/budget-config")} />
          </Card>

          <Card title="Transactions" className="mb-4">
            <SettingsRow icon="chatbubbles-outline" label="Transaction Messages" subtitle={messagesLine} onPress={() => router.push("/settings/transaction-messages")} />
            <SettingsRow icon="storefront-outline" label="Merchants" subtitle="Names, merged names and the category each one goes to" onPress={() => router.push("/settings/merchants")} />
          </Card>

          <Card title="Automation" className="mb-4">
            <SettingsRow icon="sparkles-outline" label="AI Assisted Setup" subtitle="Let your AI assistant set up categories, budgets, income and goals" onPress={() => router.push("/settings/ai-assisted-setup")} />
            <SettingsRow icon="flash-outline" label="Smart Rules" subtitle="Auto-categorize expenses by merchant, amount, account" onPress={() => router.push("/settings/smart-rules")} />
            <SettingsRow icon="repeat-outline" label="Reminders" subtitle="Rent, subscriptions, anything that repeats" onPress={() => router.push("/settings/recurring-rules")} />
            <SettingsRow icon="mic-outline" label="Voice Input" subtitle="Voice sound, speak-back questions on or off" onPress={() => router.push("/settings/voice-input")} />
            <SettingsRow icon="list-outline" label="Audit Log" subtitle="See every action taken on detected and manual records" onPress={() => router.push("/settings/audit-log")} />
          </Card>

          <Card title="Integrations" className="mb-4">
            <SettingsRow icon="trending-up-outline" label="Zerodha Kite" subtitle="Connect your Zerodha account to sync portfolio" onPress={() => router.push("/settings/kite-connect")} />
            <SettingsRow icon="bar-chart-outline" label="Angel One" subtitle="Connect your Angel One account to sync portfolio" onPress={() => router.push("/settings/angel-connect" as any)} />
            <SettingsRow icon="logo-bitcoin" label="Zebpay" subtitle="Connect your Zebpay account to view crypto portfolio" onPress={() => router.push("/settings/zebpay-connect" as any)} />
          </Card>

          <Card title="Backup and Data" className="mb-4">
            <SettingsRow icon="cloud-upload-outline" label="Backup and Data" subtitle={backupLine} onPress={() => router.push("/settings/backup-data")} />
          </Card>

          <Card title="Preferences & Security" className="mb-4">
            <SettingsRow icon="globe-outline" label="Region" subtitle="Currency, date format, number format, fiscal year" onPress={() => router.push("/settings/region")} />
            <SettingsRow icon="notifications-outline" label="Notifications" subtitle="SMS scan alerts, due reminders" onPress={() => router.push("/settings/notifications")} />
            <SettingsRow icon="calendar-outline" label="Calendar sync" subtitle="Bills, EMIs and reminders in your calendar" onPress={() => router.push("/settings/calendar-sync")} />
            <SettingsRow icon="grid-outline" label="Home Cards" subtitle="Show or hide any card on the Home screen" onPress={() => router.push("/settings/home-cards")} />
            <SettingsRow icon="lock-closed-outline" label="Security" subtitle="App lock with biometric authentication" onPress={() => router.push("/settings/security")} />
            <>
              <Text className="text-xs font-semibold uppercase tracking-wider text-faint-foreground mt-4 mb-2">Theme</Text>
              <Text className="text-sm text-muted-foreground mb-3">Current: {activeThemeLabel}</Text>
              <View className="flex-row">
                {THEME_OPTIONS.map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() => handleThemeChange(option.value)}
                    className={`flex-1 items-center py-3 mx-1 rounded-lg border ${theme === option.value ? "" : "border-border"}`}
                    style={theme === option.value ? { borderColor: uiTheme.primary, backgroundColor: uiTheme.alpha("primary", 0.1) } : undefined}
                    >
                      <Ionicons name={option.icon} size={20} color={theme === option.value ? colors.blue : colors.textSecondary} />
                      <Text
                        className={`text-xs mt-1 ${theme === option.value ? "font-medium" : "text-muted-foreground"}`}
                        style={theme === option.value ? { color: uiTheme.primary } : undefined}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
            </>
          </Card>

          {isDemoBuild() && (
            <Card title="Demo build" className="mb-4">
              <SettingsRow
                icon="flask-outline"
                label="Load sample data"
                subtitle="Fictional accounts and transactions for screenshots"
                onPress={() =>
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
                  ])
                }
              />
            </Card>
          )}

          <Card title="About & Help" className="mb-4">
            {getFlag("v15_help_center") && (
              <SettingsRow
                icon="help-circle-outline"
                label="Help Center"
                subtitle="Ask anything in plain English"
                onPress={() => router.push("/settings/help")}
              />
            )}
            <SettingsRow
              icon="shield-checkmark-outline"
              label="Privacy policy"
              subtitle="What Arth reads, stores and never sends"
              onPress={() => Linking.openURL(PRIVACY_POLICY_URL).catch(() => {})}
            />
            <SettingsRow
              icon="reader-outline"
              label="Terms of use"
              onPress={() => Linking.openURL(TERMS_URL).catch(() => {})}
            />
            <SettingsRow
              icon="document-text-outline"
              label="Open-source licences"
              subtitle="Libraries and models Arth is built with"
              onPress={() => router.push("/settings/licenses")}
            />
            <View className="flex-row items-center justify-between py-2 border-b border-border">
              <Text className="text-sm" style={{ color: colors.textSecondary }}>App Name</Text>
              <View className="flex-row items-center" style={{ gap: 4 }}>
                <Text className="text-sm font-medium" style={{ color: colors.text }}>Arth ·</Text>
                <Text className="text-sm font-medium text-foreground">अर्थ</Text>
              </View>
            </View>
            <View className="flex-row items-center justify-between py-2">
              <Text className="text-sm" style={{ color: colors.textSecondary }}>Version</Text>
              <Text className="text-sm font-medium" style={{ color: colors.text }}>
                {(() => {
                  const v = require("expo-constants").default.expoConfig?.version ?? "-";
                  const sha = require("@/constants/build-info").COMMIT_SHA;
                  return sha ? `${v} - ${sha}` : v;
                })()}
              </Text>
            </View>
          </Card>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
