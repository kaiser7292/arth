import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, DateInput, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import type { CleanupObjectType, CleanupScope, CustomDateRange } from "@/services/data-cleanup";
import { cleanupData, getCleanupPreview } from "@/services/data-cleanup";
import { formatDisplayDate as formatDateLabel } from "@/utils/date";

/**
 * Permanently delete data by time range. Moved here from a form built into the Settings tab;
 * opened from Settings -> Backup and data. Same steps and the same confirmation as before.
 */
export default function CleanUpScreen() {
  const alert = useAlert();
  const { colors } = useColorScheme();
  const uiTheme = useTheme();
  const [cleaning, setCleaning] = useState(false);
  const [cleanupScope, setCleanupScope] = useState<CleanupScope | null>(null);
  const [cleanupObjects, setCleanupObjects] = useState<Set<CleanupObjectType>>(new Set());
  const [cleanupPreview, setCleanupPreview] = useState<Record<CleanupObjectType, number> | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [cleanupCustomFrom, setCleanupCustomFrom] = useState("");
  const [cleanupCustomTo, setCleanupCustomTo] = useState("");
  const [cleanupCustomRange, setCleanupCustomRange] = useState<CustomDateRange | undefined>(undefined);
  const [cleanupDateError, setCleanupDateError] = useState<string | null>(null);

  const isValidDate = useCallback((str: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
    return !isNaN(new Date(str).getTime());
  }, []);

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
            setCleanupScope(null); setCleanupPreview(null);
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

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Card className="mb-3">
          <View className="flex-row items-start">
            <Ionicons name="warning-outline" size={18} color={uiTheme.danger} />
            <Text className="text-xs text-muted-foreground ml-2 flex-1">
              This deletes for good, not to the recycle bin. Make a backup first if you might want any of it back.
            </Text>
          </View>
        </Card>
        {cleaning ? (
          <View className="items-center py-10"><ActivityIndicator color={uiTheme.danger} /></View>
        ) : (
          <Card>
            <View>
              <Text className="text-xs font-semibold text-faint-foreground uppercase tracking-wider mb-2 mt-1">1. Time Range</Text>
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
                    className={`px-3 py-1.5 rounded-full border ${cleanupScope === option.scope ? "bg-danger/8" : "border-border"}`}
                    style={cleanupScope === option.scope ? { borderColor: uiTheme.danger } : undefined}
                  >
                    <Text className={`text-xs font-medium ${cleanupScope === option.scope ? "text-danger" : "text-foreground"}`}>
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
                  <Pressable onPress={handleCleanupCustomApply} className="py-2 rounded-lg items-center" style={{ backgroundColor: uiTheme.danger }}>
                    <Text className="text-sm font-medium text-white">Apply Range</Text>
                  </Pressable>
                  {cleanupCustomRange && (
                    <Text className="text-xs text-muted-foreground mt-1.5 text-center">
                      {formatDateLabel(cleanupCustomRange.startDate)} - {formatDateLabel(cleanupCustomRange.endDate)}
                    </Text>
                  )}
                </View>
              )}

              {cleanupScope && (cleanupScope !== "custom" || cleanupCustomRange) && (
                <>
                  <Text className="text-xs font-semibold text-faint-foreground uppercase tracking-wider mb-2">2. What to Delete</Text>
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
                        className={`flex-row items-center justify-between rounded-lg px-3 py-2.5 mb-1.5 border ${checked ? "border-danger/30 bg-danger/3" : "border-border"}`}
                      >
                        <View className="flex-row items-center flex-1">
                          <Ionicons name={checked ? "checkbox" : "square-outline"} size={20} color={checked ? uiTheme.danger : colors.textSecondary} />
                          <Ionicons name={item.icon} size={16} color={colors.textSecondary} style={{ marginLeft: 8 }} />
                          <Text className="text-sm text-foreground ml-2">{item.label}</Text>
                        </View>
                        {loadingPreview ? (
                          <ActivityIndicator size="small" color={colors.textSecondary} />
                        ) : (
                          <Text className={`text-xs font-medium ${count > 0 ? "text-danger" : "text-faint-foreground"}`}>{count}</Text>
                        )}
                      </Pressable>
                    );
                  })}
                  <Pressable
                    onPress={executeCleanup}
                    disabled={cleanupObjects.size === 0}
                    className="flex-row items-center justify-center py-2.5 mt-1 rounded-lg"
                    style={{ backgroundColor: cleanupObjects.size === 0 ? "#9CA3AF40" : uiTheme.danger }}
                  >
                    <Ionicons name="trash-outline" size={16} color="#FFFFFF" />
                    <Text className="text-sm font-semibold text-white ml-2">Delete Selected</Text>
                  </Pressable>
                </>
              )}
            </View>
          </Card>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
