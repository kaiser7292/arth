import { Card, LoadingState, ScreenContainer } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { StatusColors } from "@/constants/theme";
import { useCockpitData } from "@/hooks/use-cockpit-data";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getMilestonesForFY } from "@/services/life-milestone";
import { getSalaryProfileByFY } from "@/services/salary-profile";
import { getFYStartMonth } from "@/services/settings";
import { getBucketsByFY } from "@/services/yearly-plan";
import { ac } from "@/utils/accent";
import { getCurrentFY, getFYLabel } from "@/utils/fiscal-year";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import {
    AdvisoryCard,
    SavingsPulse,
} from "@/components/cockpit";

export default function GoalsScreen() {
  const router = useRouter();
  const { accent, colors, colorScheme } = useColorScheme();
  const startMonth = getFYStartMonth();
  const currentFY = getCurrentFY(startMonth);
  const fyLabel = getFYLabel(currentFY, startMonth);

  // Guided setup state
  const [hasSalaryProfile, setHasSalaryProfile] = useState(false);
  const [hasFYBuckets, setHasFYBuckets] = useState(false);
  const [hasMilestones, setHasMilestones] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadGoals = useCallback(async () => {
    try {
      const fyStr = String(currentFY);
      const [salary, fyBuckets, fyMilestones] = await Promise.all([
        getSalaryProfileByFY(DEFAULT_USER_ID, fyStr),
        getBucketsByFY(DEFAULT_USER_ID, fyStr),
        getMilestonesForFY(DEFAULT_USER_ID, fyStr),
      ]);
      setHasSalaryProfile(salary != null && salary.computed_monthly_in_hand > 0);
      setHasFYBuckets(fyBuckets.length > 0);
      setHasMilestones(fyMilestones.length > 0);
    } catch {
      // DB not ready
    }
    setSetupChecked(true);
  }, [currentFY]);

  useFocusEffect(
    useCallback(() => {
      loadGoals();
    }, [loadGoals]),
  );

  const cockpit = useCockpitData();
  const setupComplete = hasSalaryProfile && hasFYBuckets && hasMilestones;
  const hasCockpit = cockpit.data != null;

  const setupSteps = [
    { label: "Set your income", done: hasSalaryProfile, route: "/goals/salary-calculator" as const, icon: "calculator-outline" as keyof typeof Ionicons.glyphMap },
    { label: "Add investment goals", done: hasFYBuckets, route: "/goals/investment-buckets" as const, icon: "pie-chart-outline" as keyof typeof Ionicons.glyphMap },
    { label: "Add life goals", done: hasMilestones, route: "/goals/milestones" as const, icon: "flag-outline" as keyof typeof Ionicons.glyphMap },
  ];

  if (!setupChecked || cockpit.loading) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Loading goals..." icon="trophy-outline" />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await loadGoals();
              setRefreshing(false);
            }}
          />
        }
      >
        <View className="px-4 py-4">

          {/* ── Guided Setup (new users) ── */}
          {!setupComplete && (
            <Card title="Set up your plan" className="mb-4">
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-3">
                Complete these steps to auto-generate your {fyLabel} plan.
              </Text>
              {setupSteps.map((step, idx) => (
                <Pressable
                  key={idx}
                  onPress={() => router.push({ pathname: step.route, params: { fy: String(currentFY) } })}
                  className="flex-row items-center py-2.5 border-b border-border-light dark:border-border-dark"
                >
                  <View
                    className="w-9 h-9 rounded-full items-center justify-center mr-3"
                    style={{ backgroundColor: step.done ? "#22C55E14" : "#9CA3AF14" }}
                  >
                    <Ionicons
                      name={step.done ? "checkmark-circle" : step.icon}
                      size={18}
                      color={step.done ? StatusColors[colorScheme].success : "#9CA3AF"}
                    />
                  </View>
                  <Text
                    className="flex-1 text-sm"
                    style={{ color: step.done ? StatusColors[colorScheme].success : undefined }}
                  >
                    <Text className={step.done ? "line-through text-text-secondary dark:text-text-dark-secondary" : "text-text-primary dark:text-text-dark-primary font-medium"}>
                      {step.label}
                    </Text>
                  </Text>
                  {!step.done && (
                    <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                  )}
                </Pressable>
              ))}
            </Card>
          )}

          {/* ── Financial Cockpit (when data exists) ── */}
          {hasCockpit && cockpit.data && (
            <>
              {/* FY label */}
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-2">
                {cockpit.data.fyLabel} - Month {cockpit.data.fiscalMonth} of 12
              </Text>

              {/* Savings Pulse */}
              <Pressable
                onPress={() => router.push({ pathname: "/goals/yearly-plan", params: { fy: String(currentFY) } })}
              >
                <Card title="Savings Rate" className="mb-4">
                  <SavingsPulse data={cockpit.data.savings} />
                </Card>
              </Pressable>

              {/* Course Correction Advisor */}
              {cockpit.data.advisories.length > 0 && (
                <View className="mb-4">
                  <Text className="text-xs font-semibold tracking-wider uppercase text-text-secondary dark:text-text-dark-secondary mb-2">
                    Advisories
                  </Text>
                  {cockpit.data.advisories.slice(0, 3).map((adv) => (
                    <AdvisoryCard
                      key={adv.id}
                      advisory={adv}
                      onPress={() =>
                        router.push({
                          pathname: "/goals/advisory-detail",
                          params: { advisoryJson: JSON.stringify(adv) },
                        })
                      }
                    />
                  ))}
                </View>
              )}
            </>
          )}

          {/* ── No cockpit data but setup complete → show placeholder ── */}
          {!hasCockpit && setupComplete && (
            <Card className="mb-4">
              <View className="items-center py-6">
                <Ionicons name="analytics-outline" size={48} color={colorScheme === 'dark' ? '#A0A0A0' : '#6B7280'} />
                <Text className="text-lg font-medium text-text-primary dark:text-text-dark-primary mt-3">
                  Building your cockpit...
                </Text>
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary text-center mt-1">
                  Add some expenses and investment contributions to see your financial story.
                </Text>
              </View>
            </Card>
          )}

          {/* Quick Actions */}
          <Text className="text-xs font-semibold tracking-wider uppercase text-text-secondary dark:text-text-dark-secondary mb-2">
            Quick Actions
          </Text>

          <Pressable
            onPress={() => router.push({ pathname: "/goals/yearly-plan", params: { fy: String(currentFY) } })}
            className="mb-2"
          >
            <Card className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <View className="w-9 h-9 rounded-full items-center justify-center mr-3" style={{ backgroundColor: colors.blue + "14" }}>
                  <Ionicons name="document-text-outline" size={18} color={colors.blue} />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">Yearly Plan</Text>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">{fyLabel} plan details</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Card>
          </Pressable>

          <Pressable
            onPress={() => router.push({ pathname: "/goals/investment-buckets", params: { fy: String(currentFY) } })}
            className="mb-2"
          >
            <Card className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <View className="w-9 h-9 rounded-full items-center justify-center mr-3" style={{ backgroundColor: colors.blue + "14" }}>
                  <Ionicons name="pie-chart-outline" size={18} color={colors.blue} />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">Investment Buckets</Text>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Track allocations</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Card>
          </Pressable>

          <Pressable onPress={() => router.push("/goals/milestones")} className="mb-2">
            <Card className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <View className="w-9 h-9 rounded-full items-center justify-center mr-3" style={{ backgroundColor: ac(accent, colorScheme, 500, 700) + "14" }}>
                  <Ionicons name="flag-outline" size={18} color={ac(accent, colorScheme, 500, 700)} />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">Life Milestones</Text>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Big life goals</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Card>
          </Pressable>

          <Pressable onPress={() => router.push("/goals/salary-calculator")} className="mb-2">
            <Card className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <View className="w-9 h-9 rounded-full items-center justify-center mr-3" style={{ backgroundColor: StatusColors[colorScheme].successBg }}>
                  <Ionicons name="calculator-outline" size={18} color={StatusColors[colorScheme].success} />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">Income Calculator</Text>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">CTC, tax & capital gains</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Card>
          </Pressable>

          <Pressable onPress={() => router.push("/goals/yoy-comparison")} className="mb-2">
            <Card className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <View className="w-9 h-9 rounded-full items-center justify-center mr-3" style={{ backgroundColor: "#F59E0B14" }}>
                  <Ionicons name="git-compare-outline" size={18} color="#F59E0B" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">Year-over-Year</Text>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Compare FY performance</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Card>
          </Pressable>

          <Pressable onPress={() => router.push("/goals/balance-sheet" as never)} className="mb-2">
            <Card className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <View className="w-9 h-9 rounded-full items-center justify-center mr-3" style={{ backgroundColor: "#14B8A614" }}>
                  <Ionicons name="scale-outline" size={18} color="#14B8A6" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">Balance Sheet</Text>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Assets, liabilities & net worth over time</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Card>
          </Pressable>

          {/* v17.4.0 — Loans moved from Home card to Goals */}
          <Pressable onPress={() => router.push("/goals/loans" as never)} className="mb-2">
            <Card className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <View className="w-9 h-9 rounded-full items-center justify-center mr-3" style={{ backgroundColor: "#F5945C14" }}>
                  <Ionicons name="cash-outline" size={18} color="#F5945C" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">Loans & Debt</Text>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">EMIs, amortization schedule, prepayments</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Card>
          </Pressable>

        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
