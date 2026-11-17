import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, ScreenContainer, Text, useToast } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { setAiLabUnlocked } from "@/services/ai/ai-lab";
import { downloadNano, getNanoStatus, warmupNano, type NanoStatus } from "@/services/ai/nano";
import { readSmsWithNano, type ReadSmsOutcome } from "@/services/ai/tasks/read-sms";
import { listUnrecognisedSms } from "@/services/sms/user-sms-templates";

/**
 * Phase 0 of docs/GEMINI_NANO_PROPOSAL.md: is Gemini Nano fast and accurate enough on real bank
 * messages? Hidden like developer options (tap Version 7 times in Settings). Read-only: nothing
 * here writes to the database, and nothing leaves the phone.
 */

const STATUS_TEXT: Record<NanoStatus, string> = {
  available: "Ready",
  downloadable: "Model not downloaded yet",
  downloading: "Android is downloading the model",
  unavailable: "Not supported on this phone",
};

interface RunRow {
  id: string;
  sender: string;
  body: string;
  outcome?: ReadSmsOutcome;
  raw?: string;
  ms?: number;
  error?: string;
}

const BATCH = 50;

function describe(o: ReadSmsOutcome): string {
  if (o.kind === "not_transaction") return "Not a transaction";
  if (o.kind === "rejected") return `Rejected: ${o.problems.join("; ")}`;
  const r = o.result;
  const parts = [
    `${r.type === "debit" ? "Debit" : "Credit"} ₹${r.amount.toLocaleString("en-IN")}`,
    r.last4 ? `••${r.last4}` : null,
    r.merchant,
    r.balance != null ? `bal ₹${r.balance.toLocaleString("en-IN")}` : null,
  ];
  return parts.filter(Boolean).join(" · ") + (o.warnings.length ? `\n${o.warnings.join("; ")}` : "");
}

function ResultLine({ row, open, onToggle }: { row: RunRow; open: boolean; onToggle: () => void }) {
  const theme = useTheme();
  const kind = row.error ? "error" : row.outcome?.kind;
  const icon =
    kind === "transaction" ? "checkmark-circle" : kind === "not_transaction" ? "remove-circle-outline" : kind ? "close-circle" : "ellipse-outline";
  const color = kind === "transaction" ? theme.success : kind === "rejected" || kind === "error" ? theme.warning : theme.mutedForeground;
  return (
    <Pressable onPress={onToggle} className="py-2 border-b border-border" accessibilityRole="button">
      <View className="flex-row items-start">
        <Ionicons name={icon} size={18} color={color} style={{ marginTop: 1 }} />
        <View className="flex-1 ml-2">
          <Text className="text-label text-muted-foreground" numberOfLines={open ? undefined : 2}>
            {row.sender} · {row.body}
          </Text>
          <Text className="text-meta text-foreground mt-0.5">
            {row.error ? `Error: ${row.error}` : row.outcome ? describe(row.outcome) : "Waiting…"}
            {row.ms != null ? `  (${(row.ms / 1000).toFixed(1)} s)` : ""}
          </Text>
          {open && row.raw != null && (
            <Text className="text-label text-muted-foreground mt-1" selectable>
              Model said: {row.raw || "(nothing)"}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export default function AiLabScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useColorScheme();
  const [status, setStatus] = useState<NanoStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<number | null>(null);

  const [sender, setSender] = useState("");
  const [body, setBody] = useState("");
  const [single, setSingle] = useState<RunRow | null>(null);

  const [rows, setRows] = useState<RunRow[]>([]);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => setStatus(await getNanoStatus()), []);
  useEffect(() => {
    void refreshStatus();
    return () => {
      stopRef.current = true;
    };
  }, [refreshStatus]);

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
      toast(`Model loaded in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    } catch (e) {
      toast(`Couldn't load: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const readOne = async (row: RunRow): Promise<RunRow> => {
    try {
      const r = await readSmsWithNano(row.body, row.sender);
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
    const messages = await listUnrecognisedSms(BATCH).catch(() => []);
    if (messages.length === 0) {
      toast("No unrecognised messages to test on");
      return;
    }
    const start: RunRow[] = messages.map((m) => ({ id: m.id, sender: m.address, body: m.body }));
    setRows(start);
    setOpenId(null);
    setRunning(true);
    stopRef.current = false;
    for (let i = 0; i < start.length && !stopRef.current; i++) {
      const done = await readOne(start[i]);
      setRows((prev) => prev.map((r) => (r.id === done.id ? done : r)));
    }
    setRunning(false);
  };

  const finished = rows.filter((r) => r.outcome || r.error);
  const count = (k: string) => finished.filter((r) => (r.error ? "error" : r.outcome?.kind) === k).length;
  const times = finished.filter((r) => r.ms != null).map((r) => r.ms!).sort((a, b) => a - b);
  const avg = times.length ? times.reduce((s, t) => s + t, 0) / times.length : 0;
  const p90 = times.length ? times[Math.min(times.length - 1, Math.floor(times.length * 0.9))] : 0;

  const ready = status === "available";
  const inputClass = "border border-border rounded-control px-3 py-2 text-meta text-foreground";

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Card className="mb-3">
          <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-1">Gemini Nano</Text>
          <Text className="text-body font-semibold text-foreground">{status ? STATUS_TEXT[status] : "Checking…"}</Text>
          <Text className="text-label text-muted-foreground mt-1 leading-4">
            Runs on this phone through Android. Nothing is sent anywhere, and nothing here changes your data.
          </Text>
          {downloaded != null && (
            <Text className="text-label text-muted-foreground mt-2">Downloaded {(downloaded / 1e6).toFixed(0)} MB…</Text>
          )}
          {status === "downloadable" && (
            <Button title="Download model" onPress={() => void download()} loading={busy === "download"} className="mt-3" />
          )}
          {ready && (
            <Button title="Load model now" variant="outline" onPress={() => void warmup()} loading={busy === "warmup"} className="mt-3" />
          )}
          <Button title="Check again" variant="ghost" onPress={() => void refreshStatus()} className="mt-2" />
        </Card>

        <Card className="mb-3">
          <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-2">Try one message</Text>
          <TextInput
            value={sender}
            onChangeText={setSender}
            placeholder="Sender, e.g. AX-HDFCBK"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="characters"
            className={inputClass}
          />
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Paste a bank message"
            placeholderTextColor={colors.textSecondary}
            multiline
            className={`${inputClass} mt-2`}
            style={{ minHeight: 90, textAlignVertical: "top" }}
          />
          <Button
            title="Read it"
            onPress={() => void tryOne()}
            disabled={!ready || !body.trim()}
            loading={busy === "single"}
            className="mt-3"
          />
          {single && <ResultLine row={single} open onToggle={() => {}} />}
        </Card>

        <Card className="mb-3">
          <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Test on unrecognised messages
          </Text>
          <Text className="text-label text-muted-foreground mb-2 leading-4">
            Reads up to {BATCH} recent messages Arth couldn&apos;t read, one by one. Target: most read correctly, each in
            under 2 seconds.
          </Text>
          {running ? (
            <Button title={`Stop (${finished.length} / ${rows.length})`} variant="outline" onPress={() => (stopRef.current = true)} />
          ) : (
            <Button title={rows.length ? "Run again" : `Run on ${BATCH} messages`} onPress={() => void runBatch()} disabled={!ready} />
          )}

          {finished.length > 0 && (
            <View className="mt-3 mb-1">
              <Text className="text-meta text-foreground">
                {finished.length} read · {count("transaction")} transactions · {count("not_transaction")} not transactions ·{" "}
                {count("rejected")} rejected · {count("error")} errors
              </Text>
              <Text className="text-label text-muted-foreground mt-0.5">
                Average {(avg / 1000).toFixed(1)} s · 9 in 10 under {(p90 / 1000).toFixed(1)} s · tap a row for the model&apos;s answer
              </Text>
            </View>
          )}
          {rows.map((r) => (
            <ResultLine key={r.id} row={r} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)} />
          ))}
        </Card>

        <Button
          title="Hide this screen"
          variant="ghost"
          onPress={() => {
            setAiLabUnlocked(false);
            toast("AI lab hidden. Tap Version 7 times to show it again.");
            router.back();
          }}
        />
      </ScrollView>
    </ScreenContainer>
  );
}
