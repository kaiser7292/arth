import { Button, Card, Chip, DateInput, Input, LoadingState, ProgressBar, ScreenContainer, Text } from "@/components/ui";
import { HeaderPill, StatTile } from "@/components/ui/LinkRow";
import { FormGroup } from "@/components/ui/FormParts";
import { tint } from "@/constants/brand";
import { describeBucketDelete } from "@/utils/bucket-delete-text";
import { formatError } from "@/utils/error-message";
import { logger } from "@/utils/logger";

import { useAlert } from "@/hooks/use-alert";
import {
    getLinksForBucketEnriched,
    type ExpenseInvestmentLink,
} from "@/services/expense-investment-link";
import { V15_FLAGS } from "@/services/feature-flags";
import { getLifeMilestoneById } from "@/services/life-milestone";
import type {
    InvestmentBucket,
    InvestmentContribution,
    InvestmentBucketUsage,
} from "@/services/yearly-plan";
import {
    createInvestmentContribution,
    deleteInvestmentContribution,
    deleteInvestmentBucket,
    getInvestmentBucketById,
    getInvestmentBucketUsage,
    resetInvestmentBucket,
    getInvestmentContributions,
    updateInvestmentContribution,
} from "@/services/yearly-plan";

import { formatAmount } from "@/utils/expense-validation";
import { formatLocalDate } from "@/utils/fiscal-year";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { todayIso } from "@/utils/local-date";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";

export default function InvestmentDetailScreen() {
  const router = useRouter();
  const alert = useAlert();
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
    todayIso(),
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

  const [loadFailed, setLoadFailed] = useState(false);
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
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
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
      alert("Invalid amount", "Enter a valid amount.");
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
    setContribDate(todayIso());
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
        {loadFailed && <LoadFailedBanner onRetry={loadData} />}
        <LoadingState message="Loading investment..." icon="pie-chart-outline" />
      </ScreenContainer>
    );
  }

  if (!bucket) {
    return (
      <ScreenContainer centered padTop={false}>
        {loadFailed && <LoadFailedBanner onRetry={loadData} />}
        <Ionicons name="alert-circle-outline" size={48} color={theme.faintForeground} />
        <Text className="text-body font-semibold text-foreground mt-4">
          Bucket not found
        </Text>
      </ScreenContainer>
    );
  }

  // Withdrawals take a bucket down by their cost, so it shouldn't go below zero - but older
  // records (and manual edits) can. Never show negative progress: a negative width drew the bar full.
  const done = Math.max(bucket.current_contributed, 0);
  const remaining = Math.max(bucket.annual_target - done, 0);
  const pct = bucket.annual_target > 0 ? Math.min(Math.max((done / bucket.annual_target) * 100, 0), 100) : 0;
  const isComplete = done >= bucket.annual_target;
  const color = isComplete ? theme.success : theme.data.series[3];

  const openMore = () =>
    alert(bucket.name, undefined, [
      {
        text: "Reset contributions",
        onPress: () =>
          alert(
            "Reset contributions",
            `This will clear all contributions for "${bucket.name}" and set invested amount to zero. The bucket structure and target are kept.\n\nContinue?`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Reset",
                style: "destructive",
                onPress: async () => {
                  await resetInvestmentBucket(bucket.id);
                  await loadData();
                },
              },
            ],
          ),
      },
      {
        text: "Delete bucket",
        style: "destructive",
        onPress: async () => {
          let usage: InvestmentBucketUsage | null = null;
          try {
            usage = await getInvestmentBucketUsage(bucket.id);
          } catch (e) {
            logger.warn("Bucket usage lookup failed:", e);
          }
          alert("Delete bucket", describeBucketDelete(bucket.name, usage), [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: async () => {
                try {
                  await deleteInvestmentBucket(bucket.id);
                  router.back();
                } catch (e) {
                  logger.error("Delete bucket failed:", e);
                  alert("Couldn't delete the bucket", `"${bucket.name}" is unchanged. ${formatError("Delete bucket", e)}`);
                }
              },
            },
          ]);
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen
        options={{
          title: "",
          headerRight: () => (
            <HeaderPill
              label="Edit"
              accessibilityLabel={`Edit ${bucket.name}`}
              onPress={() =>
                router.push({
                  pathname: "/goals/investment-buckets",
                  params: { fy: bucket.financial_year ?? undefined, edit: bucket.id },
                })
              }
            />
          ),
        }}
      />
      {loadFailed && <LoadFailedBanner onRetry={loadData} />}
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 96 }}>
          {/* Hero: contributed against the target */}
          <View className="items-center px-4 pb-4" style={{ gap: 4 }}>
            <View className="w-[52px] h-[52px] rounded-card items-center justify-center" style={{ backgroundColor: tint(color, 0.1) }}>
              <Ionicons name={isComplete ? "checkmark-circle" : "wallet-outline"} size={24} color={color} />
            </View>
            <Text className="text-heading font-semibold text-foreground mt-2" numberOfLines={1}>
              {bucket.name}
            </Text>
            <Text className="text-hero font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }} numberOfLines={1}>
              {formatAmount(done)}
            </Text>
            <Text className="text-meta text-muted-foreground text-center">
              of {formatAmount(bucket.annual_target)}
              {linkedMilestoneName ? ` · linked to milestone ${linkedMilestoneName}` : ""}
              {remaining > 0 ? ` · ${formatAmount(remaining)} left` : ""}
            </Text>
            {isComplete && <Chip variant="status" tone="success" label="Target reached" className="self-center mt-1" />}
            {bucket.annual_target > 0 && (
              <View className="w-full mt-2.5">
                <ProgressBar value={pct / 100} color={color} height={8} animated={false} />
              </View>
            )}
          </View>

          <View className="px-4" style={{ gap: 12 }}>
            {/* Projection: avg a month, months to go, done by */}
            {projection &&
              (projection.isComplete ? (
                <View className="flex-row items-center rounded-card px-4 py-3" style={{ backgroundColor: theme.alpha("success", 0.08), gap: 8 }}>
                  <Ionicons name="checkmark-circle" size={18} color={theme.success} />
                  <Text className="text-body font-semibold text-foreground">Annual target achieved</Text>
                </View>
              ) : projection.monthsToComplete != null ? (
                <View style={{ gap: 6 }}>
                  <View className="flex-row" style={{ gap: 8 }}>
                    <StatTile label="Avg a month" value={formatAmount(projection.avgMonthly)} />
                    <StatTile label="Months to go" value={String(projection.monthsToComplete)} />
                    <StatTile label="Done by" value={formatProjectedDate(projection.projectedDate!)} />
                  </View>
                  {remaining > 0 && (
                    <Text
                      className="text-meta px-1"
                      style={{ color: projection.avgMonthly >= remaining / 12 ? theme.success : theme.warning }}
                    >
                      At the current pace: {formatAmount(projection.avgMonthly)} a month
                    </Text>
                  )}
                </View>
              ) : (
                <Text className="text-meta text-muted-foreground px-1">Add contributions to see when it&apos;s done</Text>
              ))}

            {/* Add / edit contribution */}
            {showAddForm && (
              <FormGroup icon="add-circle-outline" title={editingContrib ? "Edit contribution" : "Add contribution"}>
                <Input label="Amount" prefix="₹" value={contribAmount} onChangeText={setContribAmount} keyboardType="numeric" formula placeholder="10000" />
                <DateInput label="Date" value={contribDate} onChange={setContribDate} />
                <Input label="Notes (optional)" value={contribNotes} onChangeText={setContribNotes} placeholder="e.g. SIP for April" maxLength={200} />
                <View className="flex-row" style={{ gap: 8 }}>
                  <View className="flex-1">
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
                    <Button title={editingContrib ? "Save" : "Add"} onPress={handleSaveContribution} />
                  </View>
                </View>
              </FormGroup>
            )}

            {/* Monthly history */}
            {monthlyHistory.length > 0 && (
              <Card>
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground">Monthly history</Text>
                  {!showAddForm && <Chip label="Contribution" icon="add" on onPress={() => setShowAddForm(true)} />}
                </View>
                {monthlyHistory.map((m, i) => {
                  const barPct = bucket.annual_target > 0 ? Math.min((m.total / (bucket.annual_target / 12)) * 100, 100) : 0;
                  return (
                    <View key={m.month} className={`py-2.5 ${i > 0 ? "border-t border-border" : ""}`}>
                      <View className="flex-row items-center justify-between mb-1">
                        <Text className="text-body font-semibold text-foreground">{m.label}</Text>
                        <Text className="text-body font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                          {formatAmount(m.total)}
                        </Text>
                      </View>
                      <ProgressBar value={barPct / 100} color={theme.primary} height={6} animated={false} />
                      {m.count > 1 && <Text className="text-label text-faint-foreground mt-0.5">{m.count} contributions</Text>}
                    </View>
                  );
                })}
              </Card>
            )}

            {/* Every contribution: manual, from an expense, from a transfer */}
            {allContributions.length > 0 && (
              <Card>
                <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  All contributions · {allContributions.length}
                </Text>
                {allContributions.map((c, i) => {
                  const contrib = c.source === "manual" ? contributions.find((contr) => contr.id === c.id) : undefined;
                  const fromTransfer =
                    contrib?.linked_transfer_id && contrib.linked_transfer_account_id && contrib.linked_transfer_date ? contrib : null;
                  const sourceLabel = c.source === "expense" ? "From expense" : fromTransfer ? "From transfer" : "Added by hand";
                  const open =
                    c.source === "expense"
                      ? () => router.push({ pathname: "/expense/[id]", params: { id: c.sourceId } })
                      : fromTransfer
                        ? () =>
                            router.push({
                              pathname: "/reconciliation/account-ledger",
                              params: {
                                accountId: fromTransfer.linked_transfer_account_id,
                                month: fromTransfer.linked_transfer_date!.slice(0, 7),
                                transferId: fromTransfer.linked_transfer_id,
                              },
                            })
                        : undefined;
                  return (
                    <Pressable
                      key={`${c.source}-${c.sourceId}`}
                      onPress={open}
                      onLongPress={contrib ? () => handleContributionLongPress(contrib) : undefined}
                      className={`flex-row items-center py-2.5 ${i > 0 ? "border-t border-border" : ""}`}
                      style={{ gap: 12 }}
                      accessibilityRole={open ? "button" : undefined}
                      accessibilityLabel={`${formatAmount(c.amount)}, ${sourceLabel}, ${c.date}`}
                      accessibilityHint={contrib ? "Long-press to edit or delete" : undefined}
                    >
                      <View className="flex-1" style={{ gap: 4 }}>
                        <View className="flex-row items-center" style={{ gap: 6 }}>
                          <Chip variant="status" className="self-center" label={sourceLabel} />
                          <Text className="text-meta text-muted-foreground">{c.date}</Text>
                        </View>
                        {c.notes ? (
                          <Text className="text-meta text-muted-foreground" numberOfLines={1}>
                            {c.notes}
                          </Text>
                        ) : null}
                      </View>
                      <Text className="text-body font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                        {formatAmount(c.amount)}
                      </Text>
                      {open ? <Ionicons name="chevron-forward" size={16} color={theme.faintForeground} /> : null}
                    </Pressable>
                  );
                })}
                <Text className="text-label text-faint-foreground mt-2 text-center">Long-press one you added by hand to edit or delete it</Text>
              </Card>
            )}

            {!showAddForm && monthlyHistory.length === 0 && (
              <Pressable
                onPress={() => setShowAddForm(true)}
                className="flex-row items-center justify-center rounded-card border border-dashed"
                style={{ minHeight: 52, borderColor: theme.primary, gap: 6 }}
                accessibilityRole="button"
              >
                <Ionicons name="add-circle-outline" size={18} color={theme.primary} />
                <Text className="text-body font-semibold" style={{ color: theme.primary }}>
                  Add contribution
                </Text>
              </Pressable>
            )}

            {/* More: reset contributions, delete bucket */}
            <Pressable
              onPress={openMore}
              className="flex-row items-center rounded-card bg-card border border-border px-4"
              style={{ minHeight: 52, gap: 12 }}
              accessibilityRole="button"
              accessibilityLabel="More: reset contributions, delete bucket"
            >
              <Text className="flex-1 text-body font-semibold text-foreground" numberOfLines={1}>
                More: reset contributions, delete bucket
              </Text>
              <Ionicons name="ellipsis-horizontal" size={18} color={theme.mutedForeground} />
            </Pressable>
          </View>
        </ScrollView>

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
