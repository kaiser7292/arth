import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  Badge,
  Button,
  Card,
  Chip,
  ChipWrap,
  DateInput,
  Input,
  ProgressBar,
  ScreenContainer,
  SectionTitle,
  Segmented,
  Text,
  useToast,
  type BadgeVariant,
} from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { countLabMessages, listLabMessages, setAiLabUnlocked } from "@/services/ai/ai-lab";
import { loadMoneyMap, moneyMapLines, type MoneyMap } from "@/services/ai/money-map";
import { downloadNano, getNanoStatus, warmupNano, type NanoStatus } from "@/services/ai/nano";
import { readSmsWithNano } from "@/services/ai/tasks/read-sms";
import { getLabRun, markLabRowAdded, startLabRun, stopLabRun, subscribeLabRun } from "@/services/ai/lab-runner";
import { addAiReadToCatchUp } from "@/services/ai/add-ai-read";
import { EVENT_TEXT, outcomeOf, ResultRow, secs, type Outcome, type RunRow } from "@/components/ai/LabResultRow";
import { isoDate } from "@/utils/local-date";

/**
 * Phase 0 of docs/GEMINI_NANO_PROPOSAL.md: is Gemini Nano fast and accurate enough on real bank
 * messages? Hidden like developer options (tap Version 7 times in Settings). Read-only: nothing
 * here writes to the database, and nothing leaves the phone.
 */

const STATUS: Record<NanoStatus, { label: string; variant: BadgeVariant; hint: string }> = {
  available: { label: "Ready", variant: "success", hint: "Gemini Nano is on this phone and ready." },
  downloadable: { label: "Not downloaded", variant: "warning", hint: "Android hasn't fetched the model yet." },
  downloading: { label: "Downloading", variant: "primary", hint: "Android is fetching the model. Check again in a bit." },
  unavailable: { label: "Not supported", variant: "danger", hint: "This phone doesn't have Gemini Nano." },
};

type Range = "7" | "30" | "90" | "custom";
type Filter = "all" | Outcome;

const RANGE_OPTIONS = [
  { value: "7" as const, label: "7 days" },
  { value: "30" as const, label: "30 days" },
  { value: "90" as const, label: "90 days" },
  { value: "custom" as const, label: "Dates" },
];
const SIZE_OPTIONS = [
  { value: "25" as const, label: "25" },
  { value: "50" as const, label: "50" },
  { value: "100" as const, label: "100" },
];

export default function AiLabScreen() {
  const router = useRouter();
  const toast = useToast();

  // "Add to Catch Up" on a scanned message the AI read: through the same path as a pattern's reading.
  const [addingId, setAddingId] = useState<string | null>(null);
  const addRow = async (row: RunRow) => {
    if (row.outcome?.kind !== "transaction" || row.date == null) return;
    setAddingId(row.id);
    try {
      const res = await addAiReadToCatchUp(row.id, row.outcome.result, row.body, row.sender, row.date);
      const note = res.expenseId
        ? null
        : res.error
          ? `Couldn't add it: ${res.error}`
          : "Arth didn't add it: it already has this transaction, or the account is ignored or before your start date";
      markLabRowAdded(row.id, { expenseId: res.expenseId, note });
      toast(res.expenseId ? "Added to Catch Up" : "Not added", res.expenseId ? { actionLabel: "Open", onAction: () => router.push("/expense/catch-up") } : undefined);
    } catch (e) {
      markLabRowAdded(row.id, { expenseId: null, note: `Couldn't add it: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setAddingId(null);
    }
  };
  const theme = useTheme();

  // Gemini Nano itself.
  const [status, setStatus] = useState<NanoStatus | null>(null);
  const [busy, setBusy] = useState<"download" | "warmup" | "single" | null>(null);
  const [downloaded, setDownloaded] = useState<number | null>(null);
  const refreshStatus = useCallback(async () => setStatus(await getNanoStatus()), []);
  const ready = status === "available";

  // The user's accounts, so the model can tell an FD closing or an own transfer from a spend.
  const [map, setMap] = useState<MoneyMap | null>(null);
  const [useMap, setUseMap] = useState(true);
  const [showMap, setShowMap] = useState(false);

  // One pasted message.
  const [sender, setSender] = useState("");
  const [body, setBody] = useState("");
  const [single, setSingle] = useState<RunRow | null>(null);

  // A batch of unrecognised messages.
  const [range, setRange] = useState<Range>("90");
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [size, setSize] = useState<"25" | "50" | "100">("50");
  const [available, setAvailable] = useState<number | null>(null);
  // The run lives outside the screen (services/ai/lab-runner.ts), so leaving the lab doesn't stop it.
  const run = useSyncExternalStore(subscribeLabRun, getLabRun);
  const { rows, running, paused } = run;
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    void refreshStatus();
    loadMoneyMap()
      .then(setMap)
      .catch(() => setMap(null));
  }, [refreshStatus]);

  const span = useMemo((): [number, number] => {
    if (range === "custom") {
      const a = new Date(`${from}T00:00:00`).getTime();
      const b = new Date(`${to}T23:59:59.999`).getTime();
      return a <= b ? [a, b] : [b, a];
    }
    const now = Date.now();
    return [now - Number(range) * 86400000, now];
  }, [range, from, to]);

  useEffect(() => {
    let live = true;
    setAvailable(null);
    countLabMessages(span[0], span[1])
      .then((n) => live && setAvailable(n))
      .catch(() => live && setAvailable(0));
    return () => {
      live = false;
    };
  }, [span]);

  const download = async () => {
    setBusy("download");
    setDownloaded(0);
    try {
      await downloadNano((bytes) => setDownloaded(bytes));
      toast("Model downloaded");
    } catch (e) {
      toast(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
      setDownloaded(null);
      void refreshStatus();
    }
  };

  const warmup = async () => {
    setBusy("warmup");
    const started = Date.now();
    try {
      await warmupNano();
      toast(`Model loaded in ${secs(Date.now() - started)}`);
    } catch (e) {
      toast(`Couldn't load: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const readOne = async (row: RunRow): Promise<RunRow> => {
    try {
      const r = await readSmsWithNano(row.body, row.sender, useMap && map ? map : undefined);
      return { ...row, outcome: r.outcome, raw: r.raw, ms: r.ms };
    } catch (e) {
      return { ...row, error: e instanceof Error ? e.message : String(e) };
    }
  };

  const tryOne = async () => {
    if (!body.trim()) return;
    setBusy("single");
    setSingle(await readOne({ id: "single", sender: sender.trim() || "UNKNOWN", body: body.trim() }));
    setBusy(null);
  };

  const runBatch = async () => {
    const messages = await listLabMessages(span[0], span[1], Number(size)).catch(() => []);
    if (messages.length === 0) {
      toast("No unrecognised messages in these dates");
      return;
    }
    const start: RunRow[] = messages.map((m) => ({ id: m.id, sender: m.address, body: m.body, date: m.sms_date }));
    setFilter("all");
    setOpenId(null);
    const dates = range === "custom" ? `${from} to ${to}` : `Last ${range} days`;
    toast("Reading in the background. You can leave this screen.");
    void startLabRun(start, `${dates} · ${start.length} messages`, useMap && map ? map : undefined);
  };

  // Results.
  const finished = rows.filter((r) => outcomeOf(r) != null);
  const count = (k: Outcome) => finished.filter((r) => outcomeOf(r) === k).length;
  const times = finished.filter((r) => r.ms != null).map((r) => r.ms!).sort((a, b) => a - b);
  const avg = times.length ? times.reduce((s, t) => s + t, 0) / times.length : 0;
  const p90 = times.length ? times[Math.min(times.length - 1, Math.floor(times.length * 0.9))] : 0;
  const events = new Map<string, number>();
  for (const r of finished) {
    if (r.outcome?.kind === "transaction") {
      const label = r.outcome.result.event ? EVENT_TEXT[r.outcome.result.event] : "No event";
      events.set(label, (events.get(label) ?? 0) + 1);
    }
  }
  const shown = filter === "all" ? rows : rows.filter((r) => outcomeOf(r) === filter);
  const runSize = Math.min(Number(size), available ?? Number(size));

  const st = status ? STATUS[status] : null;
  const FILTERS: { value: Filter; label: string; n: number }[] = [
    { value: "all", label: "All", n: rows.length },
    { value: "transaction", label: "Transactions", n: count("transaction") },
    { value: "not_transaction", label: "Not transactions", n: count("not_transaction") },
    { value: "ignored", label: "Ignored accounts", n: count("ignored") },
    { value: "rejected", label: "Rejected", n: count("rejected") },
    { value: "error", label: "No answer", n: count("error") },
  ];

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40, gap: 12 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* The model */}
        <Card>
          <View className="flex-row items-center">
            <View
              className="w-11 h-11 rounded-control items-center justify-center mr-3"
              style={{ backgroundColor: theme.alpha("primary", 0.12) }}
            >
              <Ionicons name="sparkles-outline" size={22} color={theme.primary} />
            </View>
            <View className="flex-1">
              <Text className="text-heading font-semibold text-foreground">Gemini Nano</Text>
              <Text className="text-meta text-muted-foreground">{st ? st.hint : "Checking this phone…"}</Text>
            </View>
            {st ? <Badge label={st.label} variant={st.variant} size="md" /> : null}
          </View>
          {downloaded != null ? (
            <Text className="text-meta text-muted-foreground mt-3">Downloaded {(downloaded / 1e6).toFixed(0)} MB…</Text>
          ) : null}
          {status === "downloadable" ? (
            <Button title="Download model" onPress={() => void download()} loading={busy === "download"} className="mt-4" />
          ) : null}
          {ready ? (
            <Button title="Load model now" variant="secondary" onPress={() => void warmup()} loading={busy === "warmup"} className="mt-4" />
          ) : null}
          <View className="flex-row items-center justify-between mt-3">
            <View className="flex-row items-center flex-1 mr-2">
              <Ionicons name="lock-closed-outline" size={14} color={theme.mutedForeground} />
              <Text className="text-meta text-muted-foreground ml-1.5 flex-1">Runs on this phone. Nothing is sent or saved.</Text>
            </View>
            <Pressable onPress={() => void refreshStatus()} accessibilityRole="button" hitSlop={8}>
              <Text className="text-meta font-semibold text-primary">Check again</Text>
            </Pressable>
          </View>
        </Card>

        {/* Accounts the model knows about */}
        <Card>
          <SectionTitle
            icon="wallet-outline"
            title="Use my accounts"
            hint={map ? `${map.accounts.length} accounts · type, bank and last digits only` : "Loading your accounts…"}
            active={useMap}
            right={<Switch value={useMap} onValueChange={setUseMap} accessibilityLabel="Use my accounts" />}
          />
          <Text className="text-meta text-muted-foreground mt-2">
            Lets the model tell an FD closing or a transfer between your own accounts from a spend.
          </Text>
          {map && map.accounts.length > 0 ? (
            <Pressable onPress={() => setShowMap(!showMap)} accessibilityRole="button" className="flex-row items-center mt-3">
              <Text className="text-meta font-semibold text-primary">{showMap ? "Hide what the model sees" : "Show what the model sees"}</Text>
              <Ionicons name={showMap ? "chevron-up" : "chevron-down"} size={14} color={theme.primary} style={{ marginLeft: 4 }} />
            </Pressable>
          ) : null}
          {showMap && map ? (
            <View className="rounded-control p-3 mt-2" style={{ backgroundColor: theme.alpha("foreground", 0.05) }}>
              <Text className="text-meta text-muted-foreground" selectable style={{ fontFamily: "monospace" }}>
                {moneyMapLines(map).join("\n")}
              </Text>
            </View>
          ) : null}
        </Card>

        {/* One message */}
        <Card>
          <SectionTitle icon="chatbox-ellipses-outline" title="Try one message" hint="Paste any bank SMS" />
          <Input label="Sender" value={sender} onChangeText={setSender} placeholder="AX-HDFCBK" autoCapitalize="characters" containerClassName="mt-4" />
          <Input
            label="Message"
            value={body}
            onChangeText={setBody}
            placeholder="Rs.250.00 debited from A/c XX1234…"
            multiline
            style={{ minHeight: 96, textAlignVertical: "top" }}
            containerClassName="mt-3"
          />
          <Button title="Read it" onPress={() => void tryOne()} disabled={!ready || !body.trim()} loading={busy === "single"} className="mt-4" />
          {single ? (
            <View className="mt-2">
              <ResultRow row={single} open onToggle={() => {}} last />
            </View>
          ) : null}
        </Card>

        {/* A batch */}
        <Card>
          <SectionTitle icon="flask-outline" title="Test on unrecognised messages" hint="Messages Arth couldn't read, newest first" />

          <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mt-4 mb-2">Dates</Text>
          <Segmented options={RANGE_OPTIONS} value={range} onChange={setRange} disabled={running} />
          {range === "custom" ? (
            <View className="flex-row mt-3" style={{ gap: 8 }}>
              <DateInput label="From" value={from} onChange={setFrom} containerClassName="flex-1" />
              <DateInput label="To" value={to} onChange={setTo} containerClassName="flex-1" />
            </View>
          ) : null}

          <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mt-4 mb-2">How many</Text>
          <Segmented options={SIZE_OPTIONS} value={size} onChange={setSize} disabled={running} />
          <Text className="text-meta text-muted-foreground mt-2">
            {available == null ? "Counting…" : `${available} unrecognised message${available === 1 ? "" : "s"} in these dates`}
          </Text>

          {running ? (
            <View className="mt-4">
              <View className="flex-row justify-between mb-1.5">
                <Text className="text-meta text-foreground">
                  Reading {finished.length} of {rows.length}
                </Text>
                <Text className="text-meta text-muted-foreground">{times.length ? `${secs(avg)} each` : ""}</Text>
              </View>
              <ProgressBar value={rows.length ? finished.length / rows.length : 0} />
              <View className="flex-row items-start mt-2">
                <Ionicons
                  name={paused ? "pause-circle-outline" : "information-circle-outline"}
                  size={14}
                  color={theme.mutedForeground}
                  style={{ marginTop: 2, marginRight: 4 }}
                />
                <Text className="text-meta text-muted-foreground flex-1">
                  {paused
                    ? "Paused while Arth is in the background. Carries on when you come back."
                    : "You can leave this screen. Arth tells you when it's done."}
                </Text>
              </View>
              <Button title="Stop" variant="outline" onPress={stopLabRun} className="mt-3" />
            </View>
          ) : (
            <Button
              title={available === 0 ? "Nothing to read" : rows.length ? `Run again on ${runSize}` : `Run on ${runSize} messages`}
              onPress={() => void runBatch()}
              disabled={!ready || available === 0}
              className="mt-4"
            />
          )}
        </Card>

        {finished.length > 0 ? (
          <Card>
            <SectionTitle icon="stats-chart-outline" title="Results" hint={`${finished.length} read · ${secs(avg)} average · 9 in 10 under ${secs(p90)}`} />
            {run.label ? (
              <Text className="text-meta text-muted-foreground mt-1">
                {run.label}
                {run.stopped ? " · stopped" : ""}
              </Text>
            ) : null}
            {run.historyId && !run.running ? (
              <Pressable onPress={() => router.push("/settings/sms-scan-runs")} className="mt-1" accessibilityRole="button">
                <Text className="text-meta font-medium" style={{ color: theme.primary }}>Saved to Scan history</Text>
              </Pressable>
            ) : null}
            <ChipWrap className="mt-3">
              {FILTERS.filter((f) => f.value === "all" || f.n > 0).map((f) => (
                <Chip key={f.value} label={`${f.label} ${f.n}`} on={filter === f.value} onPress={() => setFilter(f.value)} />
              ))}
            </ChipWrap>
            {events.size > 0 ? (
              <View className="flex-row flex-wrap mt-3" style={{ gap: 6 }}>
                {[...events.entries()].map(([k, n]) => (
                  <Chip key={k} variant="status" label={`${k} ${n}`} tone={k === "FD closed" || k === "Own transfer" ? "transfer" : "neutral"} />
                ))}
              </View>
            ) : null}
            <View className="mt-2">
              {shown.map((r, i) => (
                <ResultRow
                  key={r.id}
                  row={r}
                  open={openId === r.id}
                  onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                  last={i === shown.length - 1}
                  onAdd={() => void addRow(r)}
                  adding={addingId === r.id}
                  onOpenCatchUp={() => router.push("/expense/catch-up")}
                />
              ))}
            </View>
          </Card>
        ) : null}

        <Pressable
          onPress={() => {
            setAiLabUnlocked(false);
            toast("AI lab hidden. Tap Version 7 times to show it again.");
            router.back();
          }}
          accessibilityRole="button"
          className="flex-row items-center justify-center py-3"
        >
          <Ionicons name="eye-off-outline" size={16} color={theme.mutedForeground} />
          <Text className="text-meta font-semibold text-muted-foreground ml-1.5">Hide this screen</Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}
