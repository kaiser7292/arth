import { HisaabInclusionSheet } from "@/components/simulator/HisaabInclusionSheet";
import { StaleEntryResolveSheet } from "@/components/simulator/StaleEntryResolveSheet";
import { Card, FAB, ScreenContainer } from "@/components/ui";
import { CalendarModal } from "@/components/ui/CalendarModal";
import { DEFAULT_USER_ID } from "@/constants/app";
import { StatusColors } from "@/constants/theme";
import { getDatabase } from "@/database";
import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { Category } from "@/services/category";
import { getCategories } from "@/services/category";
import type { FinancialAccount } from "@/services/financial-account";
import { getActiveAccounts } from "@/services/financial-account";
import type { HisaabPerson } from "@/services/hisaab";
import { getPersonsByIds } from "@/services/hisaab";
import type {
    CreateEntryInput,
    EntryFulfillment,
    FulfilledSummary,
    ScenarioOverview,
    SimulationEntry,
    UpdateEntryInput
} from "@/services/simulator";
import {
    archiveScenario,
    createEntry,
    deleteEntry,
    deleteScenario,
    dismissEntry,
    duplicateEntry,
    fulfillEntryMulti,
    getEntryFulfillments,
    getFulfilledSummary,
    getScenarioOverview,
    rescheduleEntry,
    seedScenarioFromReminders,
    updateEntry,
    updateScenario
} from "@/services/simulator";
import { ac } from "@/utils/accent";
import { todayIso } from "@/utils/date";
import { formatAmount } from "@/utils/format";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Modal,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
} from "react-native";

function prettyDate(ymd: string): string {
  if (!ymd) return "";
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return ymd;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function groupEntriesByDate(entries: SimulationEntry[]): {
  today: SimulationEntry[];
  tomorrow: SimulationEntry[];
  thisWeek: SimulationEntry[];
  later: SimulationEntry[];
} {
  const today = todayIso();
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = fmt(tomorrowDate);
  const weekDate = new Date();
  weekDate.setDate(weekDate.getDate() + 7);
  const weekEnd = fmt(weekDate);

  const out: {
    today: SimulationEntry[];
    tomorrow: SimulationEntry[];
    thisWeek: SimulationEntry[];
    later: SimulationEntry[];
  } = { today: [], tomorrow: [], thisWeek: [], later: [] };
  for (const e of entries) {
    if (e.date === today) out.today.push(e);
    else if (e.date === tomorrow) out.tomorrow.push(e);
    else if (e.date <= weekEnd) out.thisWeek.push(e);
    else out.later.push(e);
  }
  return out;
}

export default function ScenarioDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const alert = useAlert();
  const navigation = useNavigation();
  const { colors, accent, colorScheme } = useColorScheme();
  const sc = StatusColors[colorScheme];

  const [overview, setOverview] = useState<ScenarioOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [staleSheetEntry, setStaleSheetEntry] = useState<SimulationEntry | null>(null);
  const [renameVisible, setRenameVisible] = useState(false);
  const [horizonPickerVisible, setHorizonPickerVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  // v16.0.4 — starting-balance drawer, closed by default. When open it
  // shows the per-account current balances that make up the starting net.
  const [expandStarting, setExpandStarting] = useState(false);
  // v16.0.8 — projected-balance drawer, closed by default. Shows all
  // accounts with their remaining balance till horizon date.
  const [expandProjected, setExpandProjected] = useState(false);
  const [fulfilledSummary, setFulfilledSummary] = useState<FulfilledSummary | null>(null);
  const [expandSummary, setExpandSummary] = useState(false);
  const [expandedFulfilledId, setExpandedFulfilledId] = useState<string | null>(null);
  const [fulfillmentDetails, setFulfillmentDetails] = useState<Record<string, EntryFulfillment[]>>({});
  // v16.0.8 — incoming/outgoing entry sections collapsible.
  const [expandOutgoing, setExpandOutgoing] = useState(false);
  const [expandIncoming, setExpandIncoming] = useState(false);
  // v16.0.5 — hisaab inclusion sheet + cached person-name map for the
  // drawer rows.
  const [hisaabSheetVisible, setHisaabSheetVisible] = useState(false);
  const [hisaabPersonMap, setHisaabPersonMap] = useState<Record<string, HisaabPerson>>({});

  const load = useCallback(
    async (soft = false) => {
      if (!id) return;
      if (!soft) setLoading(true);
      else setRecomputing(true);
      try {
        const ov = await getScenarioOverview(id, DEFAULT_USER_ID);
        setOverview(ov);
        const summary = await getFulfilledSummary(id);
        setFulfilledSummary(summary);
        setFulfillmentDetails({});
        setExpandedFulfilledId(null);
      } finally {
        setLoading(false);
        setRecomputing(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void load(false);
    (async () => {
      const [a, c] = await Promise.all([
        getActiveAccounts(DEFAULT_USER_ID),
        getCategories(DEFAULT_USER_ID),
      ]);
      setAccounts(a);
      setCategories(c);
    })();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load(true);
    }, [load]),
  );

  // v16.0.5 — resolve person names for any included hisaab rows so the
  // starting-balance drawer can label them. Runs whenever the list of
  // included ids changes.
  const categoryNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of categories) m[c.id] = c.name;
    return m;
  }, [categories]);

  const includedPersonIds = useMemo(
    () => (overview?.hisaabIncluded ?? []).map((i) => i.person_id),
    [overview?.hisaabIncluded],
  );
  const includedPersonIdsKey = includedPersonIds.join(",");
  useEffect(() => {
    if (includedPersonIds.length === 0) {
      setHisaabPersonMap({});
      return;
    }
    (async () => {
      const personMap = await getPersonsByIds(includedPersonIds);
      const asRecord: Record<string, HisaabPerson> = {};
      personMap.forEach((p, id) => {
        asRecord[id] = p;
      });
      setHisaabPersonMap(asRecord);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includedPersonIdsKey]);

  // Header title reflects scenario name.
  // v16.0.1 — dep narrowed to just the name, so this only fires on an
  // actual rename. Previously it re-ran on every `overview` change
  // (e.g. every recomputing tick).
  const scenarioName = overview?.scenario.name;
  useEffect(() => {
    if (scenarioName) navigation.setOptions({ title: scenarioName });
  }, [scenarioName, navigation]);

  const handleCreateEntry = useCallback(
    async (input: CreateEntryInput) => {
      if (!id) return;
      await createEntry(id, input);
      await load(true);
    },
    [id, load],
  );

  const handleUpdateEntry = useCallback(
    async (entryId: string, patch: UpdateEntryInput) => {
      await updateEntry(entryId, patch);
      await load(true);
    },
    [load],
  );

  const handleDuplicateEntry = useCallback(
    async (entryId: string) => {
      await duplicateEntry(entryId);
      await load(true);
    },
    [load],
  );

  // v16.0.1 — long-press handler offers Duplicate + Remove so the
  // duplicate action is reachable alongside delete.
  const handleEntryLongPress = useCallback(
    (entry: SimulationEntry) => {
      alert(
        entry.description || entry.merchant_name || (entry.category_id && categoryNameMap[entry.category_id]) || "Planned entry",
        formatAmount(entry.amount),
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Duplicate",
            onPress: async () => {
              await duplicateEntry(entry.id);
              await load(true);
            },
          },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              await deleteEntry(entry.id);
              await load(true);
            },
          },
        ],
      );
    },
    [alert, load],
  );

  const handleReschedule = useCallback(
    async (entryId: string, newDate: string) => {
      await rescheduleEntry(entryId, newDate);
      await load(true);
    },
    [load],
  );

  /**
   * v17.3.1 — tap a fulfilled simulator entry to jump to the matched
   * transaction. `fulfilled_expense_id` is a lossy label — the matcher may
   * have linked an expense OR an account_transfer. Check both and route.
   */
  const handleOpenFulfilledEntry = useCallback(
    async (entry: SimulationEntry) => {
      const realId = entry.fulfilled_expense_id;
      if (!realId) return;
      try {
        const db = getDatabase();
        // Try expense first (more common match)
        const expRow = await db.getFirstAsync<{ id: string }>(
          "SELECT id FROM expenses WHERE id = ? AND deleted_at IS NULL LIMIT 1;",
          realId,
        );
        if (expRow) {
          router.push({ pathname: "/expense/[id]", params: { id: realId } } as never);
          return;
        }
        // Fall back to transfer → route to its from-account ledger with highlight
        const transferRow = await db.getFirstAsync<{
          id: string;
          from_account_id: string | null;
          to_account_id: string | null;
        }>(
          "SELECT id, from_account_id, to_account_id FROM account_transfers WHERE id = ? AND deleted_at IS NULL LIMIT 1;",
          realId,
        );
        if (transferRow) {
          const accountId = transferRow.from_account_id ?? transferRow.to_account_id;
          if (accountId) {
            router.push({
              pathname: "/reconciliation/account-ledger",
              params: { accountId, transferId: realId },
            } as never);
            return;
          }
        }
        alert(
          "Matched transaction not found",
          "It may have been deleted. Unfulfill this entry to re-match against a newer transaction.",
        );
      } catch {
        alert(
          "Couldn't open",
          "Something went wrong navigating to the matched transaction.",
        );
      }
    },
    [router, alert],
  );

  const handleFulfill = useCallback(
    async (entryId: string, expenseIds: string[]) => {
      await fulfillEntryMulti(entryId, expenseIds);
      await load(true);
    },
    [load],
  );

  const handleDismissStale = useCallback(
    async (entryId: string) => {
      await dismissEntry(entryId);
      await load(true);
    },
    [load],
  );

  const handleReseed = useCallback(async () => {
    if (!id) return;
    setMenuVisible(false);
    const added = await seedScenarioFromReminders(id, DEFAULT_USER_ID);
    alert(
      "Re-seeded",
      added === 0
        ? "No new reminders or CC forecasts to add. Your list already reflects them."
        : `${added} entr${added === 1 ? "y" : "ies"} added from reminders + CC forecasts.`,
    );
    await load(true);
  }, [id, alert, load]);

  const handleArchive = useCallback(() => {
    if (!overview) return;
    setMenuVisible(false);
    alert("Mark as done?", `"${overview.scenario.name}" will move to the Completed list. You can restore it at any time.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Mark done",
        onPress: async () => {
          await archiveScenario(overview.scenario.id);
          router.back();
        },
      },
    ]);
  }, [overview, alert, router]);

  const handleDeleteScenario = useCallback(() => {
    if (!overview) return;
    setMenuVisible(false);
    alert(
      "Delete scenario?",
      `"${overview.scenario.name}" and all its planned entries will be permanently removed.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteScenario(overview.scenario.id);
            router.back();
          },
        },
      ],
    );
  }, [overview, alert, router]);

  if (loading || !overview) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.textSecondary} />
          <Text className="text-sm mt-2" style={{ color: colors.textSecondary }}>
            Loading scenario…
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  const { scenario, baseline, entries, simulation } = overview;
  // v16.0.5 — segregate by direction, then by date window inside each.
  // "Incoming" and "Outgoing" are different mental buckets; users asked
  // to see them grouped rather than interleaved.
  const outgoingEntries = entries.upcoming.filter((e) => e.direction === "out");
  const incomingEntries = entries.upcoming.filter((e) => e.direction === "in");
  const outgoingGrouped = groupEntriesByDate(outgoingEntries);
  const incomingGrouped = groupEntriesByDate(incomingEntries);
  const outgoingTotal = outgoingEntries.reduce((s, e) => s + e.amount, 0);
  const incomingTotal = incomingEntries.reduce((s, e) => s + e.amount, 0);

  // v16.0.5 — hisaab inclusions fold into the starting balance.
  // Positive-sign rows lift "money available". Negative-sign rows add to
  // "money owed".
  const hisaabIncluded = overview.hisaabIncluded;
  const hisaabAvailable = hisaabIncluded
    .filter((h) => h.amount_sign === "positive")
    .reduce((s, h) => s + h.amount, 0);
  const hisaabOwed = hisaabIncluded
    .filter((h) => h.amount_sign === "negative")
    .reduce((s, h) => s + h.amount, 0);
  const hisaabNet = hisaabAvailable - hisaabOwed;
  const adjustedNetStart = simulation.netWorthStart + hisaabNet;
  const adjustedNetEnd = simulation.netWorthEnd + hisaabNet;
  const delta = adjustedNetEnd - adjustedNetStart;
  const deltaColor = delta >= 0 ? sc.success : sc.danger;

  // Per-account affected set — only show trajectory cards for accounts that
  // actually see movement. Unaffected accounts clutter the view.
  const touchedAccountIds = new Set<string>();
  for (const e of entries.upcoming) {
    if (e.account_id) touchedAccountIds.add(e.account_id);
  }
  const affectedAccounts = baseline.filter((a) => touchedAccountIds.has(a.id));

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 96 }}
      >
        {/* Header actions — horizon + menu */}
        <View className="mx-4 mt-3 mb-1 flex-row items-center justify-between">
          <Pressable
            onPress={() => setHorizonPickerVisible(true)}
            className="flex-row items-center py-1.5 px-3 rounded-full"
            style={{ backgroundColor: ac(accent, colorScheme, 50, 900), borderWidth: 1, borderColor: ac(accent, colorScheme, 200, 700) }}
            accessibilityRole="button"
            accessibilityLabel="Change horizon date"
          >
            <Ionicons name="calendar-outline" size={14} color={accent[500]} />
            <Text className="text-xs font-semibold ml-1.5" style={{ color: accent[500] }}>
              Until {prettyDate(scenario.horizon_date)}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMenuVisible(true)}
            hitSlop={8}
            className="p-2"
            accessibilityLabel="Scenario menu"
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>

        {/* Hero / overview — v16.0.5 redesign. Hierarchy:
              1. Projected balance hero (text-3xl, dominant)
              2. Supporting line — today → horizon + delta pill
              3. Collapsible "Starting balance · Today" drawer
              4. Per-account current → projected breakdown
            Warnings live in their own tinted strip BELOW the card (see below). */}
        <Card className="mx-4 mt-3">
          <View className="flex-row items-center justify-between">
            <Text
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: colors.textSecondary }}
            >
              Projected balance · {prettyDate(scenario.horizon_date)}
            </Text>
            {recomputing && (
              <View
                className="flex-row items-center px-2 py-0.5 rounded-full"
                style={{ backgroundColor: accent[500] + "1A" }}
              >
                <ActivityIndicator size="small" color={accent[500]} />
                <Text className="text-[10px] font-semibold ml-1.5" style={{ color: accent[500] }}>
                  Updating…
                </Text>
              </View>
            )}
          </View>

          {/* Hero number */}
          <View className="flex-row items-end mt-2" style={{ opacity: recomputing ? 0.55 : 1 }}>
            <Text className="text-3xl font-bold" style={{ color: colors.text }}>
              {formatAmount(adjustedNetEnd)}
            </Text>
            <View
              className="ml-3 mb-1.5 flex-row items-center px-2 py-0.5 rounded-full"
              style={{ backgroundColor: deltaColor + "14" }}
            >
              <Ionicons name={delta >= 0 ? "arrow-up" : "arrow-down"} size={10} color={deltaColor} />
              <Text className="text-[10px] font-semibold ml-1" style={{ color: deltaColor }}>
                {delta >= 0 ? "+" : ""}
                {formatAmount(Math.round(delta))}
              </Text>
            </View>
          </View>
          <Text className="text-xs mt-1" style={{ color: colors.textSecondary }}>
            {entries.upcoming.length === 0
              ? "No planned entries yet - same as starting balance."
              : `Starts at ${formatAmount(adjustedNetStart)} today, after ${entries.upcoming.length} planned ${entries.upcoming.length === 1 ? "entry" : "entries"}.`}
          </Text>

          {/* Warnings strip — overdraft, min balance breach, CC over limit */}
          {simulation.warnings.length > 0 && (
            <View className="mt-3 pt-3 border-t border-border">
              <Text className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: sc.danger }}>
                Warnings
              </Text>
              {simulation.warnings.map((warning) => {
                const isOverdraft = warning.kind === "negative_balance";
                const isMinBreach = warning.kind === "min_balance_breach";
                const isCCOverLimit = warning.kind === "cc_over_limit";
                
                // Find savings accounts for transfer recommendation
                const savingsAccounts = baseline.filter(
                  (a) => a.type === "savings" && a.id !== warning.accountId && (simulation.endBalances[a.id] ?? a.balance) > 0
                );
                const topSavingsAccount = savingsAccounts.length > 0 ? savingsAccounts[0] : null;
                
                return (
                  <View key={`${warning.accountId}-${warning.kind}`} className="mb-2 p-3 rounded-lg" style={{ backgroundColor: sc.danger + "10" }}>
                    <View className="flex-row items-start mb-1">
                      <Ionicons name="alert-circle" size={14} color={sc.danger} />
                      <Text className="ml-2 text-xs font-semibold flex-1" style={{ color: sc.danger }}>
                        {warning.accountLabel}
                      </Text>
                    </View>
                    <Text className="text-[10px] mb-1" style={{ color: colors.textSecondary }}>
                      {isOverdraft && `Account overdrawn by ${formatAmount(Math.abs(warning.amount))} on ${prettyDate(warning.firstTriggerDate)}`}
                      {isMinBreach && `Below minimum balance by ${formatAmount(Math.abs(warning.amount))} on ${prettyDate(warning.firstTriggerDate)}`}
                      {isCCOverLimit && `Credit card over limit by ${formatAmount(warning.amount)} on ${prettyDate(warning.firstTriggerDate)}`}
                    </Text>
                    {isOverdraft && topSavingsAccount && (
                      <View className="mt-1 pt-1 border-t border-border">
                        <Text className="text-[10px]" style={{ color: colors.textSecondary }}>
                          Recommendation: Transfer from <Text className="font-semibold" style={{ color: colors.text }}>{topSavingsAccount.label}</Text>
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* STARTING BALANCE — collapsible drawer. Closed by default. */}
          <Pressable
            onPress={() => setExpandStarting((v) => !v)}
            className="flex-row items-center justify-between mt-4 pt-3 py-2 border-t border-border"
            accessibilityRole="button"
            accessibilityLabel={
              expandStarting
                ? "Hide starting balance breakdown"
                : "Show starting balance breakdown"
            }
          >
            <View className="flex-row items-center flex-1">
              <Ionicons
                name={expandStarting ? "chevron-down" : "chevron-forward"}
                size={14}
                color={colors.textSecondary}
              />
              <Text className="ml-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: colors.textSecondary }}>
                Starting balance · Today
              </Text>
            </View>
            <Text className="text-sm font-semibold" style={{ color: colors.text }}>
              {formatAmount(adjustedNetStart)}
            </Text>
          </Pressable>

          {expandStarting && (() => {
            // v16.0.5 — CC with negative balance = overpaid, so the bank
            // owes US. Classify those with other assets, not liabilities.
            // Non-CC with negative balance = overdrawn; stays on the
            // "available" side as a negative number (still an asset, just
            // in the red). CC zero = neither side.
            const haveAccounts = baseline.filter(
              (a) => a.type !== "credit_card" || a.balance < 0,
            );
            const oweAccounts = baseline.filter(
              (a) => a.type === "credit_card" && a.balance > 0,
            );
            const haveTotal = haveAccounts.reduce(
              (s, a) => s + (a.type === "credit_card" ? -a.balance : a.balance),
              0,
            ) + hisaabAvailable;
            const oweTotal = oweAccounts.reduce((s, a) => s + a.balance, 0) + hisaabOwed;
            const hisaabHaveRows = hisaabIncluded.filter((h) => h.amount_sign === "positive");
            const hisaabOweRows = hisaabIncluded.filter((h) => h.amount_sign === "negative");
            return (
              <View
                className="mt-1 pl-3"
                style={{ borderLeftWidth: 2, borderLeftColor: colors.border, opacity: recomputing ? 0.55 : 1 }}
              >
                {/* Money available — bank + wallet + overpaid CCs + hisaab (positive) */}
                {(haveAccounts.length > 0 || hisaabHaveRows.length > 0) && (
                  <View className="mt-1 mb-2">
                    <View className="flex-row items-center justify-between mb-1">
                      <Text
                        className="text-[10px] font-semibold uppercase tracking-wider"
                        style={{ color: sc.success }}
                      >
                        Money available
                      </Text>
                      <Text className="text-xs font-bold" style={{ color: sc.success }}>
                        {formatAmount(haveTotal)}
                      </Text>
                    </View>
                    {haveAccounts.map((a) => {
                      // For an overpaid CC (negative utilized), the bank owes us — show
                      // the absolute value as positive available money.
                      const shownAmount =
                        a.type === "credit_card" ? Math.abs(a.balance) : a.balance;
                      const sublabel =
                        a.type === "savings"
                          ? "Savings"
                          : a.type === "wallet"
                            ? "Wallet"
                            : a.type === "credit_card"
                              ? "Credit card · overpaid"
                              : a.type;
                      return (
                        <View key={a.id} className="flex-row items-center justify-between py-1">
                          <View className="flex-1 mr-2">
                            <Text className="text-sm" style={{ color: colors.text }} numberOfLines={1}>
                              {a.label}
                            </Text>
                            <Text className="text-[10px]" style={{ color: colors.textSecondary }}>
                              {sublabel}
                            </Text>
                          </View>
                          <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                            {formatAmount(shownAmount)}
                          </Text>
                        </View>
                      );
                    })}
                    {hisaabHaveRows.map((h) => {
                      const person = hisaabPersonMap[h.person_id];
                      return (
                        <View key={h.person_id} className="flex-row items-center justify-between py-1">
                          <View className="flex-1 mr-2">
                            <Text className="text-sm" style={{ color: colors.text }} numberOfLines={1}>
                              {person?.name ?? "Hisaab person"}
                            </Text>
                            <Text className="text-[10px]" style={{ color: colors.textSecondary }}>
                              Hisaab · they owe you
                            </Text>
                          </View>
                          <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                            {formatAmount(h.amount)}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Money owed — credit cards.
                    v16.0.5 — CC balance semantics:
                      positive  = utilized → you owe the bank
                      zero      = no one owes anything
                      negative  = overpaid → the bank owes YOU
                    Previously this section unconditionally prefixed "−"
                    in front of the utilized number, so positive utilized
                    rendered as "−₹X" (double negation). Now the sign is
                    conveyed by the section ("Money owed") and the number
                    itself is shown as-is. Overpaid cards (balance < 0)
                    get flipped to the Money available section at the top. */}
                {(oweAccounts.length > 0 || hisaabOweRows.length > 0) && (
                  <View className="mt-2 mb-1 pt-2 border-t border-border">
                    <View className="flex-row items-center justify-between mb-1">
                      <Text
                        className="text-[10px] font-semibold uppercase tracking-wider"
                        style={{ color: sc.danger }}
                      >
                        Money owed
                      </Text>
                      <Text className="text-xs font-bold" style={{ color: sc.danger }}>
                        {formatAmount(oweTotal)}
                      </Text>
                    </View>
                    {oweAccounts.map((a) => (
                      <View key={a.id} className="flex-row items-center justify-between py-1">
                        <View className="flex-1 mr-2">
                          <Text className="text-sm" style={{ color: colors.text }} numberOfLines={1}>
                            {a.label}
                          </Text>
                          <Text className="text-[10px]" style={{ color: colors.textSecondary }}>
                            Credit card · utilized
                          </Text>
                        </View>
                        <Text className="text-sm font-semibold" style={{ color: sc.danger }}>
                          {formatAmount(a.balance)}
                        </Text>
                      </View>
                    ))}
                    {hisaabOweRows.map((h) => {
                      const person = hisaabPersonMap[h.person_id];
                      return (
                        <View key={h.person_id} className="flex-row items-center justify-between py-1">
                          <View className="flex-1 mr-2">
                            <Text className="text-sm" style={{ color: colors.text }} numberOfLines={1}>
                              {person?.name ?? "Hisaab person"}
                            </Text>
                            <Text className="text-[10px]" style={{ color: colors.textSecondary }}>
                              Hisaab · you owe
                            </Text>
                          </View>
                          <Text className="text-sm font-semibold" style={{ color: sc.danger }}>
                            {formatAmount(h.amount)}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Include hisaab launcher */}
                <Pressable
                  onPress={() => setHisaabSheetVisible(true)}
                  className="mt-2 pt-2 border-t border-border flex-row items-center justify-between py-1.5"
                  accessibilityRole="button"
                  accessibilityLabel="Include hisaab balances in this scenario"
                >
                  <View className="flex-row items-center flex-1">
                    <Ionicons name="people-outline" size={14} color={accent[500]} />
                    <Text className="ml-1.5 text-xs font-semibold" style={{ color: accent[500] }}>
                      {hisaabIncluded.length > 0
                        ? `Hisaab included · ${hisaabIncluded.length} ${hisaabIncluded.length === 1 ? "person" : "people"}`
                        : "Include hisaab balances"}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={accent[500]} />
                </Pressable>

                {/* Net reconciliation */}
                <View className="mt-2 pt-2 border-t border-border flex-row items-center justify-between">
                  <Text className="text-xs font-semibold" style={{ color: colors.text }}>
                    Net starting balance
                  </Text>
                  <Text className="text-sm font-bold" style={{ color: colors.text }}>
                    {formatAmount(adjustedNetStart)}
                  </Text>
                </View>
                <Text className="text-[10px] mt-2" style={{ color: colors.textSecondary }}>
                  Net = money available − money owed. Demat, pension, and loans are out of scope.
                </Text>
              </View>
            );
          })()}

          {/* v16.0.8 — PROJECTED BALANCE BREAKDOWN — collapsible drawer showing
              all accounts with their remaining balance till horizon date. */}
          <Pressable
            onPress={() => setExpandProjected((v) => !v)}
            className="flex-row items-center justify-between mt-4 pt-3 py-2 border-t border-border"
            accessibilityRole="button"
            accessibilityLabel={
              expandProjected
                ? "Hide projected balance breakdown"
                : "Show projected balance breakdown"
            }
          >
            <View className="flex-row items-center flex-1">
              <Ionicons
                name={expandProjected ? "chevron-down" : "chevron-forward"}
                size={14}
                color={colors.textSecondary}
              />
              <Text className="ml-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: colors.textSecondary }}>
                Remaining balance · {prettyDate(scenario.horizon_date)}
              </Text>
            </View>
            <Text className="text-sm font-semibold" style={{ color: colors.text }}>
              {formatAmount(adjustedNetEnd)}
            </Text>
          </Pressable>

          {expandProjected && (() => {
            // v16.0.8 — show ALL accounts, not just affected ones
            const allAccounts = baseline;
            const availRows = allAccounts.filter(
              (a) => a.type !== "credit_card" || a.balance < 0,
            );
            const owedRows = allAccounts.filter(
              (a) => a.type === "credit_card" && a.balance > 0,
            );
            const renderRow = (a: typeof allAccounts[number], idx: number, isOwed: boolean) => {
              const startVal = simulation.trajectory[0]?.byAccount[a.id] ?? a.balance;
              const endVal = simulation.endBalances[a.id] ?? a.balance;
              const accountDelta = endVal - startVal;
              const isGood = a.type === "credit_card" ? accountDelta < 0 : accountDelta >= 0;
              const rowDeltaColor = accountDelta === 0
                ? colors.textSecondary
                : isGood
                  ? sc.success
                  : sc.danger;
              const zebra = idx % 2 === 1
                ? { backgroundColor: colors.border + "33" }
                : undefined;
              return (
                <View
                  key={a.id}
                  className="flex-row items-center py-2 px-2 -mx-2 rounded-md"
                  style={{ opacity: recomputing ? 0.55 : 1, ...zebra }}
                >
                  <View className="flex-1">
                    <Text className="text-sm font-semibold" style={{ color: colors.text }} numberOfLines={1}>
                      {a.label}
                    </Text>
                    <Text className="text-[10px] mt-0.5" style={{ color: rowDeltaColor }}>
                      {accountDelta >= 0 ? "+" : ""}{formatAmount(Math.round(accountDelta))}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                      {formatAmount(endVal)}
                    </Text>
                  </View>
                </View>
              );
            };

            return (
              <View
                className="mt-1 pl-3"
                style={{ borderLeftWidth: 2, borderLeftColor: colors.border, opacity: recomputing ? 0.55 : 1 }}
              >
                {availRows.length > 0 && (
                  <View className="mt-1 mb-2">
                    <View className="flex-row items-center justify-between mb-1">
                      <Text
                        className="text-[10px] font-semibold uppercase tracking-wider"
                        style={{ color: sc.success }}
                      >
                        Money available
                      </Text>
                      <Text className="text-xs font-bold" style={{ color: sc.success }}>
                        {formatAmount(availRows.reduce((s, a) => {
                          const endVal = simulation.endBalances[a.id] ?? a.balance;
                          return s + (a.type === "credit_card" ? -endVal : endVal);
                        }, 0))}
                      </Text>
                    </View>
                    {availRows.map((a, i) => renderRow(a, i, false))}
                  </View>
                )}
                {owedRows.length > 0 && (
                  <View
                    className={availRows.length > 0 ? "pt-3 border-t border-border" : undefined}
                  >
                    <View className="flex-row items-center justify-between mb-1">
                      <Text
                        className="text-[10px] font-semibold uppercase tracking-wider"
                        style={{ color: sc.danger }}
                      >
                        Money owed · Credit cards
                      </Text>
                      <Text className="text-xs font-bold" style={{ color: sc.danger }}>
                        {formatAmount(owedRows.reduce((s, a) => s + (simulation.endBalances[a.id] ?? a.balance), 0))}
                      </Text>
                    </View>
                    {owedRows.map((a, i) => renderRow(a, i, true))}
                  </View>
                )}
              </View>
            );
          })()}
        </Card>


        {/* Stale entries card */}
        {entries.stale.length > 0 && (
          <Card className="mx-4 mt-5">
            <View className="flex-row items-center mb-2">
              <Ionicons name="alert-circle-outline" size={18} color={sc.warning} />
              <Text
                className="ml-2 text-sm font-semibold"
                style={{ color: colors.text }}
              >
                {entries.stale.length} planned {entries.stale.length === 1 ? "entry" : "entries"} may have passed
              </Text>
            </View>
            <Text className="text-xs mb-3" style={{ color: colors.textSecondary }}>
              These were planned for dates that have already gone by. Pick what
              happened for each one.
            </Text>
            {entries.stale.map((e) => (
              <Pressable
                key={e.id}
                onPress={() => setStaleSheetEntry(e)}
                className="flex-row items-center py-2 border-t border-border"
                accessibilityRole="button"
                accessibilityLabel={`Resolve stale entry ${e.description ?? e.merchant_name ?? "entry"}`}
              >
                <View className="flex-1">
                  <Text className="text-sm font-semibold" style={{ color: colors.text }} numberOfLines={1}>
                    {e.description || e.merchant_name || (e.category_id && categoryNameMap[e.category_id]) || "Planned entry"}
                  </Text>
                  <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                    Was due {prettyDate(e.date)}
                  </Text>
                </View>
                <Text
                  className="text-sm font-bold mx-2"
                  style={{ color: e.direction === "out" ? sc.danger : sc.success }}
                >
                  {e.direction === "out" ? "−" : "+"}
                  {formatAmount(e.amount)}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
              </Pressable>
            ))}
          </Card>
        )}

        {/* v16.0.4 — replaced the unreadable sparkline trajectory with a
            "Key moments" timeline. For each affected savings/wallet
            account, show the day it hits its LOWEST point and by how
            much. For each affected CC, show when it hits its HIGHEST
            utilized. These are the moments the user actually cares
            about: "when am I tightest?" and "when is my CC fullest?" */}
        {affectedAccounts.length > 0 && simulation.trajectory.length > 1 && (() => {
          const moments: Array<{
            accountId: string;
            label: string;
            kind: "lowest" | "highest_utilized";
            date: string;
            amount: number;
            todayAmount: number;
          }> = [];
          for (const a of affectedAccounts) {
            const todayVal = simulation.trajectory[0]?.byAccount[a.id] ?? a.balance;
            let extremeVal = todayVal;
            let extremeDate = simulation.trajectory[0]?.date ?? todayIso();
            for (const snap of simulation.trajectory) {
              const v = snap.byAccount[a.id];
              if (v == null) continue;
              if (a.type === "credit_card") {
                if (v > extremeVal) {
                  extremeVal = v;
                  extremeDate = snap.date;
                }
              } else {
                if (v < extremeVal) {
                  extremeVal = v;
                  extremeDate = snap.date;
                }
              }
            }
            // Only show when the extreme is materially different from
            // today (avoid "lowest: today, same amount" noise).
            const moved = Math.abs(extremeVal - todayVal) > 0.5;
            if (!moved) continue;
            moments.push({
              accountId: a.id,
              label: a.label,
              kind: a.type === "credit_card" ? "highest_utilized" : "lowest",
              date: extremeDate,
              amount: extremeVal,
              todayAmount: todayVal,
            });
          }
          if (moments.length === 0) return null;
          return (
            <View className="mt-5">
              <Text
                className="mx-4 text-xs font-bold uppercase tracking-wider mb-2"
                style={{ color: colors.textSecondary }}
              >
                Key moments
              </Text>
              <Card className="mx-4">
                {moments.map((m, i) => (
                  <View
                    key={m.accountId}
                    className="flex-row items-center py-2.5"
                    style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
                  >
                    <View
                      className="w-7 h-7 rounded-full items-center justify-center mr-2.5"
                      style={{
                        backgroundColor: m.kind === "highest_utilized" ? sc.danger + "14" : sc.warning + "14",
                      }}
                    >
                      <Ionicons
                        name={m.kind === "highest_utilized" ? "trending-up-outline" : "trending-down-outline"}
                        size={14}
                        color={m.kind === "highest_utilized" ? sc.danger : sc.warning}
                      />
                    </View>
                    <View className="flex-1 mr-2">
                      <Text className="text-sm font-semibold" style={{ color: colors.text }} numberOfLines={1}>
                        {m.label}
                      </Text>
                      <View
                        className="mt-1 px-1.5 py-0.5 rounded self-start"
                        style={{ backgroundColor: colors.border }}
                      >
                        <Text className="text-[10px] font-semibold" style={{ color: colors.textSecondary }}>
                          {m.kind === "highest_utilized" ? "Fullest" : "Lowest"} · {prettyDate(m.date)}
                        </Text>
                      </View>
                    </View>
                    <Text
                      className="text-xl font-bold"
                      style={{ color: m.kind === "highest_utilized" ? sc.danger : colors.text }}
                    >
                      {m.kind === "highest_utilized" ? "−" : ""}
                      {formatAmount(m.amount)}
                    </Text>
                  </View>
                ))}
              </Card>
            </View>
          );
        })()}

        {/* v16.0.5 — planned entries segregated by direction, each with
            internal date grouping. Outgoing + Incoming are separate
            mental buckets; showing them grouped keeps the "what's going
            out" / "what's coming in" story clear. */}
        {entries.upcoming.length === 0 ? (
          <>
            <View className="mx-4 mt-5 mb-1 flex-row items-center">
              <Text
                className="text-xs font-bold uppercase tracking-wider"
                style={{ color: colors.textSecondary }}
              >
                Planned entries
              </Text>
            </View>
            <View className="items-center justify-center px-6 mt-4 mb-3">
              <View
                className="w-14 h-14 rounded-full items-center justify-center mb-3"
                style={{ backgroundColor: ac(accent, colorScheme, 50, 900) }}
              >
                <Ionicons name="calendar-outline" size={26} color={accent[500]} />
              </View>
              <Text className="text-sm font-semibold text-center" style={{ color: colors.text }}>
                Nothing planned yet
              </Text>
              <Text className="text-xs text-center mt-1.5 leading-4" style={{ color: colors.textSecondary }}>
                Tap the + button to add outgoings or incomings you expect before
                {" "}
                {prettyDate(scenario.horizon_date)}.
              </Text>
            </View>
          </>
        ) : (
          <>
            {outgoingEntries.length > 0 && (
              <View className="mt-5">
                {/* Section header — direction + count + total. v16.0.8 — collapsible. */}
                <Pressable
                  onPress={() => setExpandOutgoing((v) => !v)}
                  className="mx-4 mb-2 flex-row items-center justify-between"
                  accessibilityRole="button"
                  accessibilityLabel={expandOutgoing ? "Hide outgoing entries" : "Show outgoing entries"}
                >
                  <View className="flex-row items-center">
                    <Ionicons name={expandOutgoing ? "chevron-down" : "chevron-forward"} size={14} color={colors.textSecondary} />
                    <View
                      className="w-6 h-6 rounded-full items-center justify-center ml-2"
                      style={{ backgroundColor: sc.danger + "14" }}
                    >
                      <Ionicons name="arrow-up" size={12} color={sc.danger} />
                    </View>
                    <Text
                      className="ml-2 text-xs font-bold uppercase tracking-wider"
                      style={{ color: colors.textSecondary }}
                    >
                      Outgoing
                    </Text>
                    <View
                      className="ml-2 px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: colors.border }}
                    >
                      <Text className="text-[10px] font-semibold" style={{ color: colors.textSecondary }}>
                        {outgoingEntries.length}
                      </Text>
                    </View>
                  </View>
                  <Text className="text-xs font-bold" style={{ color: sc.danger }}>
                    −{formatAmount(outgoingTotal)}
                  </Text>
                </Pressable>
                {expandOutgoing && (
                  <>
                    <EntryGroup label="Today" items={outgoingGrouped.today} accounts={accounts} onTap={(e) => { router.push({ pathname: "/simulator/[id]/entry", params: { id, entryId: e.id } } as never); }} onLongPress={handleEntryLongPress} onDuplicate={handleDuplicateEntry} personMap={hisaabPersonMap} categoryNames={categoryNameMap} direction="out" />
                    <EntryGroup label="Tomorrow" items={outgoingGrouped.tomorrow} accounts={accounts} onTap={(e) => { router.push({ pathname: "/simulator/[id]/entry", params: { id, entryId: e.id } } as never); }} onLongPress={handleEntryLongPress} onDuplicate={handleDuplicateEntry} personMap={hisaabPersonMap} categoryNames={categoryNameMap} direction="out" />
                    <EntryGroup label="This week" items={outgoingGrouped.thisWeek} accounts={accounts} onTap={(e) => { router.push({ pathname: "/simulator/[id]/entry", params: { id, entryId: e.id } } as never); }} onLongPress={handleEntryLongPress} onDuplicate={handleDuplicateEntry} personMap={hisaabPersonMap} categoryNames={categoryNameMap} direction="out" />
                    <EntryGroup label="Later" items={outgoingGrouped.later} accounts={accounts} onTap={(e) => { router.push({ pathname: "/simulator/[id]/entry", params: { id, entryId: e.id } } as never); }} onLongPress={handleEntryLongPress} onDuplicate={handleDuplicateEntry} personMap={hisaabPersonMap} categoryNames={categoryNameMap} direction="out" />
                  </>
                )}
              </View>
            )}
            {incomingEntries.length > 0 && (
              <View className="mt-5">
                {/* Section header — direction + count + total. v16.0.8 — collapsible. */}
                <Pressable
                  onPress={() => setExpandIncoming((v) => !v)}
                  className="mx-4 mb-2 flex-row items-center justify-between"
                  accessibilityRole="button"
                  accessibilityLabel={expandIncoming ? "Hide incoming entries" : "Show incoming entries"}
                >
                  <View className="flex-row items-center">
                    <Ionicons name={expandIncoming ? "chevron-down" : "chevron-forward"} size={14} color={colors.textSecondary} />
                    <View
                      className="w-6 h-6 rounded-full items-center justify-center ml-2"
                      style={{ backgroundColor: sc.success + "14" }}
                    >
                      <Ionicons name="arrow-down" size={12} color={sc.success} />
                    </View>
                    <Text
                      className="ml-2 text-xs font-bold uppercase tracking-wider"
                      style={{ color: colors.textSecondary }}
                    >
                      Incoming
                    </Text>
                    <View
                      className="ml-2 px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: colors.border }}
                    >
                      <Text className="text-[10px] font-semibold" style={{ color: colors.textSecondary }}>
                        {incomingEntries.length}
                      </Text>
                    </View>
                  </View>
                  <Text className="text-xs font-bold" style={{ color: sc.success }}>
                    +{formatAmount(incomingTotal)}
                  </Text>
                </Pressable>
                {expandIncoming && (
                  <>
                    <EntryGroup label="Today" items={incomingGrouped.today} accounts={accounts} onTap={(e) => { router.push({ pathname: "/simulator/[id]/entry", params: { id, entryId: e.id } } as never); }} onLongPress={handleEntryLongPress} onDuplicate={handleDuplicateEntry} personMap={hisaabPersonMap} categoryNames={categoryNameMap} direction="in" />
                    <EntryGroup label="Tomorrow" items={incomingGrouped.tomorrow} accounts={accounts} onTap={(e) => { router.push({ pathname: "/simulator/[id]/entry", params: { id, entryId: e.id } } as never); }} onLongPress={handleEntryLongPress} onDuplicate={handleDuplicateEntry} personMap={hisaabPersonMap} categoryNames={categoryNameMap} direction="in" />
                    <EntryGroup label="This week" items={incomingGrouped.thisWeek} accounts={accounts} onTap={(e) => { router.push({ pathname: "/simulator/[id]/entry", params: { id, entryId: e.id } } as never); }} onLongPress={handleEntryLongPress} onDuplicate={handleDuplicateEntry} personMap={hisaabPersonMap} categoryNames={categoryNameMap} direction="in" />
                    <EntryGroup label="Later" items={incomingGrouped.later} accounts={accounts} onTap={(e) => { router.push({ pathname: "/simulator/[id]/entry", params: { id, entryId: e.id } } as never); }} onLongPress={handleEntryLongPress} onDuplicate={handleDuplicateEntry} personMap={hisaabPersonMap} categoryNames={categoryNameMap} direction="in" />
                  </>
                )}
              </View>
            )}
          </>
        )}

        {/* Planned vs Actual summary card */}
        {fulfilledSummary && fulfilledSummary.entries.length > 0 && (
          <Card className="mx-4 mt-4">
            <Text className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: colors.textSecondary }}>
              Planned vs Actual
            </Text>
            <View className="flex-row justify-between">
              <View>
                <Text className="text-[10px]" style={{ color: colors.textSecondary }}>Planned</Text>
                <Text className="text-sm font-bold" style={{ color: colors.text }}>{formatAmount(fulfilledSummary.totalPlanned)}</Text>
              </View>
              <View className="items-center">
                <Text className="text-[10px]" style={{ color: colors.textSecondary }}>Actual</Text>
                <Text className="text-sm font-bold" style={{ color: colors.text }}>{formatAmount(fulfilledSummary.totalActual)}</Text>
              </View>
              <View className="items-end">
                <Text className="text-[10px]" style={{ color: colors.textSecondary }}>Variance</Text>
                <Text className="text-sm font-bold" style={{ color: fulfilledSummary.variance > 0 ? sc.danger : fulfilledSummary.variance < 0 ? sc.success : colors.textSecondary }}>
                  {fulfilledSummary.variance > 0 ? "+" : ""}{formatAmount(fulfilledSummary.variance)}
                </Text>
              </View>
            </View>
            <Pressable onPress={() => setExpandSummary(!expandSummary)} className="mt-2 pt-2 border-t border-border items-center">
              <Text className="text-xs font-medium" style={{ color: accent[500] }}>
                {expandSummary ? "Hide breakdown" : "Show breakdown"}
              </Text>
            </Pressable>
            {expandSummary && (
              <View className="mt-2">
                {fulfilledSummary.entries.map((item) => (
                  <View key={item.entryId} className="flex-row items-center py-1.5 border-t border-border">
                    <Text className="text-xs flex-1" style={{ color: colors.text }} numberOfLines={1}>
                      {item.description || item.merchant_name || "Entry"}
                    </Text>
                    <Text className="text-[10px] w-14 text-right" style={{ color: colors.textSecondary }}>{formatAmount(item.planned)}</Text>
                    <Text className="text-[10px] w-14 text-right" style={{ color: colors.text }}>{formatAmount(item.actual)}</Text>
                    <Text className="text-[10px] w-14 text-right" style={{ color: item.variance > 0 ? sc.danger : item.variance < 0 ? sc.success : colors.textSecondary }}>
                      {item.variance > 0 ? "+" : ""}{formatAmount(item.variance)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </Card>
        )}

        {/* Fulfilled entries */}
        {entries.fulfilled.length > 0 && (
          <View className="mt-4">
            <Text
              className="mx-4 text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: colors.textSecondary }}
            >
              Already happened · {entries.fulfilled.length}
            </Text>
            {entries.fulfilled.map((e) => {
              const isExpanded = expandedFulfilledId === e.id;
              const details = fulfillmentDetails[e.id];
              const actualTotal = details ? details.reduce((s, f) => s + f.amount, 0) : null;
              const entryVariance = actualTotal !== null ? actualTotal - e.amount : null;
              return (
                <View key={e.id}>
                  <Pressable
                    onPress={async () => {
                      if (isExpanded) {
                        setExpandedFulfilledId(null);
                      } else {
                        setExpandedFulfilledId(e.id);
                        if (!fulfillmentDetails[e.id]) {
                          const d = await getEntryFulfillments(e.id);
                          setFulfillmentDetails((prev) => ({ ...prev, [e.id]: d }));
                        }
                      }
                    }}
                    onLongPress={() => handleEntryLongPress(e)}
                    className="flex-row items-center mx-4 py-2.5 px-3 rounded-xl mb-1"
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: isExpanded ? accent[500] + "55" : colors.border,
                      opacity: isExpanded ? 1 : 0.75,
                    }}
                    accessibilityRole="button"
                  >
                    <Ionicons name="checkmark-circle" size={16} color={sc.success} />
                    <View className="flex-1 ml-2">
                      <Text className="text-sm" style={{ color: colors.text }} numberOfLines={1}>
                        {e.description || e.merchant_name || (e.category_id && categoryNameMap[e.category_id]) || "Planned entry"}
                      </Text>
                      <View className="flex-row items-center mt-0.5">
                        <Text className="text-xs" style={{ color: colors.textSecondary }}>
                          Planned: {formatAmount(e.amount)}
                        </Text>
                        {entryVariance !== null && entryVariance !== 0 && (
                          <Text className="text-xs ml-2" style={{ color: entryVariance > 0 ? sc.danger : sc.success }}>
                            {entryVariance > 0 ? "+" : ""}{formatAmount(entryVariance)}
                          </Text>
                        )}
                      </View>
                    </View>
                    {actualTotal !== null ? (
                      <Text className="text-sm font-semibold mr-1" style={{ color: colors.text }}>
                        {formatAmount(actualTotal)}
                      </Text>
                    ) : (
                      <Text className="text-sm font-semibold mr-1" style={{ color: colors.text }}>
                        {formatAmount(e.amount)}
                      </Text>
                    )}
                    <Ionicons name={isExpanded ? "chevron-down" : "chevron-forward"} size={14} color={colors.textSecondary} />
                  </Pressable>

                  {/* Inline expansion: linked transactions + link more */}
                  {isExpanded && (
                    <View className="mx-4 ml-10 mb-2">
                      {details && details.length > 0 ? details.map((f) => (
                        <Pressable
                          key={f.id}
                          onPress={() => router.push({ pathname: "/expense/[id]", params: { id: f.expense_id } } as never)}
                          className="flex-row items-center py-2 px-2 rounded-lg mb-1"
                          style={{ backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border }}
                        >
                          <Ionicons name="receipt-outline" size={14} color={colors.textSecondary} />
                          <View className="flex-1 ml-2">
                            <Text className="text-xs" style={{ color: colors.text }} numberOfLines={1}>
                              {f.merchant_name || f.description || "Transaction"}
                            </Text>
                            <Text className="text-[10px]" style={{ color: colors.textSecondary }}>
                              {prettyDate(f.date)}
                            </Text>
                          </View>
                          <Text className="text-xs font-semibold" style={{ color: colors.text }}>
                            {formatAmount(f.amount)}
                          </Text>
                          <Ionicons name="chevron-forward" size={12} color={colors.textSecondary} style={{ marginLeft: 4 }} />
                        </Pressable>
                      )) : (
                        <Text className="text-xs py-2" style={{ color: colors.textSecondary }}>
                          No transactions linked yet.
                        </Text>
                      )}
                      <Pressable
                        onPress={() => setStaleSheetEntry(e)}
                        className="flex-row items-center justify-center py-2 mt-1 rounded-lg"
                        style={{ borderWidth: 1, borderColor: accent[500] + "44", borderStyle: "dashed" }}
                      >
                        <Ionicons name="add-circle-outline" size={14} color={accent[500]} />
                        <Text className="text-xs font-medium ml-1" style={{ color: accent[500] }}>
                          {details && details.length > 0 ? "Link more transactions" : "Link transactions"}
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* v16.0.5 — hide FAB while any sheet/modal is open. Android's elevation
          renders the FAB above transparent modals, which was making the "+"
          button visible through the bottom edge of the Add-Entry sheet. */}
      {staleSheetEntry === null && !renameVisible
        && !horizonPickerVisible && !menuVisible && !hisaabSheetVisible && (
        <FAB
          icon="add"
          onPress={() => {
            router.push({
              pathname: "/simulator/[id]/entry",
              params: { id }
            } as never);
          }}
        />
      )}

      <StaleEntryResolveSheet
        visible={staleSheetEntry !== null}
        entry={staleSheetEntry}
        userId={DEFAULT_USER_ID}
        onReschedule={handleReschedule}
        onLinkFulfillment={handleFulfill}
        onRemove={handleDismissStale}
        onClose={() => setStaleSheetEntry(null)}
      />

      <HisaabInclusionSheet
        visible={hisaabSheetVisible}
        scenarioId={scenario.id}
        userId={DEFAULT_USER_ID}
        onSaved={() => load(true)}
        onClose={() => setHisaabSheetVisible(false)}
      />

      {/* Rename */}
      <RenameScenarioModal
        visible={renameVisible}
        initialName={scenario.name}
        onSave={async (newName) => {
          await updateScenario(scenario.id, { name: newName });
          setRenameVisible(false);
          await load(true);
        }}
        onClose={() => setRenameVisible(false)}
      />

      {/* Horizon date picker */}
      <CalendarModal
        visible={horizonPickerVisible}
        onClose={() => setHorizonPickerVisible(false)}
        value={scenario.horizon_date}
        onChange={async (d) => {
          setHorizonPickerVisible(false);
          await updateScenario(scenario.id, { horizon_date: d });
          await load(true);
        }}
        minimumDate={new Date()}
        maximumDate={null}
      />

      {/* Menu */}
      <Modal transparent visible={menuVisible} animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <Pressable
          className="flex-1 bg-black/40 items-center justify-end"
          onPress={() => setMenuVisible(false)}
          accessibilityLabel="Close menu"
        >
          <View
            className="w-full pb-8 pt-2"
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
            }}
            onStartShouldSetResponder={() => true}
          >
            <View className="items-center pt-1 pb-2">
              <View className="w-10 h-1 rounded-full bg-border" />
            </View>
            <MenuItem icon="pencil-outline" label="Rename" onPress={() => { setMenuVisible(false); setRenameVisible(true); }} />
            <MenuItem icon="refresh-outline" label="Re-seed from reminders" onPress={handleReseed} />
            {/* v16.0.5 — isDefault guard dropped. The v16.0.0 auto-created
                default scenario is now removable; there's no auto-seed
                to re-create it. */}
            <MenuItem icon="checkmark-circle-outline" label="Mark done" onPress={handleArchive} />
            <MenuItem icon="trash-outline" label="Delete scenario" danger onPress={handleDeleteScenario} />
          </View>
        </Pressable>
      </Modal>
    </ScreenContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers (inline)
// ═══════════════════════════════════════════════════════════════════════

function MenuItem({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const { colors } = useColorScheme();
  const { colorScheme } = useColorScheme();
  const sc = StatusColors[colorScheme];
  return (
    <Pressable onPress={onPress} className="flex-row items-center px-5 py-3">
      <Ionicons name={icon} size={18} color={danger ? sc.danger : colors.textSecondary} />
      <Text
        className="ml-3 text-sm"
        style={{ color: danger ? sc.danger : colors.text }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function EntryGroup({
  label,
  items,
  accounts,
  onTap,
  onLongPress,
  onDuplicate,
  personMap,
  categoryNames,
  total,
  direction,
}: {
  label: string;
  items: SimulationEntry[];
  accounts: FinancialAccount[];
  onTap: (e: SimulationEntry) => void;
  onLongPress: (e: SimulationEntry) => void;
  onDuplicate: (id: string) => void;
  personMap: Record<string, HisaabPerson>;
  categoryNames?: Record<string, string>;
  total?: number;
  direction?: "out" | "in";
}) {
  const { colors, accent, colorScheme } = useColorScheme();
  const sc = StatusColors[colorScheme];
  if (items.length === 0) return null;
  const groupTotal = total ?? items.reduce((s, e) => s + e.amount, 0);
  const totalColor = direction === "out" ? sc.danger : direction === "in" ? sc.success : colors.text;
  const totalPrefix = direction === "out" ? "−" : direction === "in" ? "+" : "";
  return (
    <View className="mt-3">
      {/* v16.0.5 — stronger header: text-xs bold + count chip. v16.0.8 — added total. */}
      <View className="mx-4 mb-1.5 flex-row items-center justify-between">
        <View className="flex-row items-center" style={{ flexShrink: 0 }}>
          <Text
            className="text-xs font-bold uppercase tracking-wider"
            style={{ color: colors.textSecondary }}
            numberOfLines={1}
          >
            {label}
          </Text>
          <View
            className="ml-2 px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: colors.border }}
          >
            <Text className="text-[10px] font-semibold" style={{ color: colors.textSecondary }}>
              {items.length}
            </Text>
          </View>
        </View>
        {direction && (
          <Text
            className="text-xs font-bold ml-2"
            style={{ color: totalColor, flexShrink: 1 }}
            numberOfLines={1}
          >
            {totalPrefix}{formatAmount(groupTotal)}
          </Text>
        )}
      </View>
      {items.map((e) => {
        const acct = accounts.find((a) => a.id === e.account_id);
        const acctLabel = acct
          ? acct.account_label ?? `${acct.bank_name} ••${acct.account_identifier}`
          : null;
        // v16.0.5 — hisaab planned entries get a "from/to <person>" sublabel.
        const hisaabPerson = e.hisaab_person_id ? personMap[e.hisaab_person_id] : undefined;
        const hisaabLabel =
          e.hisaab_kind === "collect" && hisaabPerson
            ? `Collect from ${hisaabPerson.name}`
            : e.hisaab_kind === "payback" && hisaabPerson
              ? `Pay back to ${hisaabPerson.name}`
              : null;
        const titleOverride = hisaabLabel && !e.merchant_name && !e.description ? hisaabLabel : null;
        // v16.0.5 — source as a colored dot, not a text tag. Rarely
        // matters enough to spend a line on.
        // v16.0.7 — dot is ONLY shown for auto-seeded entries (reminders
        // or CC forecasts). Manual entries don't need a colored marker;
        // the grey dot above the direction icon was noise for the most
        // common case. Null = no dot, skipped below.
        const sourceColor =
          e.source === "seeded_reminder"
            ? accent[500]
            : e.source === "seeded_forecast"
              ? sc.warning
              : null;
        return (
          <Pressable
            key={e.id}
            onPress={() => onTap(e)}
            onLongPress={() => onLongPress(e)}
            className="flex-row items-center mx-4 py-2.5 px-3 rounded-xl mb-1"
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            {/* Direction arrow (+ optional auto-seed source dot above). */}
            <View className="mr-3 items-center">
              {sourceColor && (
                <View
                  className="w-1.5 h-1.5 rounded-full mb-0.5"
                  style={{ backgroundColor: sourceColor }}
                />
              )}
              <View
                className="w-7 h-7 rounded-full items-center justify-center"
                style={{
                  backgroundColor:
                    e.direction === "out" ? sc.danger + "14" : sc.success + "14",
                }}
              >
                <Ionicons
                  name={e.direction === "out" ? "arrow-up" : "arrow-down"}
                  size={12}
                  color={e.direction === "out" ? sc.danger : sc.success}
                />
              </View>
            </View>
            <View className="flex-1">
              <Text className="text-sm font-semibold" style={{ color: colors.text }} numberOfLines={1}>
                {titleOverride ?? e.description ?? e.merchant_name ?? (e.category_id && categoryNames?.[e.category_id]) ?? (e.direction === "out" ? "Outgoing" : "Incoming")}
              </Text>
              {/* Sublabel priority: hisaab → account + date. */}
              <View className="flex-row items-center mt-0.5 flex-wrap">
                {hisaabLabel && titleOverride == null ? (
                  <Text className="text-[10px]" style={{ color: accent[500] }} numberOfLines={1}>
                    {hisaabLabel}
                  </Text>
                ) : acctLabel ? (
                  <Text className="text-[10px]" style={{ color: colors.textSecondary }} numberOfLines={1}>
                    {acctLabel}
                  </Text>
                ) : null}
                <Text className="text-[10px]" style={{ color: colors.textSecondary }}>
                  {(hisaabLabel || acctLabel) ? "  ·  " : ""}{prettyDate(e.date)}
                </Text>
              </View>
            </View>
            <Text
              className="text-sm font-semibold ml-2"
              style={{ color: e.direction === "out" ? sc.danger : sc.success }}
            >
              {e.direction === "out" ? "−" : "+"}
              {formatAmount(e.amount)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function RenameScenarioModal({
  visible,
  initialName,
  onSave,
  onClose,
}: {
  visible: boolean;
  initialName: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const { colors, accent } = useColorScheme();
  const [name, setName] = useState(initialName);
  useEffect(() => {
    if (visible) setName(initialName);
  }, [visible, initialName]);
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable
        className="flex-1 bg-black/40 items-center justify-center px-6"
        onPress={onClose}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: 20,
            width: "100%",
            maxWidth: 400,
          }}
        >
          <Text className="text-base font-bold mb-2" style={{ color: colors.text }}>
            Rename scenario
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            className="border border-border rounded-lg px-3 py-2.5 text-sm"
            style={{ color: colors.text }}
            autoFocus
          />
          <View className="flex-row mt-3 gap-3">
            <Pressable
              onPress={onClose}
              className="flex-1 py-2.5 rounded-lg items-center"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
            >
              <Text className="text-sm" style={{ color: colors.textSecondary }}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onSave(name.trim())}
              disabled={!name.trim()}
              className="flex-1 py-2.5 rounded-lg items-center"
              style={{ backgroundColor: accent[500], opacity: name.trim() ? 1 : 0.5 }}
            >
              <Text className="text-sm font-semibold text-white">Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
