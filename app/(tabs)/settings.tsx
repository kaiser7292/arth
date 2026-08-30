import { Card, ContextualHeader, DateInput, LearnMoreChip, ScreenContainer } from "@/components/ui";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { DEFAULT_USER_ID } from "@/constants/app";
import { StatusColors } from "@/constants/theme";
import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { CleanupObjectType, CleanupScope, CustomDateRange } from "@/services/data-cleanup";
import { cleanupData, getCleanupPreview } from "@/services/data-cleanup";
import {
  getDismissedDuplicateCount,
  invalidateDuplicateScanCache,
  scanAllDuplicates,
} from "@/services/duplicate-detection";
import { getFlag } from "@/services/feature-flags";
import type { FinancialAccount } from "@/services/financial-account";
import { getActiveAccounts } from "@/services/financial-account";
import {
  getFYStartMonth,
  getThemePreference,
  setFYStartMonth,
  setThemePreference,
} from "@/services/settings";
import {
  disableSmsDetection,
  enableSmsDetection,
  getSmsEndDate,
  getSmsScanAccountIds,
  getSmsStartDate,
  isSmsDetectionEnabled,
  runSmsScan,
  setSmsScanAccountIds as saveSmsScanAccountIds,
  setSmsEndDate,
  setSmsStartDate,
} from "@/services/sms";
import { countUnrecognisedSms } from "@/services/sms/user-sms-templates";
import { ac } from "@/utils/accent";
import { formatDisplayDate as formatDateLabel } from "@/utils/date";
import { getCurrentFY, getFYLabel } from "@/utils/fiscal-year";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";

const SMS_DATE_PRESETS = [
  { label: "Today", daysBack: 0 },
  { label: "Last 7 days", daysBack: 7 },
  { label: "Last 30 days", daysBack: 30 },
  { label: "Last 90 days", daysBack: 90 },
  { label: "Last 6 months", daysBack: 180 },
  { label: "Last 1 year", daysBack: 365 },
] as const;

function dateMinusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function accountTypeLabel(type: string): string {
  switch (type) {
    case "credit_card": return "Credit Card";
    case "savings": case "bank": return "Savings";
    case "wallet": return "Wallet";
    case "loan": return "Loan";
    case "pension": return "Pension";
    case "demat": return "Demat";
    default: return type;
  }
}


const FY_OPTIONS = [
  { month: 1, label: "January – December", region: "US / UK" },
  { month: 4, label: "April – March", region: "India (default)" },
  { month: 7, label: "July – June", region: "Australia" },
  { month: 10, label: "October – September", region: "US Federal" },
];

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
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-row items-center py-3 border-b border-border-light dark:border-border-dark ${disabled ? "opacity-40" : ""}`}
    >
      <Ionicons name={icon} size={20} color={iconColor ?? themeColors.textSecondary} />
      <View className="flex-1 ml-3">
        <Text className="text-base text-text-primary dark:text-text-dark-primary">
          {label}
        </Text>
        {subtitle && (
          <Text className="text-xs text-text-tertiary mt-0.5">{subtitle}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={themeColors.textSecondary} />
    </Pressable>
  );
}

export default function SettingsScreen() {
  const alert = useAlert();
  const router = useRouter();
  const { colorScheme, setColorScheme, colors, accent } = useColorScheme();
  const [startMonth, setStartMonth] = useState(getFYStartMonth);
  const [theme, setTheme] = useState(getThemePreference);
  const [smsEnabled, setSmsEnabled] = useState(() => isSmsDetectionEnabled());
  const [unrecognisedSmsCount, setUnrecognisedSmsCount] = useState(0);
  const [smsToggling, setSmsToggling] = useState(false);
  const [smsScanning, setSmsScanning] = useState(false);
  const [smsScanResult, setSmsScanResult] = useState<string | null>(null);
  const [smsScanCreated, setSmsScanCreated] = useState(0);
  const [smsStartDateStr, setSmsStartDateStr] = useState(() => getSmsStartDate());
  const [smsEndDateStr, setSmsEndDateStr] = useState(() => getSmsEndDate());
  const [smsScanAccountIds, setSmsScanAccountIds] = useState<string[]>(() => getSmsScanAccountIds());
  const [allAccounts, setAllAccounts] = useState<FinancialAccount[]>([]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customFromText, setCustomFromText] = useState("");
  const [customToText, setCustomToText] = useState("");
  const [customDateError, setCustomDateError] = useState<string | null>(null);
  const [showCleanupPicker, setShowCleanupPicker] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupScope, setCleanupScope] = useState<CleanupScope | null>(null);
  const [cleanupObjects, setCleanupObjects] = useState<Set<CleanupObjectType>>(new Set());
  const [cleanupPreview, setCleanupPreview] = useState<Record<CleanupObjectType, number> | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [dismissedDupCount, setDismissedDupCount] = useState(0);
  const [showAccountPicker, setShowAccountPicker] = useState(false);

  // Settings - all sections always visible

  useFocusEffect(
    useCallback(() => {
      setDismissedDupCount(getDismissedDuplicateCount());
      countUnrecognisedSms()
        .then(setUnrecognisedSmsCount)
        .catch(() => {
          /* non-fatal */
        });
      setSmsScanAccountIds(getSmsScanAccountIds());
      getActiveAccounts(DEFAULT_USER_ID).then(setAllAccounts).catch(() => {
        /* non-fatal */
      });
      // v15.11.3: scan-result CTAs ("Review N expenses" / "Review N duplicate
      // groups") are actionable signals tied to the just-run scan. When the
      // user returns to Settings after tapping one of those CTAs — whether
      // they reviewed / skipped / backed out — the prompt is stale. Clear
      // it so they don't re-tap and land on a now-empty review queue.
      setSmsScanResult(null);
      setSmsScanCreated(0);
      setDupScanResult(null);
      setDupGroupCount(0);
    }, []),
  );

  const [cleanupCustomFrom, setCleanupCustomFrom] = useState("");
  const [cleanupCustomTo, setCleanupCustomTo] = useState("");
  const [cleanupCustomRange, setCleanupCustomRange] = useState<CustomDateRange | undefined>(undefined);
  const [cleanupDateError, setCleanupDateError] = useState<string | null>(null);

  // Duplicate detection state
  const [dupScanning, setDupScanning] = useState(false);
  const [dupScanResult, setDupScanResult] = useState<string | null>(null);
  const [dupGroupCount, setDupGroupCount] = useState(0);

  // Scheduled scan removed — auto-scan now runs on app open with 30-min cooldown.

  const handleFYChange = useCallback((month: number) => {
    setFYStartMonth(month);
    setStartMonth(month);
  }, []);

  const handleSmsToggle = useCallback(async (enable: boolean) => {
    setSmsToggling(true);
    try {
      if (enable) {
        // Show explanation dialog before requesting permission
        alert(
          "Read Bank SMS",
          "Arth can read your bank transaction SMS (ICICI, HDFC, Axis, SBI, UPI) to detect expenses.\n\nWhat happens:\n• Only bank/UPI SMS are read - personal messages are ignored\n• All processing happens on your device\n• Detected expenses go to a review queue - you approve each one\n• You can scan manually or turn on automatic scanning\n\nWe'll ask for SMS permission next.",
          [
            { text: "Not Now", style: "cancel" },
            {
              text: "Continue",
              onPress: async () => {
                const granted = await enableSmsDetection();
                if (granted) {
                  setSmsEnabled(true);
                } else {
                  alert("Permission Denied", "SMS reading requires SMS permission. You can enable it later in Settings.");
                }
              },
            },
          ],
        );
      } else {
        disableSmsDetection();
        setSmsEnabled(false);
      }
    } catch (e) {
      alert("Error", e instanceof Error ? e.message : String(e));
    }
    setSmsToggling(false);
  }, []);

  const handleManualScan = useCallback(async () => {
    setSmsScanning(true);
    setSmsScanResult(null);
    setSmsScanCreated(0);
    try {
      const outcome = await runSmsScan({ manual: true, accountIds: smsScanAccountIds });
      if (outcome.reason === "error") {
        setSmsScanResult(`Error: ${outcome.error ?? "Scan failed"}`);
      } else if (outcome.reason === "no_permission") {
        setSmsScanResult("SMS permission is not granted. Enable it in device settings.");
      } else if (outcome.reason === "sms_disabled") {
        setSmsScanResult("SMS detection is off. Turn it on above.");
      } else if (outcome.totalScanned === 0) {
        setSmsScanResult(`No new bank SMS found from ${formatDateLabel(smsStartDateStr)} to ${formatDateLabel(smsEndDateStr)}.`);
      } else {
        setSmsScanCreated(outcome.created);
        const parts: string[] = [];
        if (outcome.created > 0) parts.push(`${outcome.created} expense${outcome.created > 1 ? "s" : ""} to review`);
        if (outcome.credits > 0) parts.push(`${outcome.credits} credit${outcome.credits > 1 ? "s" : ""}`);
        if (outcome.skipped > 0) parts.push(`${outcome.skipped} skipped`);
        setSmsScanResult(`Scanned ${outcome.totalScanned} bank SMS${parts.length > 0 ? `. ${parts.join(", ")}.` : "."}`);
      }
    } catch (e) {
      setSmsScanResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setSmsScanning(false);
    handleDuplicateScan(true);
  }, [smsStartDateStr, smsEndDateStr, smsScanAccountIds]);

  const handleDuplicateScan = useCallback(async (silent = false) => {
    setDupScanning(true);
    if (!silent) { setDupScanResult(null); setDupGroupCount(0); }
    try {
      // User-initiated scan — bypass cache.
      invalidateDuplicateScanCache();
      const result = await scanAllDuplicates(DEFAULT_USER_ID);
      setDupGroupCount(result.duplicateGroupCount);
      if (result.duplicateGroupCount > 0) {
        setDupScanResult(`Found ${result.duplicateGroupCount} potential duplicate group${result.duplicateGroupCount > 1 ? "s" : ""} across ${result.scannedCount} expenses.`);
      } else if (!silent) {
        setDupScanResult(`Scanned ${result.scannedCount} expenses. No duplicates found.`);
      }
    } catch (e) {
      if (!silent) setDupScanResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setDupScanning(false);
  }, []);

  const handleDatePreset = useCallback((daysBack: number) => {
    const from = dateMinusDays(daysBack);
    const to = dateMinusDays(0);
    setSmsStartDate(from); setSmsEndDate(to);
    setSmsStartDateStr(from); setSmsEndDateStr(to);
    setCustomMode(false); setShowDatePicker(false); setSmsScanResult(null);
  }, []);

  const isValidDate = useCallback((str: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
    return !isNaN(new Date(str).getTime());
  }, []);

  const handleCustomDateApply = useCallback(() => {
    if (!isValidDate(customFromText)) { setCustomDateError("Invalid 'From' date. Use YYYY-MM-DD format."); return; }
    if (!isValidDate(customToText)) { setCustomDateError("Invalid 'To' date. Use YYYY-MM-DD format."); return; }
    if (customFromText > customToText) { setCustomDateError("'From' date must be before 'To' date."); return; }
    setCustomDateError(null);
    setSmsStartDate(customFromText); setSmsEndDate(customToText);
    setSmsStartDateStr(customFromText); setSmsEndDateStr(customToText);
    setShowDatePicker(false); setSmsScanResult(null);
  }, [customFromText, customToText, isValidDate]);

  // Scheduled scan handlers removed — auto-scan runs on app open with 30-min cooldown.

  // ── Cleanup Handlers ──

  const handleCleanupScopeSelect = useCallback(async (scope: CleanupScope) => {
    setCleanupScope(scope);
    if (scope === "custom") { setCleanupPreview(null); setCleanupDateError(null); return; }
    setCleanupCustomFrom(""); setCleanupCustomTo(""); setCleanupCustomRange(undefined); setCleanupDateError(null);
    setLoadingPreview(true);
    try {
      const preview = await getCleanupPreview(DEFAULT_USER_ID, scope, Array.from(cleanupObjects));
      setCleanupPreview(preview);
    } catch { setCleanupPreview(null); }
    setLoadingPreview(false);
  }, [cleanupObjects]);

  const handleCleanupCustomApply = useCallback(async () => {
    if (!isValidDate(cleanupCustomFrom)) { setCleanupDateError("Invalid 'From' date."); return; }
    if (!isValidDate(cleanupCustomTo)) { setCleanupDateError("Invalid 'To' date."); return; }
    if (cleanupCustomFrom > cleanupCustomTo) { setCleanupDateError("'From' must be before 'To'."); return; }
    setCleanupDateError(null);
    const range: CustomDateRange = { startDate: cleanupCustomFrom, endDate: cleanupCustomTo };
    setCleanupCustomRange(range); setLoadingPreview(true);
    try {
      const preview = await getCleanupPreview(DEFAULT_USER_ID, "custom", Array.from(cleanupObjects), range);
      setCleanupPreview(preview);
    } catch { setCleanupPreview(null); }
    setLoadingPreview(false);
  }, [cleanupCustomFrom, cleanupCustomTo, cleanupObjects, isValidDate]);

  const toggleCleanupObject = useCallback(async (obj: CleanupObjectType) => {
    const next = new Set(cleanupObjects);
    if (next.has(obj)) next.delete(obj); else next.add(obj);
    setCleanupObjects(next);
    if (cleanupScope && (cleanupScope !== "custom" || cleanupCustomRange)) {
      setLoadingPreview(true);
      try {
        const preview = await getCleanupPreview(DEFAULT_USER_ID, cleanupScope, Array.from(next), cleanupCustomRange);
        setCleanupPreview(preview);
      } catch { setCleanupPreview(null); }
      setLoadingPreview(false);
    }
  }, [cleanupScope, cleanupObjects, cleanupCustomRange]);

  const executeCleanup = useCallback(async () => {
    if (!cleanupScope || cleanupObjects.size === 0) return;
    if (cleanupScope === "custom" && !cleanupCustomRange) return;

    const types = Array.from(cleanupObjects) as CleanupObjectType[];
    const scope = cleanupScope;
    const scopeLabel = scope === "all" ? "all time"
      : scope === "custom" && cleanupCustomRange ? `${formatDateLabel(cleanupCustomRange.startDate)} to ${formatDateLabel(cleanupCustomRange.endDate)}`
      : `the last ${scope}`;
    const typeLabels = types.map((t) =>
      t === "pending_sms" ? "pending SMS" : t === "merchant_aliases" ? "merchant aliases" : t === "salary_profiles" ? "salary profiles" : t === "payment_modes" ? "payment modes" : t === "accounts" ? "accounts & ledger" : t,
    ).join(", ");

    const previewLines: string[] = [];
    if (cleanupPreview) {
      for (const t of types) {
        const count = cleanupPreview[t];
        if (count > 0) {
          const label = t === "pending_sms" ? "pending SMS" : t === "merchant_aliases" ? "merchant aliases" : t === "salary_profiles" ? "salary profiles" : t === "payment_modes" ? "payment modes" : t === "accounts" ? "accounts & ledger" : t;
          previewLines.push(`  ${label}: ${count}`);
        }
      }
    }
    const previewText = previewLines.length > 0 ? `\n\nRecords to delete:\n${previewLines.join("\n")}` : "";

    alert(
      "Are you sure?",
      `This will permanently delete ${typeLabels} from ${scopeLabel}.${previewText}\n\nThis action CANNOT be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setShowCleanupPicker(false); setCleanupScope(null); setCleanupPreview(null);
            setCleanupObjects(new Set()); setCleanupCustomFrom(""); setCleanupCustomTo("");
            setCleanupCustomRange(undefined); setCleanupDateError(null); setCleaning(true);
            try {
              const result = await cleanupData(DEFAULT_USER_ID, scope, types, cleanupCustomRange);
              const parts: string[] = [];
              if (result.expensesDeleted > 0) parts.push(`${result.expensesDeleted} expenses`);
              if (result.creditsDeleted > 0) parts.push(`${result.creditsDeleted} credits`);
              if (result.budgetsDeleted > 0) parts.push(`${result.budgetsDeleted} budgets`);
              if (result.categoriesDeleted > 0) parts.push(`${result.categoriesDeleted} categories`);
              if (result.paymentModesDeleted > 0) parts.push(`${result.paymentModesDeleted} payment modes`);
              if (result.pendingSmsDeleted > 0) parts.push(`${result.pendingSmsDeleted} pending SMS`);
              if (result.merchantAliasesDeleted > 0) parts.push(`${result.merchantAliasesDeleted} merchant aliases`);
              if (result.hisaabDeleted > 0) parts.push(`${result.hisaabDeleted} hisaab entries`);
              if (result.tagsDeleted > 0) parts.push(`${result.tagsDeleted} tags`);
              if (result.salaryProfilesDeleted > 0) parts.push(`${result.salaryProfilesDeleted} salary profiles`);
              if (result.accountsDeleted > 0) parts.push(`${result.accountsDeleted} accounts`);
              if (result.auditLogDeleted > 0) parts.push(`${result.auditLogDeleted} audit log entries`);
              alert("Cleanup Complete",
                parts.length > 0
                  ? `Deleted ${parts.join(", ")}.` + (result.errors.length > 0 ? `\n${result.errors.length} errors occurred.` : "")
                  : "No records matched the selected criteria.",
              );
            } catch (e) { alert("Error", e instanceof Error ? e.message : String(e)); }
            setCleaning(false);
          },
        },
      ],
    );
  }, [cleanupScope, cleanupObjects, cleanupPreview, cleanupCustomRange]);

  const handleThemeChange = useCallback((value: "system" | "light" | "dark") => {
    setThemePreference(value);
    setColorScheme(value);
    setTheme(value);
  }, [setColorScheme]);

  const currentFY = getCurrentFY(startMonth);
  const fyLabel = getFYLabel(currentFY, startMonth);
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
            <SettingsRow icon="download-outline" label="Import from Excel" subtitle="Import transactions or hisaab entries from an .xlsx file" onPress={() => router.push("/settings/import-excel")} />
            <SettingsRow icon="checkmark-done-outline" label="Reconcile Accounts" subtitle="Match bank statements against your Arth ledger" onPress={() => router.push("/settings/reconciliation")} />
          </Card>

          <Card title="Automation" className="mb-4">
            <SettingsRow icon="mic-outline" label="Voice Input" subtitle="Voice sound, speak-back questions on or off" onPress={() => router.push("/settings/voice-input" as never)} />
            <SettingsRow icon="sparkles-outline" label="Arth AI" subtitle="On-device AI assistant and smart search" onPress={() => router.push("/settings/ai-assistant" as never)} />
            <SettingsRow icon="repeat-outline" label="Reminders" subtitle="Rent, subscriptions, anything that repeats" onPress={() => router.push("/settings/recurring-rules" as never)} />
            <SettingsRow icon="flash-outline" label="Smart Rules" subtitle="Auto-categorize expenses by merchant, amount, account" onPress={() => router.push("/settings/smart-rules" as never)} />
            <SettingsRow icon="construct-outline" label="Smart SMS Templates" subtitle="Teach Arth to read SMS from any bank" onPress={() => router.push("/settings/sms-templates" as never)} />
            <SettingsRow icon="swap-horizontal-outline" label="Merchant Aliases" subtitle="Clean up SMS merchant names" onPress={() => router.push("/settings/merchant-aliases")} />
            <SettingsRow icon="list-outline" label="Audit Log" subtitle="See every action taken on detected and manual records" onPress={() => router.push("/settings/audit-log" as never)} />
          </Card>

          <Card title="Backup & Storage" className="mb-4">
            <SettingsRow icon="cloud-upload-outline" label="Backup & Restore" subtitle="Create encrypted backups, restore data" onPress={() => router.push("/settings/backup-restore")} />
            <SettingsRow icon="trash-bin-outline" label="Recycle Bin" subtitle="Restore or permanently delete removed expenses" onPress={() => router.push("/settings/recycle-bin")} />
            {dismissedDupCount > 0 && (
              <SettingsRow
                icon="copy-outline"
                label="Dismissed Duplicate Groups"
                subtitle={`${dismissedDupCount} group${dismissedDupCount === 1 ? "" : "s"} kept as-is · tap to view`}
                onPress={() => router.push("/settings/dismissed-duplicates" as never)}
              />
            )}
            <Pressable
              onPress={() => {
                const next = !showCleanupPicker;
                setShowCleanupPicker(next);
                if (!next) {
                  setCleanupScope(null); setCleanupPreview(null);
                  setCleanupCustomFrom(""); setCleanupCustomTo("");
                  setCleanupCustomRange(undefined); setCleanupDateError(null);
                }
              }}
              disabled={cleaning}
              className="flex-row items-center py-3 border-b border-border-light dark:border-border-dark"
            >
              <Ionicons name="trash-outline" size={20} color={StatusColors[colorScheme].danger} />
              <View className="flex-1 ml-3">
                <Text className="text-base text-danger">Clean Up Data</Text>
                <Text className="text-xs text-text-tertiary mt-0.5">Remove expenses and budgets by time range</Text>
              </View>
              {cleaning ? (
                <ActivityIndicator size="small" color={StatusColors[colorScheme].danger} />
              ) : (
                <Ionicons name={showCleanupPicker ? "chevron-down" : "chevron-forward"} size={18} color={colors.textSecondary} />
              )}
            </Pressable>

            {showCleanupPicker && !cleaning && (
          <View className="ml-8 mb-2">
            <Text className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2 mt-1">1. Time Range</Text>
            <View className="flex-row flex-wrap gap-1.5 mb-3">
              {([
                { scope: "day" as CleanupScope, label: "Today" },
                { scope: "week" as CleanupScope, label: "This Week" },
                { scope: "month" as CleanupScope, label: "This Month" },
                { scope: "quarter" as CleanupScope, label: "Quarter" },
                { scope: "all" as CleanupScope, label: "Everything" },
                { scope: "custom" as CleanupScope, label: "Custom" },
              ]).map((option) => (
                <Pressable
                  key={option.scope}
                  onPress={() => handleCleanupScopeSelect(option.scope)}
                  className={`px-3 py-1.5 rounded-full border ${cleanupScope === option.scope ? "bg-[#EF444414]" : "border-border-light dark:border-border-dark"}`}
                  style={cleanupScope === option.scope ? { borderColor: StatusColors[colorScheme].danger } : undefined}
                >
                  <Text className={`text-xs font-medium ${cleanupScope === option.scope ? "text-danger" : "text-text-primary dark:text-text-dark-primary"}`}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {cleanupScope === "custom" && (
              <View className="mb-3">
                <View className="flex-row items-center mb-2">
                  <View className="flex-1 mr-2"><DateInput label="From" value={cleanupCustomFrom} onChange={setCleanupCustomFrom} maximumDate={null} /></View>
                  <View className="flex-1"><DateInput label="To" value={cleanupCustomTo} onChange={setCleanupCustomTo} maximumDate={null} /></View>
                </View>
                {cleanupDateError && <Text className="text-xs text-danger mb-2">{cleanupDateError}</Text>}
                <Pressable onPress={handleCleanupCustomApply} className="py-2 rounded-lg items-center" style={{ backgroundColor: StatusColors[colorScheme].danger }}>
                  <Text className="text-sm font-medium text-white">Apply Range</Text>
                </Pressable>
                {cleanupCustomRange && (
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-1.5 text-center">
                    {formatDateLabel(cleanupCustomRange.startDate)} - {formatDateLabel(cleanupCustomRange.endDate)}
                  </Text>
                )}
              </View>
            )}

            {cleanupScope && (cleanupScope !== "custom" || cleanupCustomRange) && (
              <>
                <Text className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">2. What to Delete</Text>
                {([
                  { type: "expenses" as CleanupObjectType, label: "Expenses", icon: "receipt-outline" as keyof typeof Ionicons.glyphMap },
                  { type: "credits" as CleanupObjectType, label: "Credits (Salary, Refunds)", icon: "arrow-down-outline" as keyof typeof Ionicons.glyphMap },
                  { type: "budgets" as CleanupObjectType, label: "Budgets", icon: "pie-chart-outline" as keyof typeof Ionicons.glyphMap },
                  { type: "categories" as CleanupObjectType, label: "Categories", icon: "grid-outline" as keyof typeof Ionicons.glyphMap },
                  { type: "payment_modes" as CleanupObjectType, label: "Payment Modes", icon: "card-outline" as keyof typeof Ionicons.glyphMap },
                  { type: "pending_sms" as CleanupObjectType, label: "Pending SMS", icon: "chatbubble-outline" as keyof typeof Ionicons.glyphMap },
                  { type: "merchant_aliases" as CleanupObjectType, label: "Merchant Aliases", icon: "swap-horizontal-outline" as keyof typeof Ionicons.glyphMap },
                  { type: "hisaab" as CleanupObjectType, label: "Hisaab Entries", icon: "people-outline" as keyof typeof Ionicons.glyphMap },
                  { type: "tags" as CleanupObjectType, label: "Tags", icon: "pricetags-outline" as keyof typeof Ionicons.glyphMap },
                  { type: "salary_profiles" as CleanupObjectType, label: "Salary / Income Calculator", icon: "calculator-outline" as keyof typeof Ionicons.glyphMap },
                  { type: "accounts" as CleanupObjectType, label: "Accounts & Ledger", icon: "wallet-outline" as keyof typeof Ionicons.glyphMap },
                  { type: "audit_log" as CleanupObjectType, label: "Audit Log", icon: "document-text-outline" as keyof typeof Ionicons.glyphMap },
                ]).map((item) => {
                  const checked = cleanupObjects.has(item.type);
                  const count = cleanupPreview?.[item.type] ?? 0;
                  return (
                    <Pressable
                      key={item.type}
                      onPress={() => toggleCleanupObject(item.type)}
                      className={`flex-row items-center justify-between rounded-lg px-3 py-2.5 mb-1.5 border ${checked ? "border-[#FECACA] dark:border-[#7F1D1D] bg-[#DC262608]" : "border-border-light dark:border-border-dark"}`}
                    >
                      <View className="flex-row items-center flex-1">
                        <Ionicons name={checked ? "checkbox" : "square-outline"} size={20} color={checked ? StatusColors[colorScheme].danger : colors.textSecondary} />
                        <Ionicons name={item.icon} size={16} color={colors.textSecondary} style={{ marginLeft: 8 }} />
                        <Text className="text-sm text-text-primary dark:text-text-dark-primary ml-2">{item.label}</Text>
                      </View>
                      {loadingPreview ? (
                        <ActivityIndicator size="small" color={colors.textSecondary} />
                      ) : (
                        <Text className={`text-xs font-medium ${count > 0 ? "text-danger" : "text-text-tertiary"}`}>{count}</Text>
                      )}
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={executeCleanup}
                  disabled={cleanupObjects.size === 0}
                  className="flex-row items-center justify-center py-2.5 mt-1 rounded-lg"
                  style={{ backgroundColor: cleanupObjects.size === 0 ? "#9CA3AF40" : StatusColors[colorScheme].danger }}
                >
                  <Ionicons name="trash-outline" size={16} color="#FFFFFF" />
                  <Text className="text-sm font-semibold text-white ml-2">Delete Selected</Text>
                </Pressable>
              </>
            )}
          </View>
        )}
          </Card>


          {Platform.OS === "android" && (
            <Card title="SMS Detection" className="mb-4">
              <>
                <View className="mb-3">
                  <LearnMoreChip contextKey="sms-settings" label="Is SMS access safe?" />
                </View>
                <View className="flex-row items-center justify-between py-2 border-b border-border-light dark:border-border-dark">
                  <View className="flex-1 mr-3">
                    <Text className="text-base text-text-primary dark:text-text-dark-primary">Enable SMS Reading</Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">Detect expenses from SMS</Text>
                  </View>
                  {smsToggling ? (
                    <ActivityIndicator size="small" color={accent[500]} />
                  ) : (
                    <Switch value={smsEnabled} onValueChange={handleSmsToggle} trackColor={{ false: colors.border, true: accent[500] }} thumbColor={smsEnabled ? "#FFFFFF" : colors.textSecondary} />
                  )}
                </View>
              </>

              {smsEnabled && (
                <>
                  <Pressable onPress={() => setShowDatePicker(!showDatePicker)} className="flex-row items-center justify-between py-3 border-b border-border-light dark:border-border-dark">
                    <View>
                      <Text className="text-sm text-text-primary dark:text-text-dark-primary">Scan Date Range</Text>
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                        {smsEndDateStr === dateMinusDays(0)
                          ? `From ${formatDateLabel(smsStartDateStr)} → Today`
                          : `${formatDateLabel(smsStartDateStr)} → ${formatDateLabel(smsEndDateStr)}`}
                      </Text>
                    </View>
                    <Ionicons name={showDatePicker ? "chevron-up" : "chevron-down"} size={16} color={colors.textSecondary} />
                  </Pressable>

                  {showDatePicker && (
                    <View className="py-2 pl-4">
                      {SMS_DATE_PRESETS.map((preset) => (
                        <Pressable key={preset.label} onPress={() => handleDatePreset(preset.daysBack)} className="flex-row items-center justify-between py-2.5 px-3 mb-1 rounded-lg border border-border-light dark:border-border-dark">
                          <Text className="text-sm text-text-primary dark:text-text-dark-primary">{preset.label}</Text>
                          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">{formatDateLabel(dateMinusDays(preset.daysBack))} → Today</Text>
                        </Pressable>
                      ))}
                      <Pressable
                        onPress={() => { setCustomMode(!customMode); if (!customMode) { setCustomFromText(smsStartDateStr); setCustomToText(smsEndDateStr); setCustomDateError(null); } }}
                        className={`flex-row items-center justify-between py-2.5 px-3 mb-1 rounded-lg border ${customMode ? "" : "border-border-light dark:border-border-dark"}`}
                        style={customMode ? { borderColor: accent[500], backgroundColor: ac(accent, colorScheme, 50, 700) } : undefined}
                      >
                        <View className="flex-row items-center">
                          <Ionicons name="calendar-outline" size={16} color={customMode ? colors.blue : "#6B7280"} />
                          <Text className={`text-sm ml-2 ${customMode ? "font-medium" : "text-text-primary dark:text-text-dark-primary"}`} style={customMode ? { color: ac(accent, colorScheme, 500, 200) } : undefined}>Custom Range</Text>
                        </View>
                        <Ionicons name={customMode ? "chevron-up" : "chevron-down"} size={14} color={colors.textSecondary} />
                      </Pressable>
                      {customMode && (
                        <View className="mt-1 px-1">
                          <View className="flex-row items-center mb-2">
                            <View className="flex-1 mr-2"><DateInput label="From" value={customFromText} onChange={setCustomFromText} maximumDate={null} /></View>
                            <View className="flex-1"><DateInput label="To" value={customToText} onChange={setCustomToText} maximumDate={null} /></View>
                          </View>
                          {customDateError && <Text className="text-xs text-danger mb-2">{customDateError}</Text>}
                          <Pressable onPress={handleCustomDateApply} className="py-2 rounded-lg items-center mb-1" style={{ backgroundColor: accent[500] }}>
                            <Text className="text-sm font-medium text-white">Apply Range</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  )}
                </>
              )}

              {smsEnabled && (
                <>
                  {/* Account Filter */}
                  <View className="mt-4">
                    <Text className="text-xs font-semibold text-text-tertiary dark:text-text-dark-secondary uppercase tracking-wider mb-2">
                      Filter SMS by Account
                    </Text>
                    <Pressable
                      onPress={() => setShowAccountPicker(true)}
                      className="flex-row items-center justify-between py-3 px-4 rounded-lg border border-border-light dark:border-border-dark"
                    >
                      <View className="flex-1">
                        <Text className="text-sm text-text-primary dark:text-text-dark-primary">
                          {smsScanAccountIds.length === 0
                            ? "All accounts"
                            : `${smsScanAccountIds.length} account${smsScanAccountIds.length > 1 ? "s" : ""} selected`}
                        </Text>
                        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                          {smsScanAccountIds.length === 0
                            ? "Leave empty to scan all accounts"
                            : allAccounts
                                .filter((a) => smsScanAccountIds.includes(a.id))
                                .map((a) => a.account_label || a.bank_name)
                                .join(", ")}
                        </Text>
                      </View>
                      <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
                    </Pressable>
                  </View>

                  <Pressable onPress={handleManualScan} disabled={smsScanning} className="flex-row items-center justify-center py-3 mt-2 rounded-lg" style={{ backgroundColor: accent[500] }}>
                    {smsScanning ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Ionicons name="scan-outline" size={18} color="#FFFFFF" />
                        <Text className="text-sm font-medium text-white ml-2">Scan Now</Text>
                      </>
                    )}
                  </Pressable>

                  {smsScanResult && (
                    <View className="mt-2">
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary text-center">{smsScanResult}</Text>
                      {smsScanCreated > 0 && (
                        <Pressable onPress={() => router.push("/expense/review-queue")} className="flex-row items-center justify-center mt-2 py-2 rounded-lg bg-success/8">
                          <Ionicons name="checkmark-circle-outline" size={16} color={StatusColors[colorScheme].success} />
                          <Text className="text-sm font-medium text-success ml-1.5">Review {smsScanCreated} Expense{smsScanCreated > 1 ? "s" : ""}</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                </>
              )}

              {!smsEnabled && (
                <Text className="text-xs text-text-tertiary mt-2">Enable to read bank transaction SMS and auto-detect expenses. All data stays on your device.</Text>
              )}

              {unrecognisedSmsCount > 0 && (
                <Pressable
                  onPress={() => router.push("/settings/sms-templates/unrecognised" as never)}
                  className="flex-row items-center mt-3 pt-3 border-t border-border-light dark:border-border-dark"
                  accessibilityRole="button"
                  accessibilityLabel={`View ${unrecognisedSmsCount} unrecognised SMS`}
                >
                  <Ionicons name="help-circle-outline" size={18} color={accent[500]} />
                  <View className="flex-1 ml-3">
                    <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                      {unrecognisedSmsCount} unrecognised SMS
                    </Text>
                    <Text className="text-xs text-text-tertiary mt-0.5">
                      Arth couldn't read these. Tap to teach.
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </Pressable>
              )}

              <Pressable
                onPress={() => router.push("/settings/sms-scan-runs" as never)}
                className="flex-row items-center mt-3 pt-3 border-t border-border-light dark:border-border-dark"
              >
                <Ionicons name="analytics-outline" size={18} color={accent[500]} />
                <View className="flex-1 ml-3">
                  <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">Scan Runs</Text>
                  <Text className="text-xs text-text-tertiary mt-0.5">View scan history and pipeline details</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </Pressable>

              <View className="mt-4 pt-4 border-t border-border-light dark:border-border-dark">
                <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary mb-2">Duplicate scan</Text>
                <View className="flex-row items-center mb-2">
                  <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary ml-1.5 flex-1">Find expenses with the same amount, account, merchant, and date. Runs automatically after every SMS scan.</Text>
                </View>
                <Pressable onPress={() => handleDuplicateScan(false)} disabled={dupScanning} className="flex-row items-center justify-center py-3 rounded-lg" style={{ backgroundColor: accent[500] }}>
                  {dupScanning ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="copy-outline" size={18} color="#FFFFFF" />
                      <Text className="text-sm font-medium text-white ml-2">Scan for Duplicates</Text>
                    </>
                  )}
                </Pressable>
                {dupScanResult && (
                  <View className="mt-2">
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary text-center">{dupScanResult}</Text>
                    {dupGroupCount > 0 && (
                      <Pressable
                        onPress={() => router.push({ pathname: "/expense/review-queue", params: { filter: "duplicates" } })}
                        className="flex-row items-center justify-center mt-2 py-2 rounded-lg"
                        style={{ backgroundColor: StatusColors[colorScheme].warning + "14" }}
                      >
                        <Ionicons name="alert-circle-outline" size={16} color={StatusColors[colorScheme].warning} />
                        <Text className="text-sm font-medium ml-1.5" style={{ color: StatusColors[colorScheme].warning }}>
                          Review {dupGroupCount} Duplicate Group{dupGroupCount > 1 ? "s" : ""}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            </Card>
          )}

          {Platform.OS !== "android" && (
            <Card title="Duplicate Detection" className="mb-4">
              <View className="flex-row items-center mb-2">
                <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary ml-1.5 flex-1">Scan your expenses for potential duplicates - same amount, account, merchant, and date.</Text>
              </View>
              <Pressable onPress={() => handleDuplicateScan(false)} disabled={dupScanning} className="flex-row items-center justify-center py-3 rounded-lg" style={{ backgroundColor: accent[500] }}>
                {dupScanning ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="copy-outline" size={18} color="#FFFFFF" />
                    <Text className="text-sm font-medium text-white ml-2">Scan for Duplicates</Text>
                  </>
                )}
              </Pressable>
              {dupScanResult && (
                <View className="mt-2">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary text-center">{dupScanResult}</Text>
                  {dupGroupCount > 0 && (
                    <Pressable
                      onPress={() => router.push({ pathname: "/expense/review-queue", params: { filter: "duplicates" } })}
                      className="flex-row items-center justify-center mt-2 py-2 rounded-lg"
                      style={{ backgroundColor: StatusColors[colorScheme].warning + "14" }}
                    >
                      <Ionicons name="alert-circle-outline" size={16} color={StatusColors[colorScheme].warning} />
                      <Text className="text-sm font-medium ml-1.5" style={{ color: StatusColors[colorScheme].warning }}>
                        Review {dupGroupCount} Duplicate Group{dupGroupCount > 1 ? "s" : ""}
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}
            </Card>
          )}

          <Card title="Preferences & Security" className="mb-4">
            <SettingsRow icon="globe-outline" label="Region" subtitle="Currency, date format, number format, fiscal year" onPress={() => router.push("/settings/region" as never)} />
            <SettingsRow icon="notifications-outline" label="Notifications" subtitle="SMS scan alerts, due reminders" onPress={() => router.push("/settings/notifications")} />
            <SettingsRow icon="grid-outline" label="Home Cards" subtitle="Show or hide any card on the Home screen" onPress={() => router.push("/settings/home-cards" as never)} />
            <SettingsRow icon="lock-closed-outline" label="Security" subtitle="App lock with biometric authentication" onPress={() => router.push("/settings/security")} />
            <>
              <Text className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mt-4 mb-2">Theme</Text>
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mb-3">Current: {activeThemeLabel}</Text>
              <View className="flex-row">
                {THEME_OPTIONS.map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() => handleThemeChange(option.value)}
                    className={`flex-1 items-center py-3 mx-1 rounded-lg border ${theme === option.value ? "" : "border-border-light dark:border-border-dark"}`}
                    style={theme === option.value ? { borderColor: accent[500], backgroundColor: ac(accent, colorScheme, 50, 700) } : undefined}
                    >
                      <Ionicons name={option.icon} size={20} color={theme === option.value ? colors.blue : colors.textSecondary} />
                      <Text
                        className={`text-xs mt-1 ${theme === option.value ? "font-medium" : "text-text-secondary dark:text-text-dark-secondary"}`}
                        style={theme === option.value ? { color: ac(accent, colorScheme, 500, 200) } : undefined}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
            </>
          </Card>

          <Card title="About & Help" className="mb-4">
            {getFlag("v15_help_center") && (
              <SettingsRow
                icon="help-circle-outline"
                label="Help Center"
                subtitle="Ask anything in plain English"
                onPress={() => router.push("/settings/help" as never)}
              />
            )}
            <View className="flex-row items-center justify-between py-2 border-b border-border-light dark:border-border-dark">
              <Text className="text-sm" style={{ color: colors.textSecondary }}>App Name</Text>
              <View className="flex-row items-center" style={{ gap: 4 }}>
                <Text className="text-sm font-medium" style={{ color: colors.text }}>Arth ·</Text>
                <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">अर्थ</Text>
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

      {/* Account Picker Bottom Sheet */}
      <BottomSheet visible={showAccountPicker} onClose={() => setShowAccountPicker(false)}>
        <View className="px-4 pb-4">
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-lg font-semibold text-text-primary dark:text-text-dark-primary">
              Select Accounts
            </Text>
            <Pressable onPress={() => setShowAccountPicker(false)}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView className="max-h-96">
            <Pressable
              onPress={() => {
                setSmsScanAccountIds([]);
                saveSmsScanAccountIds([]);
              }}
              className={`flex-row items-center justify-between py-3 px-4 rounded-lg mb-2 border ${
                smsScanAccountIds.length === 0 ? "" : "border-border-light dark:border-border-dark"
              }`}
              style={smsScanAccountIds.length === 0
                ? { borderColor: accent[500], backgroundColor: ac(accent, colorScheme, 50, 700) }
                : undefined}
            >
              <View className="flex-1">
                <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
                  All accounts
                </Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                  Scan SMS for all accounts
                </Text>
              </View>
              <Ionicons
                name={smsScanAccountIds.length === 0 ? "checkbox" : "square-outline"}
                size={22}
                color={smsScanAccountIds.length === 0 ? accent[500] : colors.textSecondary}
              />
            </Pressable>

            {allAccounts.map((account) => {
              const isSelected = smsScanAccountIds.includes(account.id);
              return (
                <Pressable
                  key={account.id}
                  onPress={() => {
                    const newSelection = isSelected
                      ? smsScanAccountIds.filter((id) => id !== account.id)
                      : [...smsScanAccountIds, account.id];
                    setSmsScanAccountIds(newSelection);
                    saveSmsScanAccountIds(newSelection);
                  }}
                  className={`flex-row items-center justify-between py-3 px-4 rounded-lg mb-2 border ${
                    isSelected ? "" : "border-border-light dark:border-border-dark"
                  }`}
                  style={isSelected
                    ? { borderColor: accent[500], backgroundColor: ac(accent, colorScheme, 50, 700) }
                    : undefined}
                >
                  <View className="flex-1">
                    <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
                      {account.account_label || account.bank_name}
                    </Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                      {accountTypeLabel(account.account_type)} · ••••{account.account_identifier}
                    </Text>
                  </View>
                  <Ionicons
                    name={isSelected ? "checkbox" : "square-outline"}
                    size={22}
                    color={isSelected ? accent[500] : colors.textSecondary}
                  />
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={() => setShowAccountPicker(false)}
            className="flex-row items-center justify-center py-3 mt-4 rounded-lg"
            style={{ backgroundColor: accent[500] }}
          >
            <Text className="text-sm font-medium text-white">Done</Text>
          </Pressable>
        </View>
      </BottomSheet>
    </ScreenContainer>
  );
}
