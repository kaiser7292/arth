import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useLocalSearchParams, useRouter } from "expo-router";

import { Button, Card, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import { setAiSetupPending } from "@/services/ai-share";
import {
  applySuggestions,
  readAiReply,
  SUGGESTION_GROUPS,
  type AiReply,
  type ApplyResult,
  type SuggestionType,
} from "@/services/ai-suggestions";

/** Rows shown per group before "Show more". */
const PREVIEW_ROWS = 5;

const APPLIED_WORDS: Record<SuggestionType, [string, string]> = {
  add_category: ["category added", "categories added"],
  fix_merchant: ["merchant name fixed", "merchant names fixed"],
  merchant_category: ["merchant given a category", "merchants given a category"],
  recategorise: ["entry re-categorised", "entries re-categorised"],
  add_rule: ["rule added", "rules added"],
  set_budget: ["budget set", "budgets set"],
  sms_template: ["SMS template added", "SMS templates added"],
  add_transaction: ["missing transaction sent to your review queue", "missing transactions sent to your review queue"],
};

const plural = (n: number, [one, many]: [string, string]) => `${n} ${n === 1 ? one : many}`;

export default function AiSuggestionsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ paste?: string }>();

  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reply, setReply] = useState<AiReply | null>(null);
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<SuggestionType>>(new Set());
  const [showLeftOut, setShowLeftOut] = useState(false);
  const [done, setDone] = useState<ApplyResult | null>(null);

  const read = useCallback(async (text: string) => {
    setMessage(null);
    setDone(null);
    if (!text.trim()) {
      setMessage("There's nothing copied yet. Copy your assistant's reply, then tap Paste AI reply.");
      return;
    }
    setBusy("Reading the reply...");
    try {
      const result = await readAiReply(DEFAULT_USER_ID, text);
      if (!result.recognised) {
        setReply(null);
        setMessage(
          "That doesn't look like a reply for Arth. Copy the assistant's whole reply, including the grey code block, and try again.",
        );
      } else {
        setReply(result);
        setUnticked(new Set());
        setExpanded(new Set());
      }
    } catch {
      setMessage("Couldn't read that. Try copying the reply again.");
    }
    setBusy(null);
  }, []);

  const pasteFromClipboard = useCallback(async () => read(await Clipboard.getStringAsync()), [read]);

  const chooseFile = useCallback(async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.length) return;
    try {
      await read(await new File(picked.assets[0].uri).text());
    } catch {
      setMessage("Couldn't open that file.");
    }
  }, [read]);

  // Opened from "Paste AI reply": read the clipboard straight away.
  useEffect(() => {
    if (params.paste === "1") pasteFromClipboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ticked = useMemo(() => reply?.accepted.filter((s) => !unticked.has(s.key)) ?? [], [reply, unticked]);

  const apply = useCallback(async () => {
    setBusy("Applying...");
    try {
      setDone(await applySuggestions(DEFAULT_USER_ID, ticked));
      setReply(null);
      setAiSetupPending(false);
    } catch {
      setMessage("Something went wrong while applying. Nothing else was changed.");
    }
    setBusy(null);
  }, [ticked]);

  const toggle = (key: number) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const setGroup = (keys: number[], tick: boolean) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (tick) next.delete(k);
        else next.add(k);
      }
      return next;
    });

  if (busy) return <LoadingState message={busy} />;

  const sectionLabel = "text-xs font-semibold uppercase tracking-wider text-muted-foreground";

  return (
    <ScreenContainer padTop={false}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-4 pt-2">
          {done ? (
            <>
              <View className="items-center py-6">
                <Ionicons name="checkmark-circle" size={48} color={theme.success} />
                <Text className="text-lg font-medium text-foreground mt-3">
                  {Object.keys(done.applied).length > 0 ? "Changes applied" : "Nothing was applied"}
                </Text>
              </View>
              <Card>
                {SUGGESTION_GROUPS.filter((g) => done.applied[g.type]).map((g) => (
                  <Text key={g.type} className="text-sm text-foreground py-1.5">
                    {plural(done.applied[g.type]!, APPLIED_WORDS[g.type])}
                  </Text>
                ))}
                {done.entriesMoved > 0 && (
                  <Text className="text-sm text-foreground py-1.5">
                    {plural(done.entriesMoved, ["past entry moved to its category", "past entries moved to their categories"])}
                  </Text>
                )}
                {done.readFromMessages > 0 && (
                  <Text className="text-sm text-foreground py-1.5">
                    {plural(done.readFromMessages, [
                      "transaction read from your unread messages, waiting in your review queue",
                      "transactions read from your unread messages, waiting in your review queue",
                    ])}
                  </Text>
                )}
              </Card>
              {done.failed.length > 0 && (
                <View className="mt-3 p-3 rounded-lg bg-warning/8">
                  <Text className="text-sm font-medium mb-1" style={{ color: theme.warning }}>
                    {plural(done.failed.length, ["change couldn't be applied", "changes couldn't be applied"])}
                  </Text>
                  {done.failed.map((f) => (
                    <Text key={f} className="text-xs text-muted-foreground">{f}</Text>
                  ))}
                </View>
              )}
              {(done.readFromMessages > 0 || done.applied.add_transaction) && (
                <Button title="Go to review queue" onPress={() => router.push("/expense/review-queue")} className="mt-4" />
              )}
              <Button title="Done" variant="outline" onPress={() => router.back()} className="mt-2" />
            </>
          ) : reply ? (
            <>
              <Text className="text-xs text-muted-foreground leading-5">
                {plural(reply.accepted.length, ["suggestion", "suggestions"])} read
                {reply.alreadySet > 0 ? ` · ${reply.alreadySet} already set` : ""}
                {reply.rejected.length > 0 ? ` · ${reply.rejected.length} left out` : ""}. Nothing changes until you
                tap Apply.
              </Text>
              {reply.cutOff && (
                <Text className="text-xs mt-1" style={{ color: theme.warning }}>
                  The reply was cut off part way. Everything before the cut was read; ask the assistant to continue for
                  the rest.
                </Text>
              )}
              {reply.rejected.length > 0 && (
                <Pressable onPress={() => setShowLeftOut((v) => !v)} className="py-2" accessibilityRole="button">
                  <Text className="text-xs font-medium" style={{ color: theme.primary }}>
                    {showLeftOut ? "Hide what was left out" : "Why were some left out?"}
                  </Text>
                </Pressable>
              )}
              {showLeftOut && (
                <Card>
                  {reply.rejected.map((r, i) => (
                    <View key={i} className={`py-2 ${i < reply.rejected.length - 1 ? "border-b border-border" : ""}`}>
                      <Text className="text-sm text-foreground">{r.reason}</Text>
                      <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={2}>{r.text}</Text>
                    </View>
                  ))}
                </Card>
              )}

              {SUGGESTION_GROUPS.map((group) => {
                const items = reply.accepted.filter((s) => s.type === group.type);
                if (items.length === 0) return null;
                const keys = items.map((s) => s.key);
                const allTicked = keys.every((k) => !unticked.has(k));
                const shown = expanded.has(group.type) ? items : items.slice(0, PREVIEW_ROWS);
                return (
                  <View key={group.type}>
                    <View className="flex-row items-center justify-between mt-5 mb-2">
                      <Text className={sectionLabel}>{group.label} · {items.length}</Text>
                      <Pressable onPress={() => setGroup(keys, !allTicked)} hitSlop={8} accessibilityRole="button">
                        <Text className="text-xs font-medium" style={{ color: theme.primary }}>
                          {allTicked ? "Untick all" : "Tick all"}
                        </Text>
                      </Pressable>
                    </View>
                    <Card>
                      {shown.map((s, i) => (
                        <Pressable
                          key={s.key}
                          onPress={() => toggle(s.key)}
                          className={`flex-row items-center py-2.5 ${i < shown.length - 1 || shown.length < items.length ? "border-b border-border" : ""}`}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: !unticked.has(s.key) }}
                        >
                          <View className="flex-1 mr-3">
                            <Text className="text-sm text-foreground">{s.title}</Text>
                            {s.detail && <Text className="text-xs text-muted-foreground mt-0.5">{s.detail}</Text>}
                            {s.why && <Text className="text-xs text-muted-foreground mt-0.5 italic">{`"${s.why}"`}</Text>}
                          </View>
                          <Ionicons
                            name={unticked.has(s.key) ? "square-outline" : "checkbox"}
                            size={22}
                            color={unticked.has(s.key) ? theme.border : theme.primary}
                          />
                        </Pressable>
                      ))}
                      {shown.length < items.length && (
                        <Pressable
                          onPress={() => setExpanded((prev) => new Set(prev).add(group.type))}
                          className="py-2.5"
                          accessibilityRole="button"
                        >
                          <Text className="text-xs font-medium" style={{ color: theme.primary }}>
                            Show {items.length - shown.length} more
                          </Text>
                        </Pressable>
                      )}
                    </Card>
                  </View>
                );
              })}

              {reply.accepted.length === 0 ? (
                <Text className="text-sm text-muted-foreground text-center mt-6">
                  There is nothing to apply from this reply.
                </Text>
              ) : (
                <Button
                  title={`Apply ${ticked.length} ticked`}
                  onPress={apply}
                  disabled={ticked.length === 0}
                  className="mt-5"
                />
              )}
              <Button title="Paste a different reply" variant="outline" onPress={pasteFromClipboard} className="mt-2" />
            </>
          ) : (
            <>
              <View className="items-center py-6">
                <Ionicons name="sparkles-outline" size={48} color={theme.primary} />
                <Text className="text-lg font-medium text-foreground mt-3">Bring the reply back</Text>
                <Text className="text-sm text-muted-foreground text-center mt-1 leading-5">
                  In your assistant, tap copy on its reply. Then tap below. Nothing changes until you approve it.
                </Text>
              </View>
              {message && (
                <Text className="text-sm text-center mb-3" style={{ color: theme.warning }}>{message}</Text>
              )}
              <Button title="Paste AI reply" onPress={pasteFromClipboard} />
              <Button title="Choose a file instead" variant="outline" onPress={chooseFile} className="mt-2" />
            </>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
