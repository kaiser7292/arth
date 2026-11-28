import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, RadioRow, ScreenContainer, Segmented, Text } from "@/components/ui";
import { FormFooter, FormGroup } from "@/components/ui/FormParts";
import { Toggle } from "@/components/ui/Toggle";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useAlert } from "@/hooks/use-alert";
import { useTheme } from "@/hooks/use-theme";
import { getAiRequestFocus, setAiSetupPending } from "@/services/ai-share";
import { isAiReadingOn } from "@/services/ai/ai-reading";
import { takeLocalReply } from "@/services/ai/local-setup";
import { applyCorrections, type CorrectionsResult } from "@/services/corrections/apply";
import { buildFixExport, defaultPeriod, shareFixExport, type FixExport } from "@/services/corrections/export";
import { AI_FOCUSES, APPLY_ORDER, DELIBERATE, GROUP_LABELS, isAiFocus, type AiFocus } from "@/services/corrections/format";
import type { MetricChange } from "@/services/corrections/impact";
import { readCorrections, type CorrectionsReply, type Fix } from "@/services/corrections/read";
import { getUndoable, undoLastCorrection } from "@/services/corrections/snapshot";
import { continueAfterAi } from "@/services/onboarding-flow";
import { formatAmount } from "@/utils/format";
import { logger } from "@/utils/logger";

type Phase = "ask" | "review" | "applying" | "done";
type Period = "last_12_months" | "all_time";

function showMetric(m: { unit: string }, v: number): string {
  if (m.unit === "money") return formatAmount(v);
  if (m.unit === "percent") return `${Math.round(v * 10) / 10}%`;
  return String(Math.round(v));
}

function focusLabel(focus: AiFocus): string {
  return AI_FOCUSES.find((f) => f.id === (focus === "setup" ? "everything" : focus))?.label ?? "Your request";
}

/**
 * Settings → AI → Ask your AI assistant (docs/AI_HUB_PROPOSAL.md §4). One request for every
 * round trip with ChatGPT, Gemini or Claude: pick what to ask for, share one file, paste the one
 * reply format back, check every change, apply with a copy kept for Undo.
 *
 * Params: focus (an AiFocus), paste=1 (jump to the paste box), onboarding=1 (Continue setup when
 * done), local=1 (on-device AI's own setup, handed over in memory and read straight away).
 */
export default function AiRequestScreen() {
  const router = useRouter();
  const theme = useTheme();
  const alert = useAlert();
  const params = useLocalSearchParams<{ focus?: string; paste?: string; onboarding?: string; local?: string }>();
  const inOnboarding = params.onboarding === "1";
  const fromPhone = params.local === "1";

  // The focus asked for, or the one the waiting reply was asked for, or a full setup.
  const initialFocus: AiFocus = isAiFocus(params.focus) ? params.focus : (() => {
    const waiting = getAiRequestFocus();
    return isAiFocus(waiting) ? waiting : "everything";
  })();
  // "setup" (onboarding's wording) stays as asked until another is picked; it shows as "Set up everything".
  const [focus, setFocus] = useState<AiFocus>(initialFocus);
  const [period, setPeriod] = useState<Period>(defaultPeriod(initialFocus));
  const [includePeople, setIncludePeople] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [file, setFile] = useState<FixExport | null>(null);

  const [phase, setPhase] = useState<Phase>("ask");
  const [pasted, setPasted] = useState("");
  const [reading, setReading] = useState(false);
  const [reply, setReply] = useState<CorrectionsReply | null>(null);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [showRejected, setShowRejected] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; doing: string } | null>(null);
  const [result, setResult] = useState<CorrectionsResult | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // On-device AI already reads unknown messages, privately: don't offer to send them out too.
  const focuses = useMemo(() => {
    const nanoReads = isAiReadingOn();
    return AI_FOCUSES.filter((f) => f.id !== "messages" || !nanoReads || focus === "messages");
  }, [focus]);

  const scrollRef = useRef<ScrollView>(null);
  const pasteY = useRef(0);

  const pickFocus = (f: AiFocus) => {
    setFocus(f);
    setPeriod(defaultPeriod(f));
    setFile(null);
  };

  const share = async () => {
    setExporting(true);
    try {
      const f = await buildFixExport(DEFAULT_USER_ID, { includePeople, includeNotes, focus, period });
      setFile(f);
      setAiSetupPending(true, focus);
      await shareFixExport(f, focus);
    } catch (e) {
      alert("Couldn't make the file", e instanceof Error ? e.message : "Try again.");
    } finally {
      setExporting(false);
    }
  };

  const read = useCallback(
    async (text: string, quiet = false) => {
      if (!text.trim()) {
        if (quiet) setNote("Copy your assistant's whole reply, then paste it here.");
        else alert("Nothing to read", "Copy your assistant's whole reply, then paste it here.");
        return;
      }
      setReading(true);
      try {
        const r = await readCorrections(DEFAULT_USER_ID, text);
        if (!r.recognised) {
          if (quiet) setNote("What's copied isn't your assistant's reply yet. Copy its whole reply, then tap Paste from clipboard.");
          else alert("That isn't a reply for Arth", "Copy the assistant's whole reply, including the code block, and try again.");
          return;
        }
        setReply(r);
        // Income, savings target, investments and goals reshape the plan: each is a deliberate yes.
        setOff(new Set(r.accepted.filter((f) => DELIBERATE.has(f.type)).map((f) => f.key)));
        setPhase("review");
      } catch (e) {
        alert("Couldn't read the reply", e instanceof Error ? e.message : "Try again.");
      } finally {
        setReading(false);
      }
    },
    [alert],
  );

  const pasteFromClipboard = async (quiet = false) => {
    try {
      const text = await Clipboard.getStringAsync();
      if (quiet && !text.trim()) return;
      setPasted(text);
      if (text.trim()) await read(text, quiet);
    } catch {
      alert("Couldn't paste", "Long-press the box and paste instead.");
    }
  };

  // Some assistants hand the reply back as a file to download.
  const chooseFile = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.length) return;
      const text = await new File(picked.assets[0].uri).text();
      setPasted(text);
      await read(text);
    } catch {
      alert("Couldn't open that file", "Copy the reply from the chat instead and paste it here.");
    }
  };

  // On arrival. From on-device AI: read what it handed over. From "Paste reply": read the
  // clipboard straight away, and show the paste box.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    if (fromPhone) {
      const text = takeLocalReply();
      if (text) void read(text);
      else setNote("Nothing came back from on-device AI. Go back and try again, or set up by hand.");
    } else if (params.paste === "1") {
      void pasteFromClipboard(true);
    }
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const scrolledToPaste = useRef(params.paste !== "1");

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
      `Apply ${chosen.length} change${chosen.length === 1 ? "" : "s"}?`,
      "Arth saves a copy of all your data first. You can undo this until you apply your next AI changes. Undo puts everything back as it is now, so anything added after it is removed too.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Apply",
          onPress: async () => {
            setPhase("applying");
            setProgress({ done: 0, total: chosen.length, doing: "Starting" });
            try {
              const r = await applyCorrections(DEFAULT_USER_ID, chosen, setProgress, fromPhone ? "Set up on this phone" : focusLabel(focus));
              setResult(r);
              setAiSetupPending(false);
              setPhase("done");
            } catch (e) {
              logger.error("Ask your AI assistant: apply failed", e);
              alert("Couldn't apply the changes", `${e instanceof Error ? e.message : "Something went wrong"}. Use Undo to put things back if anything changed.`);
              setPhase("ask");
            }
          },
        },
      ],
    );
  };

  const undo = () => {
    if (!getUndoable()) return;
    alert("Undo all of this?", "Your data goes back to how it was just before these changes.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Undo",
        style: "destructive",
        onPress: async () => {
          setUndoing(true);
          try {
            await undoLastCorrection();
            setResult(null);
            setReply(null);
            setPasted("");
            setPhase("ask");
          } catch (e) {
            alert("Couldn't undo", e instanceof Error ? e.message : "Try again.");
          } finally {
            setUndoing(false);
          }
        },
      },
    ]);
  };

  const finish = () => {
    if (inOnboarding && result) {
      continueAfterAi(router, { set_income: result.byType.set_income, set_budget: result.byType.set_budget });
      return;
    }
    router.back();
  };

  // ── Applying ────────────────────────────────────────────────────────────────
  if (phase === "applying") {
    const p = progress;
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center px-8">
          <ActivityIndicator size="large" color={theme.primary} />
          <Text className="text-body font-semibold text-foreground mt-4 text-center">{p?.doing ?? "Applying"}</Text>
          {p && p.total > 0 && (
            <Text className="text-meta text-muted-foreground mt-1">
              {Math.min(p.done, p.total)} of {p.total}
            </Text>
          )}
          <Text className="text-label text-muted-foreground mt-4 text-center">Keep Arth open until this finishes.</Text>
        </View>
      </ScreenContainer>
    );
  }

  // ── Done: what changed ──────────────────────────────────────────────────────
  if (phase === "done" && result) {
    return (
      <ScreenContainer padTop={false}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 12 }}>
          <FormGroup icon="checkmark-done-outline" title={`${result.applied} change${result.applied === 1 ? "" : "s"} applied`} hint="A copy was kept, so you can undo it">
            {result.byGroup.map((g) => (
              <View key={g.label} className="flex-row justify-between">
                <Text className="text-meta text-muted-foreground flex-1 mr-2">{g.label}</Text>
                <Text className="text-meta text-foreground">{g.count}</Text>
              </View>
            ))}
          </FormGroup>

          <FormGroup icon="trending-up-outline" title="What moved">
            {result.changes.length === 0 ? (
              <Text className="text-meta text-muted-foreground">None of your headline figures changed.</Text>
            ) : (
              result.changes.map((c: MetricChange) => {
                const better = c.lowerIsBetter ? c.value < c.before : c.id === "health:score" ? c.value > c.before : null;
                return (
                  <View key={c.id} className="flex-row items-center">
                    <Text className="text-meta text-foreground flex-1 mr-2" numberOfLines={1}>
                      {c.label}
                    </Text>
                    <Text className="text-label text-muted-foreground mr-1.5">{showMetric(c, c.before)}</Text>
                    <Ionicons name="arrow-forward" size={11} color={theme.mutedForeground} />
                    <Text
                      className="text-body font-semibold ml-1.5"
                      style={{ color: better === true ? theme.success : better === false ? theme.warning : theme.foreground }}
                    >
                      {showMetric(c, c.value)}
                    </Text>
                  </View>
                );
              })
            )}
          </FormGroup>

          {(result.entriesMoved > 0 || result.readFromMessages > 0 || (result.byType.add_transaction ?? 0) > 0) && (
            <FormGroup
              icon="albums-outline"
              title={result.readFromMessages > 0 || (result.byType.add_transaction ?? 0) > 0 ? "Waiting for you" : "Also done"}
              hint={result.readFromMessages > 0 || (result.byType.add_transaction ?? 0) > 0 ? "New transactions wait in your review queue" : undefined}
            >
              {result.entriesMoved > 0 && (
                <Text className="text-meta text-foreground">
                  {result.entriesMoved} past {result.entriesMoved === 1 ? "entry moved to its category" : "entries moved to their categories"}
                </Text>
              )}
              {result.readFromMessages > 0 && (
                <Text className="text-meta text-foreground">
                  {result.readFromMessages} transaction{result.readFromMessages === 1 ? "" : "s"} read from your unread messages
                </Text>
              )}
              {(result.byType.add_transaction ?? 0) > 0 && (
                <Text className="text-meta text-foreground">
                  {result.byType.add_transaction} missing transaction{result.byType.add_transaction === 1 ? "" : "s"} added
                </Text>
              )}
              {(result.readFromMessages > 0 || (result.byType.add_transaction ?? 0) > 0) && (
                <Button title="Go to review queue" variant="outline" onPress={() => router.push("/expense/review-queue")} />
              )}
            </FormGroup>
          )}

          {result.failed.length > 0 && (
            <FormGroup icon="alert-circle-outline" title={`${result.failed.length} couldn't be applied`}>
              {result.failed.slice(0, 30).map((f, i) => (
                <Text key={i} className="text-meta text-muted-foreground">
                  {f.title}: {f.reason}
                </Text>
              ))}
            </FormGroup>
          )}
          <Text className="text-meta text-muted-foreground text-center">You can also undo it later from What AI changed, until your next AI changes.</Text>
        </ScrollView>
        <FormFooter primary={inOnboarding ? "Continue setup" : "Done"} onPrimary={finish} onCancel={undoing ? undefined : undo} cancelLabel="Undo all" />
      </ScreenContainer>
    );
  }

  // ── Review the reply ───────────────────────────────────────────────────────
  if (phase === "review" && reply) {
    return (
      <ScreenContainer padTop={false}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 12 }}>
          <Text className="text-meta text-muted-foreground leading-5">
            {reply.accepted.length} change{reply.accepted.length === 1 ? "" : "s"} checked against your data. Nothing has changed yet. Untick any
            you don&apos;t want.
            {reply.alreadySet > 0 ? ` ${reply.alreadySet} were already true and are left out.` : ""}
            {reply.cutOff ? " The reply was cut off at the end; ask your assistant to continue for the rest." : ""}
          </Text>

          {groups.map((g) => {
            const allOn = g.items.every((f) => !off.has(f.key));
            return (
              <View key={g.type} className="rounded-card bg-card border border-border p-4">
                <Pressable
                  onPress={() => toggle(g.items.map((f) => f.key), !allOn)}
                  className="flex-row items-center"
                  style={{ minHeight: 32 }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: allOn }}
                >
                  <Ionicons name={allOn ? "checkbox" : "square-outline"} size={20} color={allOn ? theme.primary : theme.mutedForeground} />
                  <Text className="text-body font-semibold text-foreground ml-2 flex-1" numberOfLines={1}>
                    {g.label}
                  </Text>
                  <Text className="text-meta text-muted-foreground">{g.items.length}</Text>
                </Pressable>
                {DELIBERATE.has(g.type) && <Text className="text-meta text-muted-foreground mt-1">Changes your plan. Check it before you apply.</Text>}
                {g.items.slice(0, 50).map((f: Fix) => {
                  const on = !off.has(f.key);
                  return (
                    <Pressable
                      key={f.key}
                      onPress={() => toggle([f.key], !on)}
                      className="flex-row mt-3"
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                    >
                      <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={18} color={on ? theme.primary : theme.mutedForeground} />
                      <View className="flex-1 ml-2">
                        <Text className="text-meta text-foreground" numberOfLines={1}>
                          {f.title}
                        </Text>
                        {f.detail ? (
                          <Text className="text-label text-muted-foreground mt-0.5" numberOfLines={2}>
                            {f.detail}
                          </Text>
                        ) : null}
                        {f.why ? (
                          <Text className="text-label text-muted-foreground mt-0.5" numberOfLines={2}>
                            “{f.why}”
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
                {g.items.length > 50 && <Text className="text-label text-muted-foreground mt-2">and {g.items.length - 50} more like these</Text>}
              </View>
            );
          })}

          {reply.rejected.length > 0 && (
            <View className="rounded-card bg-card border border-border p-4">
              <Pressable onPress={() => setShowRejected((v) => !v)} className="flex-row items-center" accessibilityRole="button">
                <Text className="text-body font-semibold text-foreground flex-1">{reply.rejected.length} left out</Text>
                <Ionicons name={showRejected ? "chevron-up" : "chevron-down"} size={16} color={theme.mutedForeground} />
              </Pressable>
              <Text className="text-meta text-muted-foreground mt-1">Wrong, or about something Arth couldn&apos;t find. Nothing from these is applied.</Text>
              {showRejected &&
                reply.rejected.slice(0, 60).map((r, i) => (
                  <Text key={i} className="text-label text-muted-foreground mt-2" numberOfLines={3}>
                    {r.reason}: {r.text}
                  </Text>
                ))}
            </View>
          )}
        </ScrollView>
        <FormFooter
          primary={`Apply ${chosen.length}`}
          onPrimary={apply}
          disabled={chosen.length === 0}
          onCancel={() => setPhase("ask")}
          cancelLabel="Back"
        />
      </ScreenContainer>
    );
  }

  // ── Ask: what for, share, paste ────────────────────────────────────────────
  if (fromPhone && reading) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center px-8">
          <ActivityIndicator size="large" color={theme.primary} />
          <Text className="text-body font-semibold text-foreground mt-4 text-center">Checking what on-device AI suggested</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}
        onContentSizeChange={() => {
          // Once: after that the screen scrolls only when you scroll it.
          if (scrolledToPaste.current || pasteY.current <= 0) return;
          scrolledToPaste.current = true;
          scrollRef.current?.scrollTo({ y: pasteY.current, animated: false });
        }}
      >
        <FormGroup icon="sparkles-outline" title="What to ask for" hint="ChatGPT, Gemini, Claude or any chat app">
          <View>
            {focuses.map((f) => (
              <RadioRow
                key={f.id}
                label={f.label}
                sub={f.hint}
                on={focus === f.id || (focus === "setup" && f.id === "everything")}
                onPress={() => pickFocus(f.id)}
              />
            ))}
          </View>
        </FormGroup>

        <FormGroup icon="document-text-outline" title="1. Share the file" hint="Your assistant gets it, with the request inside">
          <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground">Period</Text>
          <Segmented<Period>
            options={[
              { value: "last_12_months", label: "Last 12 months" },
              { value: "all_time", label: "All of it" },
            ]}
            value={period}
            onChange={(v) => {
              setPeriod(v);
              setFile(null);
            }}
          />
          <View className="flex-row items-center" style={{ minHeight: 44 }}>
            <Text className="text-body text-foreground flex-1 mr-3">Include people&apos;s names (Hisaab)</Text>
            <Toggle value={includePeople} onValueChange={setIncludePeople} accessibilityLabel="Include people's names" />
          </View>
          <View className="flex-row items-center" style={{ minHeight: 44 }}>
            <Text className="text-body text-foreground flex-1 mr-3">Include your notes</Text>
            <Toggle value={includeNotes} onValueChange={setIncludeNotes} accessibilityLabel="Include your notes" />
          </View>
          <Button title={file ? "Share again" : "Make the file and share"} onPress={() => void share()} loading={exporting} />
          <Text className="text-meta text-muted-foreground leading-5">
            {file
              ? `${file.transactions.toLocaleString("en-IN")} transactions · ${Math.max(1, Math.round(file.sizeBytes / 1024))} KB. The request is on your clipboard too.`
              : "What you share goes to that company's servers. The vault and full account numbers stay on this phone."}
          </Text>
        </FormGroup>

        <View
          onLayout={(e) => {
            pasteY.current = e.nativeEvent.layout.y;
          }}
        >
          <FormGroup icon="clipboard-outline" title="2. Paste its reply" hint="Arth checks every change before anything is saved">
            {note && <Text className="text-meta text-muted-foreground">{note}</Text>}
            <View className="flex-row" style={{ gap: 8 }}>
              <View className="flex-1">
                <Button title="Paste from clipboard" variant="outline" onPress={() => void pasteFromClipboard()} loading={reading} />
              </View>
              <View className="flex-1">
                <Button title="Choose a file" variant="outline" onPress={() => void chooseFile()} disabled={reading} />
              </View>
            </View>
            <TextInput
              value={pasted}
              onChangeText={setPasted}
              placeholder="Or long-press here and paste"
              placeholderTextColor={theme.mutedForeground}
              multiline
              className="text-meta text-foreground border border-border rounded-control px-3 py-2"
              style={{ minHeight: 90, maxHeight: 200, textAlignVertical: "top" }}
              accessibilityLabel="Assistant's reply"
            />
            {pasted.trim().length > 0 && <Button title="Read the reply" onPress={() => void read(pasted)} loading={reading} />}
          </FormGroup>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
