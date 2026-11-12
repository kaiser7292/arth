import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import * as Clipboard from "expo-clipboard";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useAlert } from "@/hooks/use-alert";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { adjustAccountAvailable } from "@/services/account-balance";
import { applyCorrections, type CorrectionsResult } from "@/services/corrections/apply";
import { buildFixExport, shareFixExport, type FixExport } from "@/services/corrections/export";
import { DELIBERATE, GROUP_LABELS, APPLY_ORDER } from "@/services/corrections/format";
import { getHealthReport, type HealthCheckId, type HealthReport } from "@/services/corrections/health";
import type { MetricChange } from "@/services/corrections/impact";
import { readCorrections, type CorrectionsReply, type Fix } from "@/services/corrections/read";
import { getLastCorrection, undoLastCorrection, type LastCorrection } from "@/services/corrections/snapshot";
import { formatDisplayDate } from "@/utils/date";
import { formatAmount } from "@/utils/format";
import { logger } from "@/utils/logger";

/**
 * Settings → Fix my data (docs/AI_CORRECTIONS_DESIGN.md). Data health first: what Arth sees is
 * wrong, with a way to each fix. Then the round trip with the user's own AI: share the whole
 * history, paste back its correction file, review, apply everywhere, see what moved, undo.
 */

type Phase = "home" | "review" | "applying" | "done";

const ROUTES: Partial<Record<HealthCheckId, Href>> = {
  uncategorised: { pathname: "/expense/review-queue", params: { filter: "uncategorized" } },
  duplicates: { pathname: "/expense/review-queue", params: { filter: "duplicates" } },
  overdue_dues: { pathname: "/expense/review-queue", params: { filter: "overdue" } },
  transfers: "/settings/transfer-review",
  merchant_spellings: "/settings/merchants",
  merchant_categories: "/settings/merchants",
  account_types: "/settings/account-master",
  no_account: "/settings/account-master",
};

function showMetric(m: { unit: string }, v: number): string {
  if (m.unit === "money") return formatAmount(v);
  if (m.unit === "percent") return `${Math.round(v * 10) / 10}%`;
  return String(Math.round(v));
}

export default function FixMyDataScreen() {
  const router = useRouter();
  const theme = useTheme();
  const alert = useAlert();
  const [phase, setPhase] = useState<Phase>("home");
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [last, setLast] = useState<LastCorrection | null>(getLastCorrection());
  const [showGaps, setShowGaps] = useState(false);
  const [matching, setMatching] = useState<string | null>(null);

  const [includePeople, setIncludePeople] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [file, setFile] = useState<FixExport | null>(null);

  const [pasted, setPasted] = useState("");
  const [reading, setReading] = useState(false);
  const [reply, setReply] = useState<CorrectionsReply | null>(null);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [showRejected, setShowRejected] = useState(false);

  const [progress, setProgress] = useState<{ done: number; total: number; doing: string } | null>(null);
  const [result, setResult] = useState<CorrectionsResult | null>(null);
  const [undoing, setUndoing] = useState(false);

  const loadHealth = useCallback(async () => {
    if (phase === "applying") return;
    try {
      setHealth(await getHealthReport(DEFAULT_USER_ID));
    } catch (e) {
      logger.warn("Data health failed", e);
    }
    setLast(getLastCorrection());
  }, [phase]);
  useDataRefresh(loadHealth);

  const makeFile = async () => {
    setExporting(true);
    try {
      const f = await buildFixExport(DEFAULT_USER_ID, { includePeople, includeNotes });
      setFile(f);
      await shareFixExport(f);
    } catch (e) {
      alert("Couldn't make the file", e instanceof Error ? e.message : "Try again.");
    } finally {
      setExporting(false);
    }
  };

  const read = async (text: string) => {
    if (!text.trim()) {
      alert("Nothing to read", "Copy your assistant's whole reply, then paste it here.");
      return;
    }
    setReading(true);
    try {
      const r = await readCorrections(DEFAULT_USER_ID, text);
      if (!r.recognised) {
        alert("That isn't a correction file", "Ask your assistant to reply with the corrections file described in the Arth file.");
        return;
      }
      setReply(r);
      setOff(new Set(r.accepted.filter((f) => DELIBERATE.has(f.type)).map((f) => f.key)));
      setPhase("review");
    } catch (e) {
      alert("Couldn't read the reply", e instanceof Error ? e.message : "Try again.");
    } finally {
      setReading(false);
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      setPasted(text);
      if (text.trim()) await read(text);
    } catch {
      alert("Couldn't paste", "Long-press the box and paste instead.");
    }
  };

  const groups = useMemo(() => {
    if (!reply) return [];
    return APPLY_ORDER.map((type) => ({ type, label: GROUP_LABELS[type], items: reply.accepted.filter((f) => f.type === type) })).filter(
      (g) => g.items.length > 0,
    );
  }, [reply]);
  const chosen = reply ? reply.accepted.filter((f) => !off.has(f.key)) : [];

  const toggle = (keys: number[], on: boolean) =>
    setOff((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.delete(k);
        else next.add(k);
      }
      return next;
    });

  const apply = () => {
    if (chosen.length === 0) return;
    alert(
      `Apply ${chosen.length} correction${chosen.length === 1 ? "" : "s"}?`,
      "Arth saves a copy first, so you can undo the whole lot afterwards.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Apply",
          onPress: async () => {
            setPhase("applying");
            setProgress({ done: 0, total: chosen.length, doing: "Starting" });
            try {
              const r = await applyCorrections(DEFAULT_USER_ID, chosen, setProgress);
              setResult(r);
              setPhase("done");
              setLast(getLastCorrection());
            } catch (e) {
              logger.error("Fix my data: apply failed", e);
              alert("Couldn't apply the corrections", `${e instanceof Error ? e.message : "Something went wrong"}. Use Undo to put things back if anything changed.`);
              setPhase("home");
              setLast(getLastCorrection());
            }
          },
        },
      ],
    );
  };

  const undo = () => {
    alert("Undo the last correction?", "Everything goes back to how it was just before it, including anything you changed since.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Undo",
        style: "destructive",
        onPress: async () => {
          setUndoing(true);
          try {
            await undoLastCorrection();
            setLast(null);
            setResult(null);
            setReply(null);
            setPasted("");
            setPhase("home");
            await loadHealth();
          } catch (e) {
            alert("Couldn't undo", e instanceof Error ? e.message : "Try again.");
          } finally {
            setUndoing(false);
          }
        },
      },
    ]);
  };

  const matchBank = (accountId: string, name: string, bank: number) => {
    alert(`Match ${name} to ${formatAmount(bank)}?`, "Arth adds a visible balance adjustment for the difference. You can delete it from the ledger later.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Match",
        onPress: async () => {
          setMatching(accountId);
          try {
            await adjustAccountAvailable({ accountId, userId: DEFAULT_USER_ID, actualAvailable: bank, description: "Matched to the bank (Data health)" });
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

  // ── Applying ────────────────────────────────────────────────────────────────
  if (phase === "applying") {
    const p = progress;
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center px-8">
          <ActivityIndicator size="large" color={theme.primary} />
          <Text className="text-base font-semibold text-foreground mt-4 text-center">{p?.doing ?? "Applying"}</Text>
          {p && p.total > 0 && (
            <Text className="text-sm text-muted-foreground mt-1">
              {Math.min(p.done, p.total)} of {p.total}
            </Text>
          )}
          <Text className="text-xs text-muted-foreground mt-4 text-center">Keep Arth open until this finishes.</Text>
        </View>
      </ScreenContainer>
    );
  }

  // ── Done: the impact report ────────────────────────────────────────────────
  if (phase === "done" && result) {
    return (
      <ScreenContainer padTop={false}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
          <Card className="mb-3">
            <Text className="text-xs text-muted-foreground">Applied</Text>
            <Text className="text-title font-bold text-foreground mt-1">
              {result.applied} correction{result.applied === 1 ? "" : "s"}
            </Text>
            {result.byGroup.map((g) => (
              <View key={g.label} className="flex-row justify-between mt-1.5">
                <Text className="text-sm text-muted-foreground flex-1 mr-2">{g.label}</Text>
                <Text className="text-sm text-foreground">{g.count}</Text>
              </View>
            ))}
          </Card>

          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 mt-1">What moved</Text>
          <Card className="mb-3">
            {result.changes.length === 0 ? (
              <Text className="text-sm text-muted-foreground">None of your headline figures changed.</Text>
            ) : (
              result.changes.map((c: MetricChange) => {
                const better = c.lowerIsBetter ? c.value < c.before : c.id === "health:score" ? c.value > c.before : null;
                return (
                  <View key={c.id} className="flex-row items-center py-1.5">
                    <Text className="text-sm text-foreground flex-1 mr-2" numberOfLines={1}>
                      {c.label}
                    </Text>
                    <Text className="text-xs text-muted-foreground mr-1.5">{showMetric(c, c.before)}</Text>
                    <Ionicons name="arrow-forward" size={11} color={theme.mutedForeground} />
                    <Text
                      className="text-sm font-semibold ml-1.5"
                      style={{ color: better === true ? theme.success : better === false ? theme.warning : theme.foreground }}
                    >
                      {showMetric(c, c.value)}
                    </Text>
                  </View>
                );
              })
            )}
          </Card>

          {result.failed.length > 0 && (
            <Card className="mb-3">
              <Text className="text-sm font-semibold text-foreground mb-1">
                {result.failed.length} couldn't be applied
              </Text>
              {result.failed.slice(0, 30).map((f, i) => (
                <Text key={i} className="text-xs text-muted-foreground mt-1">
                  {f.title}: {f.reason}
                </Text>
              ))}
            </Card>
          )}

          <Button title="Done" onPress={() => { setPhase("home"); setReply(null); setPasted(""); void loadHealth(); }} className="mb-2" />
          <Button title="Undo all of this" variant="outline" onPress={undo} loading={undoing} />
        </ScrollView>
      </ScreenContainer>
    );
  }

  // ── Review the reply ───────────────────────────────────────────────────────
  if (phase === "review" && reply) {
    return (
      <ScreenContainer padTop={false}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
          <Text className="text-sm text-muted-foreground mb-3 leading-5">
            {reply.accepted.length} correction{reply.accepted.length === 1 ? "" : "s"} checked against your data. Nothing has changed yet. Untick
            any you don't want.
            {reply.alreadySet > 0 ? ` ${reply.alreadySet} were already true and are left out.` : ""}
            {reply.cutOff ? " The reply was cut off at the end; ask your assistant to continue for the rest." : ""}
          </Text>

          {groups.map((g) => {
            const allOn = g.items.every((f) => !off.has(f.key));
            return (
              <Card key={g.type} className="mb-3">
                <Pressable
                  onPress={() => toggle(g.items.map((f) => f.key), !allOn)}
                  className="flex-row items-center"
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: allOn }}
                >
                  <Ionicons name={allOn ? "checkbox" : "square-outline"} size={20} color={allOn ? theme.primary : theme.mutedForeground} />
                  <Text className="text-sm font-semibold text-foreground ml-2 flex-1">{g.label}</Text>
                  <Text className="text-xs text-muted-foreground">{g.items.length}</Text>
                </Pressable>
                {DELIBERATE.has(g.type) && <Text className="text-xs text-muted-foreground mt-1">Changes your plan, so it starts unticked.</Text>}
                {g.items.slice(0, 50).map((f: Fix) => {
                  const on = !off.has(f.key);
                  return (
                    <Pressable
                      key={f.key}
                      onPress={() => toggle([f.key], !on)}
                      className="flex-row mt-2.5"
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                    >
                      <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={18} color={on ? theme.primary : theme.mutedForeground} />
                      <View className="flex-1 ml-2">
                        <Text className="text-sm text-foreground" numberOfLines={1}>{f.title}</Text>
                        {f.detail ? <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={2}>{f.detail}</Text> : null}
                        {f.why ? <Text className="text-xs mt-0.5" style={{ color: theme.mutedForeground }} numberOfLines={2}>“{f.why}”</Text> : null}
                      </View>
                    </Pressable>
                  );
                })}
                {g.items.length > 50 && <Text className="text-xs text-muted-foreground mt-2">and {g.items.length - 50} more like these</Text>}
              </Card>
            );
          })}

          {reply.rejected.length > 0 && (
            <Card className="mb-3">
              <Pressable onPress={() => setShowRejected((v) => !v)} className="flex-row items-center">
                <Text className="text-sm font-semibold text-foreground flex-1">{reply.rejected.length} left out</Text>
                <Ionicons name={showRejected ? "chevron-up" : "chevron-down"} size={16} color={theme.mutedForeground} />
              </Pressable>
              <Text className="text-xs text-muted-foreground mt-1">Wrong, or about something Arth couldn't find. Nothing from these is applied.</Text>
              {showRejected &&
                reply.rejected.slice(0, 60).map((r, i) => (
                  <Text key={i} className="text-xs text-muted-foreground mt-2" numberOfLines={3}>
                    {r.reason}: {r.text}
                  </Text>
                ))}
            </Card>
          )}
        </ScrollView>
        <View className="px-4 pb-4 pt-2 border-t border-border" style={{ backgroundColor: theme.background }}>
          <Button title={`Apply ${chosen.length}`} onPress={apply} disabled={chosen.length === 0} className="mb-2" />
          <Button title="Back" variant="ghost" onPress={() => setPhase("home")} />
        </View>
      </ScreenContainer>
    );
  }

  // ── Home: data health + the AI round trip ────────────────────────────────────
  const issues = health?.checks.filter((c) => c.count > 0) ?? [];
  const clean = health?.checks.filter((c) => c.count === 0) ?? [];
  const scoreColor = !health ? theme.foreground : health.score >= 90 ? theme.success : health.score >= 70 ? theme.warning : theme.danger;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {last && (
          <Card className="mb-3">
            <View className="flex-row items-center">
              <Ionicons name="arrow-undo-outline" size={18} color={theme.primary} />
              <Text className="text-sm text-foreground ml-2 flex-1">
                {last.changes} corrections applied {formatDisplayDate(last.appliedAt.slice(0, 10))}
              </Text>
              <Pressable onPress={undo} hitSlop={8} accessibilityRole="button" disabled={undoing}>
                <Text className="text-sm font-semibold" style={{ color: theme.primary }}>{undoing ? "Undoing…" : "Undo"}</Text>
              </Pressable>
            </View>
          </Card>
        )}

        <Card className="mb-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Data health</Text>
          {!health ? (
            <ActivityIndicator className="mt-3" color={theme.primary} />
          ) : (
            <>
              <View className="flex-row items-end mt-1">
                <Text className="text-title font-bold" style={{ color: scoreColor }}>{health.score}%</Text>
                <Text className="text-sm text-muted-foreground ml-2 mb-1">tidy · {health.transactions.toLocaleString("en-IN")} transactions</Text>
              </View>
              <Text className="text-xs text-muted-foreground mt-1">
                {issues.length === 0 ? "Nothing Arth can see needs fixing." : `${issues.length} thing${issues.length === 1 ? "" : "s"} to look at.`}
              </Text>
            </>
          )}
        </Card>

        {issues.map((c) => {
          const route = ROUTES[c.id];
          const isGaps = c.id === "balance_gaps";
          return (
            <Card key={c.id} className="mb-2 py-3">
              <Pressable
                onPress={() => (isGaps ? setShowGaps((v) => !v) : route ? router.push(route) : undefined)}
                disabled={!isGaps && !route}
                className="flex-row items-center"
                accessibilityRole={isGaps || route ? "button" : "text"}
              >
                <View className="w-8 h-8 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("warning", 0.14) }}>
                  <Text className="text-xs font-bold" style={{ color: theme.warning }}>{c.count > 999 ? "999+" : c.count}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-foreground">{c.label}</Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">{route || isGaps ? c.hint : `${c.hint}. Your AI can fix these.`}</Text>
                </View>
                {(route || isGaps) && <Ionicons name={isGaps && showGaps ? "chevron-up" : "chevron-forward"} size={15} color={theme.mutedForeground} />}
              </Pressable>
              {isGaps && showGaps &&
                health?.balanceGaps.map((g) => (
                  <View key={g.accountId} className="mt-3 pt-3 border-t border-border">
                    <Text className="text-sm text-foreground">{g.name}</Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      Bank said {formatAmount(g.bank)} on {formatDisplayDate(g.bankDate)}; Arth makes it {formatAmount(g.arth)} ({g.gap > 0 ? "+" : "−"}
                      {formatAmount(Math.abs(g.gap))})
                    </Text>
                    <Pressable
                      onPress={() => matchBank(g.accountId, g.name, g.bank)}
                      disabled={matching === g.accountId}
                      className="self-start mt-2 px-3 py-1.5 rounded-full"
                      style={{ backgroundColor: theme.alpha("primary", 0.12) }}
                      accessibilityRole="button"
                    >
                      <Text className="text-xs font-semibold" style={{ color: theme.primary }}>
                        {matching === g.accountId ? "Matching…" : "Match the bank"}
                      </Text>
                    </Pressable>
                  </View>
                ))}
            </Card>
          );
        })}
        {clean.length > 0 && (
          <Text className="text-xs text-muted-foreground mb-3 mt-1">
            All good: {clean.map((c) => c.label.toLowerCase()).join(", ")}.
          </Text>
        )}

        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 mt-3">Fix everything with your AI</Text>
        <Card className="mb-3">
          <Text className="text-sm font-semibold text-foreground">1. Share your whole history</Text>
          <Text className="text-xs text-muted-foreground mt-1 leading-4">
            Your AI assistant gets every transaction, account, budget and goal, plus what Arth found above, and replies with a correction file.
            SMS text, the vault and account numbers stay on this phone.
          </Text>
          <View className="flex-row items-center mt-3">
            <Text className="text-sm text-foreground flex-1">Include people's names (Hisaab)</Text>
            <Switch value={includePeople} onValueChange={setIncludePeople} />
          </View>
          <View className="flex-row items-center mt-1">
            <Text className="text-sm text-foreground flex-1">Include your notes</Text>
            <Switch value={includeNotes} onValueChange={setIncludeNotes} />
          </View>
          <Button title={file ? "Share again" : "Make the file and share"} onPress={() => void makeFile()} loading={exporting} className="mt-3" />
          {file && (
            <Text className="text-xs text-muted-foreground mt-2">
              {file.transactions.toLocaleString("en-IN")} transactions · {Math.max(1, Math.round(file.sizeBytes / 1024))} KB. The request is on your
              clipboard too.
            </Text>
          )}
        </Card>

        <Card className="mb-3">
          <Text className="text-sm font-semibold text-foreground">2. Paste its reply</Text>
          <Text className="text-xs text-muted-foreground mt-1">Copy the assistant's whole reply. Arth checks every correction before anything changes.</Text>
          <Button title="Paste from clipboard" variant="outline" onPress={() => void pasteFromClipboard()} loading={reading} className="mt-3" />
          <TextInput
            value={pasted}
            onChangeText={setPasted}
            placeholder={'Or paste here: {"corrections": [ … ]}'}
            placeholderTextColor={theme.mutedForeground}
            multiline
            className="text-xs text-foreground border border-border rounded-lg px-3 py-2 mt-2"
            style={{ minHeight: 90, maxHeight: 200, textAlignVertical: "top" }}
            accessibilityLabel="Assistant's reply"
          />
          {pasted.trim().length > 0 && <Button title="Read the reply" onPress={() => void read(pasted)} loading={reading} className="mt-2" />}
        </Card>
      </ScrollView>
    </ScreenContainer>
  );
}
