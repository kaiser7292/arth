import { useState, useCallback } from "react";
import { View, Text, Pressable, ScrollView, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card, FAB, LoadingState } from "@/components/ui";
import { PolicySheet } from "@/components/insurance/PolicySheet";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { DEFAULT_USER_ID } from "@/constants/app";
import { StatusColors } from "@/constants/theme";
import {
  getAllPolicies,
  getInsuranceAdequacy,
  type InsurancePolicy,
  type InsuranceAdequacy,
  type PolicyType,
} from "@/services/insurance-policy";
import { getSalaryProfileByFY } from "@/services/salary-profile";
import { formatAmount } from "@/utils/format";
import { ac } from "@/utils/accent";

const TYPE_META: Record<PolicyType, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  term: { icon: "shield-checkmark-outline", label: "Term Life" },
  health: { icon: "medkit-outline", label: "Health" },
  home: { icon: "home-outline", label: "Home" },
  car: { icon: "car-outline", label: "Car" },
  life: { icon: "heart-outline", label: "Life / Endowment" },
  other: { icon: "document-text-outline", label: "Other" },
};

function getCurrentFY(): string {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${String(y + 1).slice(2)}`;
}

export default function RiskCoverageScreen() {
  const { colors, accent, colorScheme } = useColorScheme();
  const status = StatusColors[colorScheme];

  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [adequacy, setAdequacy] = useState<InsuranceAdequacy | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editPolicy, setEditPolicy] = useState<InsurancePolicy | null>(null);

  const load = useCallback(async () => {
    const [pols, salary] = await Promise.all([
      getAllPolicies(DEFAULT_USER_ID),
      getSalaryProfileByFY(DEFAULT_USER_ID, getCurrentFY()),
    ]);
    setPolicies(pols);

    const monthlyIncome = salary?.manual_monthly_in_hand || salary?.computed_monthly_in_hand || 0;
    const annualIncome = monthlyIncome * 12;
    const adeq = await getInsuranceAdequacy(DEFAULT_USER_ID, annualIncome);
    setAdequacy(adeq);
    setLoaded(true);
  }, []);

  useDataRefresh(load);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleAdd = () => {
    setEditPolicy(null);
    setSheetVisible(true);
  };

  const handleEdit = (p: InsurancePolicy) => {
    setEditPolicy(p);
    setSheetVisible(true);
  };

  const handleSaved = () => {
    setSheetVisible(false);
    setEditPolicy(null);
    load();
  };

  if (!loaded) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Loading policies…" icon="shield-checkmark-outline" />
      </ScreenContainer>
    );
  }

  // Group policies by type
  const grouped = new Map<PolicyType, InsurancePolicy[]>();
  for (const p of policies) {
    const list = grouped.get(p.policy_type) ?? [];
    list.push(p);
    grouped.set(p.policy_type, list);
  }

  const typeOrder: PolicyType[] = ["term", "health", "home", "car", "life", "other"];
  const activePolicies = policies.filter((p) => p.is_active);
  const totalPremium = activePolicies.reduce((s, p) => s + p.annual_premium, 0);

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ac(accent, colorScheme, 500, 400)} />}
      >
        {/* Summary card */}
        {adequacy && (
          <View className="px-4 pt-2 mb-3">
            <Card>
              <View className="flex-row items-center justify-between mb-3">
                <View>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary uppercase tracking-wider mb-0.5">
                    Coverage Score
                  </Text>
                  <Text
                    className="text-2xl font-bold"
                    style={{
                      color:
                        adequacy.coveredCount >= adequacy.totalRelevant
                          ? status.success
                          : adequacy.coveredCount > 0
                            ? status.warning
                            : status.danger,
                    }}
                  >
                    {adequacy.coveredCount}/{adequacy.totalRelevant}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                    Total annual premium
                  </Text>
                  <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                    {formatAmount(totalPremium)}
                  </Text>
                </View>
              </View>

              {/* Adequacy badges */}
              <View className="flex-row flex-wrap gap-2">
                {adequacy.term ? (
                  <Badge
                    label={`Term ${adequacy.term.isAdequate ? "✓" : `${Math.round(adequacy.term.ratio)}×`}`}
                    ok={adequacy.term.isAdequate}
                    status={status}
                  />
                ) : (
                  <Badge label="Term ✗" ok={false} status={status} />
                )}
                {adequacy.health ? (
                  <Badge
                    label={`Health ${adequacy.health.isAdequate ? "✓" : "Low"}`}
                    ok={adequacy.health.isAdequate}
                    status={status}
                  />
                ) : (
                  <Badge label="Health ✗" ok={false} status={status} />
                )}
                <Badge label={`Car ${adequacy.car.hasActive ? "✓" : "✗"}`} ok={adequacy.car.hasActive} status={status} />
              </View>

              {/* Gaps */}
              {adequacy.gaps.length > 0 && (
                <View className="mt-3 pt-2 border-t border-border-light dark:border-border-dark">
                  {adequacy.gaps.map((g) => (
                    <View key={g} className="flex-row items-start gap-1.5 mb-1">
                      <Ionicons name="alert-circle" size={13} color={status.warning} style={{ marginTop: 1 }} />
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary flex-1">
                        {g}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </Card>
          </View>
        )}

        {/* Policy list grouped by type */}
        {policies.length === 0 ? (
          <View className="items-center justify-center py-16 px-8">
            <Ionicons name="shield-outline" size={48} color={colors.textSecondary} />
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary text-center mt-3">
              No insurance policies added yet
            </Text>
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary text-center mt-1 opacity-60">
              Track your policies to get better retirement and health assessments
            </Text>
          </View>
        ) : (
          typeOrder
            .filter((t) => grouped.has(t))
            .map((type) => {
              const group = grouped.get(type)!;
              const meta = TYPE_META[type];
              const groupSum = group.reduce((s, p) => s + p.sum_insured, 0);
              return (
                <View key={type} className="px-4 mb-3">
                  <View className="flex-row items-center gap-2 mb-1.5">
                    <Ionicons name={meta.icon} size={14} color={colors.textSecondary} />
                    <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary uppercase tracking-wider flex-1">
                      {meta.label}
                    </Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                      {formatAmount(groupSum)} cover
                    </Text>
                  </View>
                  <Card>
                    {group.map((p, i) => (
                      <Pressable
                        key={p.id}
                        onPress={() => handleEdit(p)}
                        className={`flex-row items-center py-2.5 ${
                          i < group.length - 1 ? "border-b border-border-light dark:border-border-dark" : ""
                        }`}
                      >
                        <View className="flex-1">
                          <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
                            {p.provider_name}
                          </Text>
                          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                            {formatAmount(p.sum_insured)} cover
                            {p.annual_premium > 0 ? ` · ${formatAmount(p.annual_premium)}/yr` : ""}
                            {p.expiry_date ? ` · Exp ${formatShortDate(p.expiry_date)}` : ""}
                          </Text>
                        </View>
                        <View className="flex-row items-center gap-1.5">
                          {!p.is_active && (
                            <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: status.dangerBg }}>
                              <Text className="text-xs" style={{ color: status.danger }}>Lapsed</Text>
                            </View>
                          )}
                          <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
                        </View>
                      </Pressable>
                    ))}
                  </Card>
                </View>
              );
            })
        )}
      </ScrollView>

      <FAB icon="add" onPress={handleAdd} accessibilityLabel="Add policy" />

      <PolicySheet
        visible={sheetVisible}
        onClose={() => { setSheetVisible(false); setEditPolicy(null); }}
        onSaved={handleSaved}
        policy={editPolicy}
      />
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function Badge({ label, ok, status }: { label: string; ok: boolean; status: { success: string; successBg: string; danger: string; dangerBg: string } }) {
  return (
    <View
      className="px-2.5 py-1 rounded-full"
      style={{ backgroundColor: ok ? status.successBg : status.dangerBg }}
    >
      <Text className="text-xs font-medium" style={{ color: ok ? status.success : status.danger }}>
        {label}
      </Text>
    </View>
  );
}

function formatShortDate(ymd: string): string {
  if (!ymd) return "";
  try {
    const d = new Date(ymd + "T00:00:00");
    return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
  } catch {
    return ymd;
  }
}
