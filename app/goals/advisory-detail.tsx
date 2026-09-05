import { ScreenContainer, Text } from "@/components/ui";

import { Card } from "@/components/ui/Card";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { formatAmount } from "@/utils/format";
import { formatCompact } from "@/utils/format";
import type {
  Advisory,
  BucketStatus,
  MilestoneStatus,
} from "@/utils/financial-cockpit";
import type { FinancialCockpitData } from "@/services/financial-cockpit";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { ScrollView, View, Pressable } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { BRAND_COLOR, STATUS_COLORS } from "@/constants/semantic-colors";

const SEVERITY_COLORS = {
  critical: { border: STATUS_COLORS.error, bg: "#FEF2F2", bgDark: "#3B0000", text: "#991B1B", textDark: "#FCA5A5", icon: "warning-outline" as const },
  warning:  { border: STATUS_COLORS.warning, bg: "#FEF9E7", bgDark: "#332B00", text: "#92400E", textDark: "#FBBF24", icon: "alert-circle-outline" as const },
  info:     { border: BRAND_COLOR, bg: "#EFF6FF", bgDark: "#1E293B", text: BRAND_COLOR, textDark: "#93C5FD", icon: "information-circle-outline" as const },
  celebrate:{ border: STATUS_COLORS.success, bg: "#F0FDF4", bgDark: "#052E16", text: "#166534", textDark: "#86EFAC", icon: "sparkles-outline" as const },
};

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <View className="h-1.5 rounded-full bg-border overflow-hidden mt-1.5">
      <View
        className="h-full rounded-full"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: color }}
      />
    </View>
  );
}

function StatRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  const theme = useTheme();
  return (
    <View className="flex-row items-center justify-between py-2 border-b border-border">
      <Text className="text-sm text-muted-foreground flex-1">{label}</Text>
      <Text
        className="text-sm font-semibold ml-4 text-foreground"
        style={highlight ? { color: theme.danger } : undefined}
      >
        {value}
      </Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground mb-2 mt-4">
      {title}
    </Text>
  );
}

function ActionButton({ label, icon, onPress, color }: { label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; color: string }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-between px-4 py-3.5 rounded-xl"
      style={{ backgroundColor: color + "14" }}
    >
      <View className="flex-row items-center">
        <Ionicons name={icon} size={18} color={color} style={{ marginRight: 10 }} />
        <Text className="text-sm font-medium" style={{ color }}>{label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={color} />
    </Pressable>
  );
}

// ── Spending detail ──────────────────────────────────────────────────────────

function SpendingDetail({
  cockpit,
  isDark,
}: {
  cockpit: FinancialCockpitData;
  isDark: boolean;
}) {
  const theme = useTheme();
  const { tension, buckets } = cockpit;
  const behindBuckets = buckets.filter((b) => b.paceStatus === "behind");
  const router = useRouter();

  const monthlyOverspend = tension.overspendAnnualized / 12;
  const isOverspending = tension.overspendAnnualized > 0;

  return (
    <>
      <SectionHeader title="Spending vs Budget" />
      <Card className="mb-4">
        <StatRow label="Annual budget" value={formatAmount(tension.spendingBudgeted)} />
        <StatRow label="Projected annual spend" value={formatAmount(tension.spendingPaceAnnualized)} highlight={isOverspending} />
        <StatRow
          label="Projected overspend"
          value={isOverspending ? `+${formatAmount(tension.overspendAnnualized)}` : "On track"}
          highlight={isOverspending}
        />
        {isOverspending && (
          <StatRow label="Monthly overspend" value={`+${formatAmount(monthlyOverspend)}/mo`} highlight />
        )}
      </Card>

      {behindBuckets.length > 0 && (
        <>
          <SectionHeader title="Goals at Risk" />
          {behindBuckets.map((b) => (
            <BucketRow key={b.id} bucket={b} isDark={isDark} />
          ))}
        </>
      )}

      {tension.discretionaryCutNeeded > 0 && (
        <>
          <SectionHeader title="Course Correction" />
          <Card className="mb-4">
            <Text className="text-sm text-muted-foreground mb-2">
              To protect your investment goals for the rest of this FY, reduce monthly discretionary spending by:
            </Text>
            <Text className="text-2xl font-bold text-danger">
              -{formatAmount(tension.discretionaryCutNeeded)}/mo
            </Text>
            <Text className="text-xs text-faint-foreground mt-1">
              Discretionary spend YTD: {formatAmount(tension.discretionarySpendYTD)}
            </Text>
          </Card>
        </>
      )}

      <ActionButton
        label="View Yearly Plan"
        icon="document-text-outline"
        onPress={() => router.push("/goals/yearly-plan")}
        color={theme.danger}
      />
    </>
  );
}

// ── Investment detail ────────────────────────────────────────────────────────

function BucketRow({ bucket, isDark }: { bucket: BucketStatus; isDark: boolean }) {
  const theme = useTheme();
  const accentColor = bucket.paceStatus === "behind" ? theme.warning : theme.success;
  return (
    <Card className="mb-3">
      <View className="flex-row items-center justify-between mb-1.5">
        <Text className="text-sm font-semibold text-foreground flex-1 mr-2" numberOfLines={1}>
          {bucket.name}
        </Text>
        <Text className="text-xs font-medium" style={{ color: accentColor }}>
          {Math.round(bucket.progressPct)}%
        </Text>
      </View>
      <ProgressBar pct={bucket.progressPct} color={accentColor} />
      <View className="flex-row justify-between mt-2">
        <Text className="text-xs text-muted-foreground">
          {formatCompact(bucket.contributed)} saved
        </Text>
        <Text className="text-xs text-muted-foreground">
          {formatCompact(bucket.annualTarget)} target
        </Text>
      </View>
      {bucket.paceStatus === "behind" && bucket.monthlyRequired > 0 && (
        <View className="mt-2 pt-2 border-t border-border">
          <Text className="text-xs text-muted-foreground">
            Top-up needed:{" "}
            <Text className="font-semibold text-foreground">
              {formatAmount(bucket.monthlyRequired)}/mo
            </Text>
          </Text>
        </View>
      )}
    </Card>
  );
}

function InvestmentDetail({
  cockpit,
  isDark,
}: {
  cockpit: FinancialCockpitData;
  isDark: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const behindBuckets = cockpit.buckets.filter((b) => b.paceStatus === "behind");
  const totalShortfall = behindBuckets.reduce((s, b) => s + b.remainingTarget, 0);
  const monthsRemaining = 12 - cockpit.fiscalMonth;

  return (
    <>
      <SectionHeader title="Summary" />
      <Card className="mb-4">
        <StatRow label="Buckets behind schedule" value={String(behindBuckets.length)} />
        <StatRow label="Total shortfall" value={formatAmount(totalShortfall)} highlight />
        {monthsRemaining > 0 && (
          <StatRow
            label="Monthly catch-up needed"
            value={`${formatAmount(totalShortfall / monthsRemaining)}/mo`}
            highlight
          />
        )}
      </Card>

      <SectionHeader title="Behind Schedule" />
      {behindBuckets.map((b) => (
        <BucketRow key={b.id} bucket={b} isDark={isDark} />
      ))}

      <ActionButton
        label="View Investment Buckets"
        icon="pie-chart-outline"
        onPress={() => router.push("/goals/investment-buckets")}
        color={theme.warning}
      />
    </>
  );
}

// ── Milestone detail ─────────────────────────────────────────────────────────

function MilestoneDetail({
  advisory,
  cockpit,
}: {
  advisory: Advisory;
  cockpit: FinancialCockpitData;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { colors } = useColorScheme();

  const ms: MilestoneStatus | undefined = advisory.relatedGoalId
    ? cockpit.milestones.find((m) => m.id === advisory.relatedGoalId)
    : undefined;

  if (!ms) {
    return (
      <Card className="mb-4">
        <Text className="text-sm text-muted-foreground">
          Milestone details not available.
        </Text>
      </Card>
    );
  }

  const accentColor = ms.status === "completed" ? theme.success : ms.slippageMonths > 6 ? theme.danger : theme.warning;
  const remaining = Math.max(0, ms.targetAmount - ms.currentSaved);

  return (
    <>
      <SectionHeader title="Milestone Status" />
      <Card className="mb-4">
        <View className="flex-row items-center justify-between mb-1.5">
          <Text className="text-sm font-semibold text-foreground flex-1 mr-2">
            {ms.name}
          </Text>
          <Text className="text-sm font-bold" style={{ color: accentColor }}>
            {Math.round(ms.progressPct)}%
          </Text>
        </View>
        <ProgressBar pct={ms.progressPct} color={accentColor} />
        <View className="flex-row justify-between mt-2 mb-3">
          <Text className="text-xs text-muted-foreground">
            {formatCompact(ms.currentSaved)} saved
          </Text>
          <Text className="text-xs text-muted-foreground">
            {formatCompact(ms.targetAmount)} goal
          </Text>
        </View>
        <StatRow label="Remaining" value={formatAmount(remaining)} highlight={remaining > 0} />
        {ms.targetDate && (
          <StatRow label="Target date" value={ms.targetDate} />
        )}
        {ms.realisticCompletionDate && (
          <StatRow
            label="Projected completion"
            value={ms.realisticCompletionDate}
            highlight={ms.slippageMonths > 0}
          />
        )}
        {ms.slippageMonths > 0 && (
          <StatRow
            label="Projected slippage"
            value={`${ms.slippageMonths} month${ms.slippageMonths > 1 ? "s" : ""}`}
            highlight
          />
        )}
      </Card>

      <SectionHeader title="Monthly Contribution" />
      <Card className="mb-4">
        <StatRow label="Current monthly pace" value={ms.monthlyRealistic > 0 ? `${formatAmount(ms.monthlyRealistic)}/mo` : "None"} />
        <StatRow
          label="Needed to meet target date"
          value={ms.monthlyPlanned > 0 ? `${formatAmount(ms.monthlyPlanned)}/mo` : "-"}
          highlight={ms.monthlyPlanned > ms.monthlyRealistic}
        />
        {ms.monthlyPlanned > ms.monthlyRealistic && (
          <View className="mt-2 pt-2 border-t border-border">
            <Text className="text-xs text-muted-foreground">
              Increase by{" "}
              <Text className="font-semibold text-danger">
                {formatAmount(ms.monthlyPlanned - ms.monthlyRealistic)}/mo
              </Text>{" "}
              to stay on track.
            </Text>
          </View>
        )}
      </Card>

      {ms.linkedBucketNames.length > 0 && (
        <>
          <SectionHeader title="Linked Investment Buckets" />
          <Card className="mb-4">
            {ms.linkedBucketNames.map((name, i) => (
              <View
                key={i}
                className="flex-row items-center py-2 border-b border-border"
              >
                <Ionicons name="link-outline" size={14} color={colors.textSecondary} style={{ marginRight: 8 }} />
                <Text className="text-sm text-foreground">{name}</Text>
              </View>
            ))}
          </Card>
        </>
      )}

      <ActionButton
        label="Open Milestone"
        icon="flag-outline"
        onPress={() => router.push({ pathname: "/goals/milestone-detail", params: { id: ms.id } })}
        color={accentColor}
      />
    </>
  );
}

// ── Savings detail ───────────────────────────────────────────────────────────

function SavingsDetail({
  cockpit,
}: {
  cockpit: FinancialCockpitData;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { savings } = cockpit;
  const gap = savings.targetRatePct - savings.actualRatePct;
  const monthlyGap = savings.courseCorrectionPerMonth;

  return (
    <>
      <SectionHeader title="Savings Rate" />
      <Card className="mb-4">
        <StatRow label="Target savings rate" value={`${savings.targetRatePct.toFixed(1)}%`} />
        <StatRow
          label="Actual savings rate"
          value={`${savings.actualRatePct.toFixed(1)}%`}
          highlight={gap > 5}
        />
        <StatRow label="Gap" value={`${gap.toFixed(1)}%`} highlight={gap > 5} />
      </Card>

      <SectionHeader title="What This Means" />
      <Card className="mb-4">
        <StatRow label="Total saved YTD" value={formatAmount(savings.totalSaved)} />
        <StatRow label="Target savings for FY" value={formatAmount(savings.targetSavings)} />
        {monthlyGap > 0 && (
          <View className="mt-3 pt-2 border-t border-border">
            <Text className="text-sm text-muted-foreground">
              To close the gap, save an additional{" "}
              <Text className="font-semibold text-danger">
                {formatAmount(monthlyGap)}/mo
              </Text>{" "}
              for the rest of the year.
            </Text>
          </View>
        )}
      </Card>

      <ActionButton
        label="View Yearly Plan"
        icon="document-text-outline"
        onPress={() => router.push("/goals/yearly-plan")}
        color={theme.primary}
      />
    </>
  );
}

// ── General (celebrate) detail ───────────────────────────────────────────────

function GeneralDetail({
  cockpit,
}: {
  cockpit: FinancialCockpitData;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { tension, savings, buckets } = cockpit;

  const aheadBuckets = buckets.filter((b) => b.paceStatus === "ahead");
  const onTrackBuckets = buckets.filter((b) => b.paceStatus === "on_track");

  return (
    <>
      <SectionHeader title="Financial Health" />
      <Card className="mb-4">
        <StatRow label="Monthly breathing room" value={`${formatAmount(tension.spendingBudgeted > 0 ? Math.max(0, (tension.spendingBudgeted - tension.spendingPaceAnnualized) / 12) : 0)}/mo`} />
        <StatRow label="Savings rate" value={`${savings.actualRatePct.toFixed(1)}%`} />
        <StatRow label="Savings rate target" value={`${savings.targetRatePct.toFixed(1)}%`} />
      </Card>

      {aheadBuckets.length > 0 && (
        <>
          <SectionHeader title="Ahead of Schedule" />
          {aheadBuckets.map((b) => (
            <BucketRow key={b.id} bucket={b} isDark={false} />
          ))}
        </>
      )}

      {onTrackBuckets.length > 0 && aheadBuckets.length === 0 && (
        <>
          <SectionHeader title="On Track" />
          {onTrackBuckets.slice(0, 3).map((b) => (
            <BucketRow key={b.id} bucket={b} isDark={false} />
          ))}
        </>
      )}

      <SectionHeader title="Ideas for Surplus" />
      <Card className="mb-4">
        {[
          "Top up your investment buckets early",
          "Accelerate a life milestone",
          "Build an emergency fund buffer",
          "Make a loan prepayment to save on interest",
        ].map((idea, i) => (
          <View key={i} className="flex-row items-start py-2 border-b border-border">
            <Text className="text-success mr-2 mt-0.5">-</Text>
            <Text className="text-sm text-foreground flex-1">{idea}</Text>
          </View>
        ))}
      </Card>

      <ActionButton
        label="View Investment Buckets"
        icon="pie-chart-outline"
        onPress={() => router.push("/goals/investment-buckets")}
        color={theme.success}
      />
    </>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function AdvisoryDetailScreen() {
  const { advisoryJson, cockpitJson } = useLocalSearchParams<{ advisoryJson: string; cockpitJson: string }>();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  const advisory: Advisory | null = (() => {
    try { return JSON.parse(advisoryJson ?? "null"); } catch { return null; }
  })();

  const cockpitData: FinancialCockpitData | null = (() => {
    try { return JSON.parse(cockpitJson ?? "null"); } catch { return null; }
  })();

  if (!advisory) {
    return (
      <ScreenContainer padTop={false}>
        <Stack.Screen options={{ title: "Advisory" }} />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-base text-muted-foreground text-center">
            Advisory data not available.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  const sc = SEVERITY_COLORS[advisory.severity];

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen
        options={{
          title: "Advisory",
          headerStyle: { backgroundColor: isDark ? "#111111" : "#FFFFFF" },
          headerTintColor: isDark ? "#FFFFFF" : "#1A1A1A",
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: "700", fontSize: 18 },
        }}
      />
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        {/* Header card */}
        <View
          className="rounded-xl overflow-hidden mb-4"
          style={{
            backgroundColor: isDark ? sc.bgDark : sc.bg,
            borderLeftWidth: 4,
            borderLeftColor: sc.border,
          }}
        >
          <View className="px-4 py-4">
            <View className="flex-row items-center mb-2">
              <Ionicons name={sc.icon} size={20} color={sc.border} style={{ marginRight: 8 }} />
              <Text
                className="text-base font-bold flex-1"
                style={{ color: isDark ? sc.textDark : sc.text }}
              >
                {advisory.title}
              </Text>
            </View>
            <Text
              className="text-sm"
              style={{ color: isDark ? sc.textDark : sc.text, opacity: 0.9 }}
            >
              {advisory.message}
            </Text>
          </View>
        </View>

        {/* Detail body */}
        {!cockpitData && (
          <View className="items-center py-8">
            <Text className="text-sm text-muted-foreground">
              Details not available.
            </Text>
          </View>
        )}

        {cockpitData && (
          <>
            {advisory.category === "spending" && (
              <SpendingDetail cockpit={cockpitData} isDark={isDark} />
            )}
            {advisory.category === "investment" && (
              <InvestmentDetail cockpit={cockpitData} isDark={isDark} />
            )}
            {advisory.category === "milestone" && (
              <MilestoneDetail advisory={advisory} cockpit={cockpitData} />
            )}
            {advisory.category === "savings" && (
              <SavingsDetail cockpit={cockpitData} />
            )}
            {advisory.category === "general" && (
              <GeneralDetail cockpit={cockpitData} />
            )}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
