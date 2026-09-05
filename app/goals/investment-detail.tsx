import { Button, Card, DateInput, FAB, Input, LoadingState, MetricRow, ScreenContainer, Text } from "@/components/ui";

import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
    getLinksForBucketEnriched,
    type ExpenseInvestmentLink,
} from "@/services/expense-investment-link";
import { V15_FLAGS } from "@/services/feature-flags";
import { getLifeMilestoneById } from "@/services/life-milestone";
import type {
    InvestmentBucket,
    InvestmentContribution,
} from "@/services/yearly-plan";
import {
    createInvestmentContribution,
    deleteInvestmentContribution,
    getInvestmentBucketById,
    getInvestmentContributions,
    updateInvestmentContribution,
} from "@/services/yearly-plan";

import { formatAmount } from "@/utils/expense-validation";
import { formatLocalDate } from "@/utils/fiscal-year";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";

export default function InvestmentDetailScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const { bucketId } = useLocalSearchParams<{ bucketId: string }>();

  const [bucket, setBucket] = useState<InvestmentBucket | null>(null);
  const [contributions, setContributions] = useState<
    InvestmentContribution[]
  >([]);
  const [linkedMilestoneName, setLinkedMilestoneName] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingContrib, setEditingContrib] = useState<string | null>(null);

  // Form state
  const [contribAmount, setContribAmount] = useState("");
  const [contribDate, setContribDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [contribNotes, setContribNotes] = useState("");

  // v17.0.0 — expense→bucket links contributing to this bucket
  const [expenseLinks, setExpenseLinks] = useState<Array<{
    link: ExpenseInvestmentLink;
    expense_date: string;
    expense_merchant: string | null;
    expense_description: string | null;
    expense_amount: number;
  }>>([]);

  const loadData = useCallback(async () => {
    if (!bucketId) return;
    try {
      const [b, c, el] = await Promise.all([
        getInvestmentBucketById(bucketId),
        getInvestmentContributions(bucketId),
        V15_FLAGS.v17_expense_investment_link
          ? getLinksForBucketEnriched(bucketId)
          : Promise.resolve([]),
      ]);
      setBucket(b);
      setContributions(c);
      setExpenseLinks(el);
      if (b?.linked_milestone_id) {
        const ms = await getLifeMilestoneById(b.linked_milestone_id);
        setLinkedMilestoneName(ms?.name ?? null);
      } else {
        setLinkedMilestoneName(null);
      }
    } catch {
      // DB not ready
    }
    setLoaded(true);
  }, [bucketId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  // ─── Unified Contributions ────────────────────────────────

  const allContributions = useMemo(() => {
    // Manual contributions
    const manual: Array<{
      id: string;
      amount: number;
      date: string;
      notes: string | null;
      source: 'manual';
      sourceId: string;
    }> = contributions.map(c => ({
      id: c.id,
      amount: c.amount,
      date: c.date,
      notes: c.notes,
      source: 'manual' as const,
      sourceId: c.id,
    }));

    // Expense-linked contributions
    const fromExpenses: Array<{
      id: string;
      amount: number;
      date: string;
      notes: string | null;
      source: 'expense';
      sourceId: string;
      merchant: string | null;
      description: string | null;
    }> = expenseLinks.map(el => ({
      id: el.link.id,
      amount: el.link.contribution_amount,
      date: el.expense_date,
      notes: el.link.notes,
      source: 'expense' as const,
      sourceId: el.link.expense_id,
      merchant: el.expense_merchant,
      description: el.expense_description,
    }));

    // Merge and sort by date descending
    return [...manual, ...fromExpenses].sort((a, b) => b.date.localeCompare(a.date));
  }, [contributions, expenseLinks]);

  // ─── Monthly Grouping ────────────────────────────────────

  const monthlyHistory = useMemo(() => {
    const groups = new Map<string, { total: number; count: number }>();
    for (const c of contributions) {
      const month = c.date.slice(0, 7); // YYYY-MM
      const existing = groups.get(month) ?? { total: 0, count: 0 };
      groups.set(month, {
        total: existing.total + c.amount,
        count: existing.count + 1,
      });
    }
    return Array.from(groups.entries())
      .sort((a, b) => b[0].localeCompare(a[0])) // newest first
      .map(([month, data]) => ({
        month,
        label: formatMonthLabel(month),
        ...data,
      }));
  }, [contributions]);

  // ─── Projection ──────────────────────────────────────────

  const projection = useMemo(() => {
    if (!bucket) return null;

    const remaining = Math.max(
      bucket.annual_target - bucket.current_contributed,
      0,
    );
    if (remaining === 0) {
      return { isComplete: true, monthsToComplete: 0, projectedDate: null, avgMonthly: 0 };
    }

    if (monthlyHistory.length === 0) {
      return { isComplete: false, monthsToComplete: null, projectedDate: null, avgMonthly: 0 };
    }

    // Calculate avg monthly contribution from actual history
    const totalContributed = contributions.reduce((s, c) => s + c.amount, 0);
    const monthSpan = monthlyHistory.length;
    const avgMonthly = monthSpan > 0 ? totalContributed / monthSpan : 0;

    if (avgMonthly <= 0) {
      return { isComplete: false, monthsToComplete: null, projectedDate: null, avgMonthly: 0 };
    }

    const monthsToComplete = Math.ceil(remaining / avgMonthly);
    const projectedDate = new Date();
    projectedDate.setMonth(projectedDate.getMonth() + monthsToComplete);

    return {
      isComplete: false,
      monthsToComplete,
      projectedDate: formatLocalDate(projectedDate),
      avgMonthly,
    };
  }, [bucket, contributions, monthlyHistory]);

  // ─── Actions ─────────────────────────────────────────────

  const handleSaveContribution = async () => {
    if (!bucket) return;
    const amount = parseFloat(contribAmount);
    if (isNaN(amount) || amount <= 0) {
      alert("Invalid Amount", "Enter a valid amount.");
      return;
    }

    if (editingContrib) {
      await updateInvestmentContribution(editingContrib, bucket.id, {
        amount,
        date: contribDate,
        notes: contribNotes.trim() || undefined,
      });
    } else {
      await createInvestmentContribution({
        investment_bucket_id: bucket.id,
        month: contribDate.slice(0, 7),
        amount,
        date: contribDate,
        notes: contribNotes.trim() || undefined,
      });
    }

    setContribAmount("");
    setContribNotes("");
    setContribDate(new Date().toISOString().split("T")[0]);
    setEditingContrib(null);
    setShowAddForm(false);
    await loadData();
  };

  const handleEditContribution = (contrib: InvestmentContribution) => {
    setEditingContrib(contrib.id);
    setContribAmount(String(contrib.amount));
    setContribDate(contrib.date);
    setContribNotes(contrib.notes ?? "");
    setShowAddForm(true);
  };

  const handleContributionLongPress = (contrib: InvestmentContribution) => {
    alert(
      "Contribution",
      `${formatAmount(contrib.amount)} on ${contrib.date}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Edit",
          onPress: () => handleEditContribution(contrib),
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (!bucket) return;
            await deleteInvestmentContribution(contrib.id, bucket.id);
            await loadData();
          },
        },
      ],
    );
  };

  // ─── Render ──────────────────────────────────────────────

  if (!loaded) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Loading investment..." icon="pie-chart-outline" />
      </ScreenContainer>
    );
  }

  if (!bucket) {
    return (
      <ScreenContainer centered padTop={false}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.textSecondary} />
        <Text className="text-base font-medium text-foreground mt-4">
          Bucket not found
        </Text>
      </ScreenContainer>
    );
  }

  const remaining = Math.max(
    bucket.annual_target - bucket.current_contributed,
    0,
  );
  const pct =
    bucket.annual_target > 0
      ? Math.min(
          (bucket.current_contributed / bucket.annual_target) * 100,
          100,
        )
      : 0;
  const isComplete = bucket.current_contributed >= bucket.annual_target;

  return (
    <ScreenContainer padTop={false}>
      <KeyboardAvoidingView
        behavior="padding"
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 80 }}
        >
          <View className="px-4 py-4">
            {/* Bucket Header */}
            <Card className="mb-4">
              <View className="items-center py-2">
                <View
                  className="w-14 h-14 rounded-full items-center justify-center mb-2"
                  style={{
                    backgroundColor: isComplete
                      ? theme.alpha("success", 0.08)
                      : theme.alpha("primary", 0.08),
                  }}
                >
                  <Ionicons
                    name={isComplete ? "checkmark-circle" : "wallet-outline"}
                    size={28}
                    color={isComplete ? theme.success : colors.blue}
                  />
                </View>
                <Text className="text-lg font-bold text-foreground">
                  {bucket.name}
                </Text>
                {linkedMilestoneName && (
                  <View className="flex-row items-center mt-1 px-2.5 py-1 rounded-full" style={{ backgroundColor: theme.alpha("primary", 0.08) }}>
                    <Ionicons name="link-outline" size={12} color={colors.blue} />
                    <Text className="text-xs ml-1" style={{ color: theme.primary }}>
                      Feeds "{linkedMilestoneName}"
                    </Text>
                  </View>
                )}
                {isComplete && (
                  <View className="mt-1 px-3 py-1 rounded-full" style={{ backgroundColor: theme.alpha("success", 0.08) }}>
                    <Text className="text-xs font-medium text-success">
                      Goal Complete!
                    </Text>
                  </View>
                )}
              </View>

              {/* Goal / Done / Left */}
              <View className="flex-row mt-3">
                <View className="flex-1">
                  <Text className="text-xs text-muted-foreground text-center">
                    Goal
                  </Text>
                  <Text className="text-base font-bold text-foreground text-center">
                    {formatAmount(bucket.annual_target)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-muted-foreground text-center">
                    Done
                  </Text>
                  <Text className="text-base font-bold text-success text-center">
                    {formatAmount(bucket.current_contributed)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-muted-foreground text-center">
                    Left
                  </Text>
                  <Text className="text-base font-bold text-danger text-center">
                    {formatAmount(remaining)}
                  </Text>
                </View>
              </View>

              {/* Progress bar */}
              <View className="mt-3 h-3 rounded-full bg-border overflow-hidden">
                <View
                  className="h-3 rounded-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: isComplete ? theme.success : colors.blue,
                  }}
                />
              </View>
              <Text className="text-xs text-muted-foreground mt-1 text-right">
                {pct.toFixed(1)}% complete
              </Text>
            </Card>

            {/* Projection */}
            {projection && (
              <Card title="Projection" className="mb-4">
                {projection.isComplete ? (
                  <View className="flex-row items-center py-2">
                    <Ionicons
                      name="checkmark-circle"
                      size={18}
                      color={theme.success}
                    />
                    <Text className="text-sm font-medium text-success ml-2">
                      Annual target achieved!
                    </Text>
                  </View>
                ) : projection.monthsToComplete != null ? (
                  <>
                    <MetricRow
                      label="Avg Monthly Contribution"
                      value={formatAmount(projection.avgMonthly)}
                    />
                    <MetricRow
                      label="Months to Complete"
                      value={String(projection.monthsToComplete)}
                    />
                    <MetricRow
                      label="Projected Completion"
                      value={formatProjectedDate(projection.projectedDate!)}
                    />
                    {/* Needed per month to hit target by FY end hint */}
                    {remaining > 0 && (
                      <View
                        className="mt-2 px-3 py-2 rounded-lg"
                        style={{
                          backgroundColor:
                            projection.avgMonthly >= remaining / 12
                              ? theme.alpha("success", 0.08)
                              : theme.alpha("danger", 0.08),
                        }}
                      >
                        <Text className="text-xs text-muted-foreground">
                          At current pace: {formatAmount(projection.avgMonthly)}/month
                        </Text>
                      </View>
                    )}
                  </>
                ) : (
                  <Text className="text-sm text-muted-foreground py-2">
                    Add contributions to see projection
                  </Text>
                )}
              </Card>
            )}


            {/* Monthly History */}
            {monthlyHistory.length > 0 && (
              <Card title="Monthly History" className="mb-4">
                {monthlyHistory.map((m, i) => {
                  const barPct =
                    bucket.annual_target > 0
                      ? Math.min(
                          (m.total / (bucket.annual_target / 12)) * 100,
                          100,
                        )
                      : 0;
                  return (
                    <View
                      key={m.month}
                      className={`py-2.5 ${
                        i < monthlyHistory.length - 1
                          ? "border-b border-border"
                          : ""
                      }`}
                    >
                      <View className="flex-row items-center justify-between mb-1">
                        <Text className="text-sm font-medium text-foreground">
                          {m.label}
                        </Text>
                        <Text className="text-sm font-semibold text-foreground">
                          {formatAmount(m.total)}
                        </Text>
                      </View>
                      <View className="h-2 rounded-full bg-border overflow-hidden">
                        <View
                          className="h-2 rounded-full"
                          style={{ width: `${barPct}%`, backgroundColor: theme.primary }}
                        />
                      </View>
                      {m.count > 1 && (
                        <Text className="text-xs text-faint-foreground mt-0.5">
                          {m.count} contributions
                        </Text>
                      )}
                    </View>
                  );
                })}
              </Card>
            )}

            {/* Add Contribution Form */}
            {showAddForm ? (
              <Card title={editingContrib ? "Edit Contribution" : "Add Contribution"} className="mb-4">
                <Input
                  label="Amount"
                  value={contribAmount}
                  onChangeText={setContribAmount}
                  keyboardType="numeric"
                  formula
                  placeholder="e.g. 10000"
                  containerClassName="mb-3"
                />
                <DateInput
                  label="Date"
                  value={contribDate}
                  onChange={setContribDate}
                  containerClassName="mb-3"
                />
                <Input
                  label="Notes (optional)"
                  value={contribNotes}
                  onChangeText={setContribNotes}
                  placeholder="e.g. SIP for April"
                  maxLength={200}
                  containerClassName="mb-3"
                />
                <View className="flex-row">
                  <View className="flex-1 mr-2">
                    <Button
                      title="Cancel"
                      variant="outline"
                      onPress={() => {
                        setShowAddForm(false);
                        setEditingContrib(null);
                        setContribAmount("");
                        setContribNotes("");
                      }}
                    />
                  </View>
                  <View className="flex-1">
                    <Button title={editingContrib ? "Update" : "Save"} onPress={handleSaveContribution} />
                  </View>
                </View>
              </Card>
            ) : (
              <Pressable
                onPress={() => setShowAddForm(true)}
                className="flex-row items-center justify-center py-3 mb-4 rounded-lg border border-dashed"
                style={{ borderColor: theme.primary }}
              >
                <Ionicons
                  name="add-circle-outline"
                  size={18}
                  color={colors.blue}
                />
                <Text className="text-sm font-medium ml-1" style={{ color: theme.primary }}>
                  Add Contribution
                </Text>
              </Pressable>
            )}

            {/* All Contributions (unified: manual + expense + transfer) */}
            {allContributions.length > 0 && (
              <Card
                title={`All Contributions (${allContributions.length})`}
                className="mb-4"
              >
                {allContributions.map((c, i) => (
                  <Pressable
                    key={`${c.source}-${c.sourceId}`}
                    onLongPress={c.source === 'manual' ? () => handleContributionLongPress(contributions.find(contr => contr.id === c.id)!) : undefined}
                    className={`flex-row items-center py-2.5 ${
                      i < allContributions.length - 1
                        ? "border-b border-border"
                        : ""
                    }`}
                  >
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-foreground">
                        {formatAmount(c.amount)}
                      </Text>
                      {c.notes && (
                        <Text className="text-xs text-muted-foreground">
                          {c.notes}
                        </Text>
                      )}
                      {c.source === 'expense' && (
                        <Pressable
                          onPress={() => router.push({ pathname: "/expense/[id]", params: { id: c.sourceId } } as never)}
                          accessibilityRole="button"
                          accessibilityLabel="View source expense"
                        >
                          <Text
                            className="text-xs mt-0.5"
                            style={{ color: theme.primary }}
                          >
                            from expense · tap to view
                          </Text>
                        </Pressable>
                      )}
                      {/* Cross-link back to the source transfer, when this
                          contribution was auto-created by a demat transfer.
                          Requires accountId + month params for the ledger to
                          actually load entries (without accountId it renders
                          blank). transferId + date let the ledger flash-
                          highlight the matching row. */}
                      {c.source === 'manual' && (() => {
                        const contrib = contributions.find(contr => contr.id === c.id);
                        return contrib?.linked_transfer_id && contrib.linked_transfer_account_id && contrib.linked_transfer_date ? (
                          <Pressable
                            onPress={() =>
                              router.push({
                                pathname: "/reconciliation/account-ledger" as never,
                                params: {
                                  accountId: contrib.linked_transfer_account_id,
                                  month: contrib.linked_transfer_date!.slice(0, 7),
                                  transferId: contrib.linked_transfer_id,
                                },
                              })
                            }
                            accessibilityRole="button"
                            accessibilityLabel="View source transfer"
                          >
                            <Text
                              className="text-xs mt-0.5"
                              style={{ color: theme.primary }}
                            >
                              from transfer · tap to view
                            </Text>
                          </Pressable>
                        ) : null;
                      })()}
                    </View>
                    <Text className="text-xs text-muted-foreground">
                      {c.date}
                    </Text>
                  </Pressable>
                ))}
                <Text className="text-xs text-faint-foreground mt-2 text-center">
                  Long-press to edit or delete manual contributions
                </Text>
              </Card>
            )}


          </View>
        </ScrollView>

        {/* FAB: Add Contribution (when form is hidden) */}
        {!showAddForm && (
          <FAB icon="add" onPress={() => setShowAddForm(true)} />
        )}
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

// ─── Helpers ─────────────────────────────────────────────


function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-");
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${monthNames[parseInt(m, 10) - 1]} ${year}`;
}

function formatProjectedDate(dateStr: string): string {
  const [year, m] = dateStr.split("-");
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${monthNames[parseInt(m, 10) - 1]} ${year}`;
}
