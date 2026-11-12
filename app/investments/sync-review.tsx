import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, EmptyState, Input, LoadingState, ScreenContainer, SelectSheet, Text, type SelectOption } from "@/components/ui";
import { createBrokerAccount, linkBrokerAccount } from "@/services/broker-link";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import {
  SYNC_BROKER_NAMES,
  SYNC_BROKER_ROUTES,
  syncAllBrokers,
  syncBroker,
  type BrokerSyncResult,
} from "@/services/broker-sync";
import {
  getSyncAccounts,
  getSyncReview,
  readAccountMove,
  saveManualValues,
  type AccountMove,
  type SyncAccount,
  type SyncReview,
} from "@/services/investment-sync-review";
import { getDematAccountsForPicker, isKiteTokenExpired } from "@/services/kite-connect";
import { formatDate } from "@/utils/date";
import { formatAmount } from "@/utils/expense-validation";
import { formatLocalDate } from "@/utils/fiscal-year";

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${formatAmount(Math.abs(n))}`;
const signedPct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;
const holdingsKey = (id: string) => `${id}:holdings`;
const fundsKey = (id: string) => `${id}:funds`;

/** A typed amount, or null if the box is blank or doesn't hold one. */
function amountIn(text: string | undefined): number | null {
  const clean = (text ?? "").replace(/,/g, "").trim();
  if (!clean) return null;
  const n = parseFloat(clean);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function sincePhrase(date: string | null, today: string): string {
  if (!date) return "since each one's last value";
  const d = new Date(`${today}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return date === formatLocalDate(d) ? "since yesterday" : `since ${formatDate(date)}`;
}

/**
 * Fetches every connected broker, asks for the value of anything that can't sync, then shows how much
 * it all moved. A value left blank is left out of the review, and says so.
 */
export default function SyncReviewScreen() {
  const router = useRouter();
  const theme = useTheme();
  const today = formatLocalDate(new Date());
  const [phase, setPhase] = useState<"fetching" | "values" | "review">("fetching");
  const [accounts, setAccounts] = useState<SyncAccount[]>([]);
  const [results, setResults] = useState<BrokerSyncResult[]>([]);
  const [moves, setMoves] = useState<Map<string, AccountMove>>(new Map());
  const [values, setValues] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<Set<string>>(new Set());
  const [review, setReview] = useState<SyncReview | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const showReview = useCallback(
    async (list: SyncAccount[], synced: BrokerSyncResult[], typedIds: Set<string>) => {
      setReview(await getSyncReview(list, synced, typedIds, today));
      setPhase("review");
    },
    [today],
  );

  /** The whole run, from the start. Running it again today overwrites today's values. */
  const run = useRef(0);
  const start = useCallback(async () => {
    const id = ++run.current;
    setPhase("fetching");
    setFailed(false);
    try {
      const synced = await syncAllBrokers();
      // After the sync, because a first Zerodha sync is what finds its linked account.
      const list = await getSyncAccounts(DEFAULT_USER_ID);
      const read = new Map(await Promise.all(list.map(async (a) => [a.id, await readAccountMove(a.id, today)] as const)));
      if (id !== run.current) return;
      // Whatever's there now goes in the boxes, to change or carry on with.
      const filled: Record<string, string> = {};
      for (const a of list) {
        const move = read.get(a.id);
        if (a.broker || !move) continue;
        if (move.holdings != null) filled[holdingsKey(a.id)] = String(move.holdings);
        if (move.funds != null) filled[fundsKey(a.id)] = String(move.funds);
      }
      setValues(filled);
      setTyped(new Set());
      setResults(synced);
      setAccounts(list);
      setMoves(read);
      if (list.some((a) => !a.broker)) setPhase("values");
      else await showReview(list, synced, new Set());
    } catch {
      if (id === run.current) setFailed(true);
    }
  }, [showReview, today]);

  useEffect(() => {
    start();
    return () => {
      // A run still going when the screen closes shouldn't carry on setting its state.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      run.current += 1;
    };
  }, [start]);

  // Back from logging in to Zerodha: carry on where the sync stopped.
  const latest = useRef({ accounts, results, typed, phase });
  latest.current = { accounts, results, typed, phase };
  useFocusEffect(
    useCallback(() => {
      const now = latest.current;
      if (now.phase !== "review") return;
      const waiting = now.results.some((r) => r.broker === "kite" && r.status === "needs_login");
      if (!waiting || isKiteTokenExpired()) return;
      syncBroker("kite")
        .then(async (done) => {
          const next = now.results.map((r) => (r.broker === "kite" ? done : r));
          const list = await getSyncAccounts(DEFAULT_USER_ID);
          setResults(next);
          setAccounts(list);
          await showReview(list, next, now.typed);
        })
        .catch(() => {});
    }, [showReview]),
  );

  const manual = accounts.filter((a) => !a.broker);

  const saveValues = async () => {
    setSaving(true);
    try {
      const ids = new Set<string>();
      for (const a of manual) {
        const holdings = amountIn(values[holdingsKey(a.id)]);
        const funds = a.asksFunds ? amountIn(values[fundsKey(a.id)]) : null;
        if (holdings == null && funds == null) continue;
        await saveManualValues(a.id, holdings, funds, today);
        ids.add(a.id);
      }
      setTyped(ids);
      await showReview(accounts, results, ids);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  // "Link" picks the account right here, then syncs that broker again, instead of sending you to
  // the broker's own screen.
  const NEW_ACCOUNT = "__new__";
  const [linkFor, setLinkFor] = useState<BrokerSyncResult["broker"] | null>(null);
  const [linkOptions, setLinkOptions] = useState<SelectOption<string>[]>([]);
  const [linking, setLinking] = useState(false);

  const fix = async (r: BrokerSyncResult) => {
    if (r.status === "needs_account") {
      const list = await getDematAccountsForPicker().catch(() => []);
      setLinkOptions([
        ...list.map((a) => ({ value: a.id, label: a.label, icon: "briefcase-outline" as const })),
        { value: NEW_ACCOUNT, label: `New ${SYNC_BROKER_NAMES[r.broker]} account`, icon: "add-circle-outline" as const },
      ]);
      setLinkFor(r.broker);
      return;
    }
    const route = SYNC_BROKER_ROUTES[r.broker];
    router.push((r.status === "needs_login" ? `${route}?loginForSync=1` : route) as Href);
  };

  const linkAndSync = async (value: string) => {
    const broker = linkFor;
    setLinkFor(null);
    if (!broker) return;
    setLinking(true);
    try {
      const accountId = value === NEW_ACCOUNT ? await createBrokerAccount(broker, null) : value;
      await linkBrokerAccount(broker, accountId);
      const done = await syncBroker(broker);
      const next = results.map((x) => (x.broker === broker ? done : x));
      const list = await getSyncAccounts(DEFAULT_USER_ID);
      setResults(next);
      setAccounts(list);
      await showReview(list, next, typed);
    } catch {
      // The row stays as it was, with Link still there to try again.
    } finally {
      setLinking(false);
    }
  };

  if (failed) {
    return (
      <ScreenContainer padTop={false}>
        <EmptyState icon="alert-circle-outline" title="Couldn't finish" subtitle="Nothing else was changed. Go back and try again." />
      </ScreenContainer>
    );
  }

  if (phase === "fetching") {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Getting today's values..." icon="sync-outline" />
      </ScreenContainer>
    );
  }

  if (phase === "values") {
    return (
      <ScreenContainer padTop={false}>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            <Text className="text-base font-semibold text-foreground">What are these worth today?</Text>
            <Text className="text-sm text-muted-foreground mt-1 mb-3">
              These don't sync on their own. Change what's changed, or carry on with what's here. Clear both boxes to skip one for today.
            </Text>
            {manual.map((a) => {
              const move = moves.get(a.id);
              return (
                <Card key={a.id} className="mb-2">
                  <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>{a.name}</Text>
                  <Text className="text-xs text-muted-foreground mt-0.5 mb-2">
                    {move?.updatedToday
                      ? "Filled in from today's earlier sync"
                      : move?.lastDate
                        ? `Filled in from your last value, ${formatDate(move.lastDate)}`
                        : "No value yet"}
                  </Text>
                  <Input
                    label="Holdings value"
                    value={values[holdingsKey(a.id)] ?? ""}
                    onChangeText={(t) => setValues((v) => ({ ...v, [holdingsKey(a.id)]: t }))}
                    keyboardType="numeric"
                    formula
                    placeholder="0"
                    containerClassName={a.asksFunds ? "mb-2" : undefined}
                  />
                  {a.asksFunds && (
                    <Input
                      label="Idle funds"
                      value={values[fundsKey(a.id)] ?? ""}
                      onChangeText={(t) => setValues((v) => ({ ...v, [fundsKey(a.id)]: t }))}
                      keyboardType="numeric"
                      formula
                      placeholder="0"
                    />
                  )}
                </Card>
              );
            })}
            <Button title={saving ? "Saving..." : "See how it moved"} onPress={saveValues} loading={saving} disabled={saving} className="mt-2" />
          </ScrollView>
        </KeyboardAvoidingView>
      </ScreenContainer>
    );
  }

  if (!review) return null;
  const color = review.change >= 0 ? theme.success : theme.danger;
  const issues = results.filter((r) => r.status !== "saved");
  const leftOut = review.lines.filter((l) => l.status === "skipped" || l.status === "failed").length;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {accounts.length === 0 ? (
          <Card>
            <Text className="text-sm text-muted-foreground">Add a demat, mutual fund, gold or crypto investment to see how it moves each day.</Text>
          </Card>
        ) : (
          <Card className="mb-3">
            {review.compared > 0 ? (
              <>
                <View className="flex-row items-center">
                  <Ionicons name={review.change >= 0 ? "arrow-up" : "arrow-down"} size={22} color={color} />
                  <Text className="text-title font-bold ml-1" style={{ color }}>{formatAmount(Math.abs(review.change))}</Text>
                  {review.changePct != null && (
                    <Text className="text-sm font-semibold ml-2" style={{ color }}>{signedPct(review.changePct)}</Text>
                  )}
                </View>
                <Text className="text-sm text-muted-foreground mt-1">
                  {review.change >= 0 ? "Up" : "Down"} {sincePhrase(review.since, today)}
                </Text>
              </>
            ) : (
              <Text className="text-sm text-muted-foreground">Nothing to compare yet. Today's values are saved, and tomorrow's sync will show the move.</Text>
            )}
            <View className="flex-row justify-between mt-3 pt-3 border-t border-border">
              <Text className="text-sm text-muted-foreground">Total now</Text>
              <Text className="text-sm font-semibold text-foreground">{formatAmount(review.total)}</Text>
            </View>
            {review.added !== 0 && (
              <Text className="text-xs text-muted-foreground mt-2">
                You moved {formatAmount(Math.abs(review.added))} {review.added > 0 ? "in" : "out"} in this time. That isn't counted as a gain or a loss.
              </Text>
            )}
            {leftOut > 0 && review.compared > 0 && (
              <Text className="text-xs text-muted-foreground mt-2">
                {leftOut} {leftOut === 1 ? "investment isn't" : "investments aren't"} in this, because {leftOut === 1 ? "it wasn't" : "they weren't"} updated today.
              </Text>
            )}
          </Card>
        )}

        {issues.length > 0 && (
          <Card className="mb-3">
            {issues.map((r, i) => (
              <View key={r.broker} className={`flex-row items-center ${i > 0 ? "mt-3 pt-3 border-t border-border" : ""}`}>
                <Ionicons name={r.status === "failed" ? "alert-circle" : "information-circle"} size={18} color={r.status === "failed" ? theme.danger : theme.warning} />
                <View className="flex-1 ml-2 mr-2">
                  <Text className="text-sm font-medium text-foreground">{SYNC_BROKER_NAMES[r.broker]}</Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">
                    {r.status === "needs_login"
                      ? "Its login ends every day, so this one needs you"
                      : r.status === "needs_account"
                        ? "Link it to an account to save its value"
                        : r.status === "failed"
                          ? r.message
                          : ""}
                  </Text>
                </View>
                {(r.status === "needs_login" || r.status === "needs_account") && (
                  <Pressable onPress={() => void fix(r)} disabled={linking} hitSlop={8} accessibilityRole="button">
                    <Text className="text-xs font-semibold" style={{ color: theme.primary }}>
                      {r.status === "needs_login" ? "Log in" : "Link"}
                    </Text>
                  </Pressable>
                )}
              </View>
            ))}
          </Card>
        )}

        {review.lines.length > 0 && (
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 mt-1">Each investment</Text>
        )}
        {review.lines.map((l) => {
          const up = (l.change ?? 0) >= 0;
          const skipped = l.status === "skipped";
          return (
            <Pressable
              key={l.id}
              onPress={() => (skipped ? setPhase("values") : router.push({ pathname: "/demat/snapshots/[id]", params: { id: l.id } }))}
              accessibilityRole="button"
              accessibilityLabel={skipped ? `Add today's value for ${l.name}` : `Open ${l.name}`}
            >
              <Card className="mb-2">
                <View className="flex-row items-center">
                  <View className="flex-1 mr-2">
                    <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>{l.name}</Text>
                    <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
                      {l.status === "moved"
                        ? `${formatAmount(l.current)} now${review.since ? "" : `, ${sincePhrase(l.previousDate, today)}`}`
                        : l.status === "first"
                          ? `${formatAmount(l.current)}, its first value`
                          : skipped
                            ? "Not updated today. Tap to add its value"
                            : "Couldn't update today"}
                    </Text>
                  </View>
                  {l.status === "moved" && l.change != null && (
                    <View className="items-end">
                      <Text className="text-sm font-bold" style={{ color: up ? theme.success : theme.danger }}>{signed(l.change)}</Text>
                      {l.changePct != null && (
                        <Text className="text-label" style={{ color: up ? theme.success : theme.danger }}>{signedPct(l.changePct)}</Text>
                      )}
                    </View>
                  )}
                  <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} style={{ marginLeft: 4 }} />
                </View>
              </Card>
            </Pressable>
          );
        })}
        <Text className="text-xs text-muted-foreground mt-2">
          Fixed deposits and pension aren't here, because they don't change with the market each day.
        </Text>
        {/* Where to go next. dismissTo pops back if the screen is already in the stack (it usually
            is: Sync is opened from Investments), otherwise it opens it in place of this one. */}
        <View className="flex-row mt-4" style={{ gap: 8 }}>
          <Button title="Go to Investments" onPress={() => router.dismissTo("/investments")} className="flex-1" />
          <Button title="Go to Home" variant="outline" onPress={() => router.dismissTo("/(tabs)")} className="flex-1" />
        </View>
        <Button
          title="Sync again"
          variant="ghost"
          onPress={start}
          className="mt-2"
        />
      </ScrollView>
      <SelectSheet
        visible={linkFor != null}
        title={linkFor ? `Which account is ${SYNC_BROKER_NAMES[linkFor]}?` : ""}
        options={linkOptions}
        value={null}
        onChange={(v) => void linkAndSync(v)}
        onClose={() => setLinkFor(null)}
      />
    </ScreenContainer>
  );
}
