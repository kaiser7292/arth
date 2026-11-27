import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, ScreenContainer, Text } from "@/components/ui";
import { LinkRow } from "@/components/ui/LinkRow";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useAlert } from "@/hooks/use-alert";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { recordBalanceDifference } from "@/services/balance-update";
import { getHealthReport, type HealthReport } from "@/services/corrections/health";
import { addFixHistory } from "@/services/corrections/snapshot";
import { historyLine, useFixUndo } from "@/components/ai/useFixUndo";
import { formatDisplayDate } from "@/utils/date";
import { formatAmount } from "@/utils/format";
import { logger } from "@/utils/logger";

/**
 * Settings → Data health (docs/AI_CORRECTIONS_DESIGN.md, docs/AI_HUB_PROPOSAL.md §8): what Arth
 * sees is wrong, with a way to each fix, and the latest fix done with Undo. The route keeps its old
 * name (fix-my-data) so links keep working. Fixing it all with your AI assistant
 * (share, paste, review, apply) is on Ask your AI assistant (app/settings/ai-request.tsx).
 */




export default function FixMyDataScreen() {
  const router = useRouter();
  const theme = useTheme();
  const alert = useAlert();
  const [health, setHealth] = useState<HealthReport | null>(null);
  // Fixes done: the latest here, all of them in What AI changed (docs/AI_HUB_PROPOSAL.md §8).
  const { history, undoable, undoing, undo, refresh: refreshHistory } = useFixUndo();
  const [showGaps, setShowGaps] = useState(false);
  const [matching, setMatching] = useState<string | null>(null);

  const [healthFailed, setHealthFailed] = useState(false);
  const loadHealth = useCallback(async () => {
    try {
      setHealth(await getHealthReport(DEFAULT_USER_ID));
      setHealthFailed(false);
    } catch (e) {
      logger.warn("Data health failed", e);
      setHealthFailed(true);
    }
    refreshHistory();
  }, [refreshHistory]);
  useDataRefresh(loadHealth);

  const matchBank = (accountId: string, name: string, bank: number, arth: number) => {
    alert(
      `Match ${name} to ${formatAmount(bank)}?`,
      `Arth adds a ${formatAmount(Math.abs(bank - arth))} adjustment, counted as ${bank < arth ? "money out (not against your budget)" : "money in"}. You can delete it from the ledger.`,
      [
      { text: "Cancel", style: "cancel" },
      {
        text: "Match",
        onPress: async () => {
          setMatching(accountId);
          try {
            await recordBalanceDifference(
              DEFAULT_USER_ID,
              { accountId, kind: "balance", current: arth, limit: null },
              bank,
              "Matched to the bank (Data health)",
            );
            addFixHistory({
              kind: "match",
              at: new Date().toISOString(),
              title: `${name} matched to ${formatAmount(bank)}`,
              changes: 1,
              groups: [],
              moved: [{ label: name, before: arth, value: bank, unit: "money" }],
              failed: 0,
            });
            refreshHistory();
            await loadHealth();
          } catch (e) {
            alert("Couldn't match it", e instanceof Error ? e.message : "Try again.");
          } finally {
            setMatching(null);
          }
        },
      },
    ]);
  };

  // ── Data health, and the way to fix it all with your AI assistant ─────────────
  const issues = health?.checks.filter((c) => c.count > 0) ?? [];
  const clean = health?.checks.filter((c) => c.count === 0) ?? [];
  const scoreColor = !health ? theme.foreground : health.score >= 90 ? theme.success : health.score >= 70 ? theme.warning : theme.danger;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">

        {/* Board "Fix my data": one card, how many to fix and how many areas are clean, then each issue */}
        <Card className="mb-3">
          <View className="flex-row items-end">
            <View className="flex-1">
              <Text className="text-meta text-muted-foreground">Data health</Text>
              {!health && healthFailed ? (
                <Pressable onPress={() => void loadHealth()} className="mt-2 self-start" accessibilityRole="button">
                  <Text className="text-meta" style={{ color: theme.danger }}>
                    Couldn&apos;t check your data. <Text className="text-meta font-semibold" style={{ color: theme.primary }}>Try again</Text>
                  </Text>
                </Pressable>
              ) : !health ? (
                <ActivityIndicator className="mt-2 self-start" color={theme.primary} />
              ) : (
                <Text className="text-title font-bold" style={{ color: scoreColor }}>
                  {issues.length === 0 ? "All tidy" : `${issues.reduce((n, c) => n + c.count, 0).toLocaleString("en-IN")} to fix`}
                </Text>
              )}
            </View>
            {health && (
              <Text className="text-meta text-muted-foreground text-right">
                {health.score}% tidy{"\n"}
                {clean.length} area{clean.length === 1 ? "" : "s"} all fixed
              </Text>
            )}
          </View>
          {issues.map((c) => {
            const isGaps = c.id === "balance_gaps";
            return (
              <View key={c.id} className="py-3 border-t border-border">
                <Pressable
                  onPress={() =>
                    isGaps ? setShowGaps((v) => !v) : router.push({ pathname: "/settings/data-health-issue", params: { check: c.id } })
                  }
                  className="flex-row items-center"
                  accessibilityRole="button"
                >
                  <View className="w-8 h-8 rounded-control items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("warning", 0.12) }}>
                    <Ionicons name="alert-circle-outline" size={17} color={theme.warning} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-body font-semibold text-foreground">{c.label}</Text>
                    <Text className="text-meta text-muted-foreground mt-0.5">{c.hint}</Text>
                  </View>
                  <View className="rounded-pill px-2 justify-center mr-1.5" style={{ height: 24, backgroundColor: theme.alpha("warning", 0.12) }}>
                    <Text className="text-label font-bold" style={{ color: theme.warning }}>{c.count > 999 ? "999+" : c.count}</Text>
                  </View>
                  <Ionicons name={isGaps && showGaps ? "chevron-up" : isGaps ? "chevron-down" : "chevron-forward"} size={15} color={theme.mutedForeground} />
                </Pressable>
                {isGaps && showGaps &&
                  health?.balanceGaps.map((g) => (
                    <View key={g.accountId} className="mt-3 pt-3 border-t border-border">
                      <Pressable
                        onPress={() => router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: g.accountId } })}
                        className="flex-row items-center"
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${g.name}'s ledger`}
                      >
                        <Text className="text-meta text-foreground flex-1">{g.name}</Text>
                        <Text className="text-label font-semibold" style={{ color: theme.primary }}>Ledger</Text>
                      </Pressable>
                      <Text className="text-label text-muted-foreground mt-0.5">
                        Bank said {formatAmount(g.bank)} on {formatDisplayDate(g.bankDate)}; Arth makes it {formatAmount(g.arth)} ({g.gap > 0 ? "+" : "−"}
                        {formatAmount(Math.abs(g.gap))})
                      </Text>
                      <Pressable
                        onPress={() => matchBank(g.accountId, g.name, g.bank, g.arth)}
                        disabled={matching === g.accountId}
                        className="self-start mt-2 px-3 py-1.5 rounded-full"
                        style={{ backgroundColor: theme.alpha("primary", 0.12) }}
                        accessibilityRole="button"
                      >
                        <Text className="text-label font-semibold" style={{ color: theme.primary }}>
                          {matching === g.accountId ? "Matching…" : "Match the bank"}
                        </Text>
                      </Pressable>
                    </View>
                  ))}
              </View>
            );
          })}

        </Card>
        {clean.length > 0 && (
          <Text className="text-label text-muted-foreground mb-3 mt-1">
            All good: {clean.map((c) => c.label.toLowerCase()).join(", ")}.
          </Text>
        )}

        <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-2 mt-3">Fix everything with your AI</Text>
        <View className="rounded-card bg-card border border-border overflow-hidden mb-3">
          <LinkRow
            divider={false}
            icon="sparkles-outline"
            color={theme.primary}
            title="Fix it all with your AI assistant"
            sub="Share your whole history, paste the reply, check every change. With Undo."
            onPress={() => router.push({ pathname: "/settings/ai-request", params: { focus: "fix" } })}
          />
        </View>

        <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-2 mt-3">Fixes done</Text>
        <View className="rounded-card bg-card border border-border overflow-hidden mb-3">
          {history.length === 0 ? (
            <LinkRow divider={false} icon="time-outline" title="No fixes yet" sub="AI fixes and bank matches show here, with Undo." />
          ) : (
            <>
              {/* The latest, and the one that can still be undone when a bank match came after it. */}
              {[history[0], ...(undoable && undoable.id !== history[0].id ? [undoable] : [])].map((e, i) => {
                const canUndo = undoable?.id === e.id;
                return (
                  <LinkRow
                    key={e.id}
                    divider={i > 0}
                    icon={e.kind === "match" ? "swap-horizontal-outline" : "sparkles-outline"}
                    color={e.undoneAt ? undefined : theme.primary}
                    title={e.title}
                    sub={historyLine(e, canUndo)}
                    right={
                      canUndo ? (
                        <Pressable onPress={() => void undo()} hitSlop={8} disabled={undoing} accessibilityRole="button" accessibilityLabel={`Undo ${e.title}`}>
                          <Text className="text-body font-semibold" style={{ color: theme.primary }}>
                            {undoing ? "Undoing…" : "Undo"}
                          </Text>
                        </Pressable>
                      ) : undefined
                    }
                    onPress={() => router.push("/settings/ai-history")}
                  />
                );
              })}
              <LinkRow
                icon="list-outline"
                title="See all"
                sub={`${history.length} in What AI changed`}
                onPress={() => router.push("/settings/ai-history")}
              />
            </>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
