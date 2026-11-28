import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Chip, ChipWrap, ScreenContainer, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { useVoiceCapture } from "@/hooks/use-voice-capture";
import { isSpeechRecognitionAvailable } from "@/services/speech-recognition";
import type { Category } from "@/services/category";
import type { AskContext } from "@/services/ask/plan";
import { PERIOD_KEYS, PERIOD_LABEL, readQuestionRules } from "@/services/ask/plan";
import { answerPlan, askArth, EXAMPLE_QUESTIONS, loadAskContext, withPeriod, type AskAnswer, type AskPlan } from "@/services/ask-arth";
import { formatReportShort } from "@/utils/format";
import { useStackScreenOptions } from "@/components/ui/stack-options";
import { isAiJobOn } from "@/services/ai/ai-reading";
import { getNanoStatus, ON_DEVICE_MODEL_NAME } from "@/services/ai/nano";
import { wordReplyWithNano } from "@/services/ai/tasks/word-reply";

/**
 * Ask Arth (docs/SPEED_AND_VOICE_PROPOSAL.md §2.3; screens on the design canvas "Arth: Ask Arth"):
 * opened from the ✦ in every header. A thread of questions and answers: each answer shows how
 * Arth read the question ("Read as" chips, the period one changeable in place), the figures, a list
 * or month bars, and the transactions behind it. Follow-ups keep the last question's context.
 */
interface Turn {
  id: number;
  said: string;
  plan: AskPlan | null;
  answer: AskAnswer;
  /** The reply worded by on-device AI, checked against the answer's figures; null: the code's own. */
  aiReply?: string | null;
}

export default function AskScreen() {
  const router = useRouter();
  const theme = useTheme();
  const stackOptions = useStackScreenOptions();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  /** Per turn: the latest period change, so a slower earlier one can't land over it. */
  const periodSeq = useRef(new Map<number, number>());
  const [text, setText] = useState("");
  const [thread, setThread] = useState<Turn[]>([]);
  const [working, setWorking] = useState(false);
  /** The turn whose period chip is open. */
  const [editing, setEditing] = useState<number | null>(null);
  const ctxRef = useRef<(AskContext & { categories: Category[] }) | null>(null);
  const lastPlan = useRef<AskPlan | null>(null);
  const seq = useRef(0);
  const nextId = useRef(1);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    loadAskContext()
      .then((c) => (ctxRef.current = c))
      .catch(() => {});
  }, []);

  const ask = useCallback(async (said: string) => {
    const q = said.trim();
    if (!q) return;
    const mine = ++seq.current;
    setText("");
    setWorking(true);
    try {
      // Fresh each time, so a merchant or category added since is known.
      const ctx = (ctxRef.current = await loadAskContext().catch(() => ctxRef.current ?? { merchants: [], categories: [] }));
      const { plan, answer } = await askArth(q, ctx, lastPlan.current);
      if (mine !== seq.current) return;
      if (plan) lastPlan.current = plan;
      const id = nextId.current++;
      setThread((t) => [...t, { id, said: q, plan, answer }].slice(-12));
      // The reply in natural words, when the phone has on-device AI: it arrives a moment later
      // and replaces the plain sentence only if every number and name checks out.
      if (plan && isAiJobOn("voice")) {
        void (async () => {
          if ((await getNanoStatus().catch(() => "unavailable")) !== "available") return;
          const worded = await wordReplyWithNano(q, answer);
          if (worded) setThread((t) => t.map((x) => (x.id === id && x.answer === answer ? { ...x, aiReply: worded } : x)));
        })();
      }
    } catch {
      if (mine !== seq.current) return;
      setThread((t) => [...t, { id: nextId.current++, said: q, plan: null, answer: { sentence: "Something went wrong working that out. Try again in a moment.", figures: [], expenseIds: [], seeTitle: "" } }]);
    } finally {
      if (mine === seq.current) setWorking(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, []);

  /** Change a turn's period from its chip, and answer again in place. */
  const changePeriod = useCallback(async (turn: Turn, key: string) => {
    if (!turn.plan) return;
    setEditing(null);
    const mine = (periodSeq.current.get(turn.id) ?? 0) + 1;
    periodSeq.current.set(turn.id, mine);
    const plan = withPeriod(turn.plan, key);
    try {
      const ctx = ctxRef.current ?? (await loadAskContext());
      const answer = await answerPlan(plan, ctx.categories);
      if (periodSeq.current.get(turn.id) !== mine) return;
      lastPlan.current = plan;
      setThread((t) => t.map((x) => (x.id === turn.id ? { ...x, plan, answer, aiReply: null } : x)));
    } catch {
      // Keep the answer as it was, with its own reading.
    }
  }, []);

  const voice = useVoiceCapture({
    onFinal: (guesses) => {
      // The guess the rules can read, else the first.
      const ctx = ctxRef.current;
      const best = ctx ? guesses.find((g) => readQuestionRules(g, ctx, lastPlan.current).plan != null) ?? guesses[0] : guesses[0];
      void ask(best);
    },
  });
  const listening = voice.state === "listening";
  useFocusEffect(useCallback(() => () => voice.abort(), [voice.abort]));

  const last = thread[thread.length - 1];
  const chips = thread.length === 0 ? EXAMPLE_QUESTIONS.slice(0, 4) : last?.answer.examples ?? last?.answer.suggestions ?? [];

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen
        options={{
          ...stackOptions,
          headerShown: true,
          title: "Ask Arth",
          headerRight: () =>
            thread.length > 0 ? (
              <Pressable
                onPress={() => {
                  // A question still being worked out belongs to the old conversation.
                  seq.current++;
                  setThread([]);
                  setEditing(null);
                  setWorking(false);
                  lastPlan.current = null;
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Start a new conversation"
                style={{ padding: 4, marginRight: 4 }}
              >
                <Text className="text-meta font-semibold" style={{ color: theme.primary }}>
                  New
                </Text>
              </Pressable>
            ) : null,
        }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
        <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 16 }}>
          {thread.length === 0 && (
            <View className="pt-6 items-center">
              <Ionicons name="sparkles-outline" size={28} color={theme.primary} />
              <Text className="text-heading font-semibold text-foreground mt-2 text-center">Ask anything about your money</Text>
              <Text className="text-meta text-muted-foreground mt-1 text-center">
                Spending, merchants, categories, budgets, any period. It's worked out on this phone.
              </Text>
            </View>
          )}

          {thread.map((t) => (
            <View key={t.id} style={{ gap: 8 }}>
              <View className="self-end rounded-card px-3.5 py-2.5" style={{ maxWidth: "82%", backgroundColor: theme.alpha("primary", 0.16), borderBottomRightRadius: 4 }}>
                <Text className="text-body text-foreground">{t.said}</Text>
              </View>

              {t.answer.reading && (
                <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
                  <Text className="text-label text-muted-foreground">Read as</Text>
                  {t.answer.reading.map((c) => (
                    <Pressable
                      key={c.key}
                      onPress={c.key === "period" ? () => setEditing((e) => (e === t.id ? null : t.id)) : undefined}
                      disabled={c.key !== "period"}
                      className="flex-row items-center rounded-pill border border-border bg-card px-2.5 py-1"
                      style={{ gap: 4 }}
                      accessibilityRole={c.key === "period" ? "button" : undefined}
                      accessibilityLabel={c.key === "period" ? `Period: ${c.label}. Tap to change` : c.label}
                    >
                      <Text className="text-label font-semibold text-foreground">{c.label}</Text>
                      {c.key === "period" && <Ionicons name="chevron-down" size={11} color={theme.mutedForeground} />}
                    </Pressable>
                  ))}
                </View>
              )}
              {editing === t.id && (
                <ChipWrap>
                  {PERIOD_KEYS.slice(0, 5).map((k) => (
                    <Chip key={k} label={PERIOD_LABEL[k]} onPress={() => void changePeriod(t, k)} />
                  ))}
                </ChipWrap>
              )}

              <Text className="text-body text-foreground leading-6" style={{ fontSize: 16 }}>
                {t.aiReply ?? t.answer.sentence}
              </Text>
              {t.aiReply ? (
                <Text className="text-label text-faint-foreground">Worded by {ON_DEVICE_MODEL_NAME} on this phone · figures worked out by Arth</Text>
              ) : null}

              {t.answer.bars && t.answer.bars.length > 1 && (() => {
                const max = Math.max(1, ...t.answer.bars!.map((b) => b.value));
                return (
                  <View className="rounded-card bg-card border border-border p-3">
                    <View className="flex-row items-end" style={{ height: 90, gap: 4 }} accessible accessibilityLabel="Spending each month">
                      {t.answer.bars!.map((b, i) => (
                        <View key={i} className="flex-1 justify-end" style={{ height: 90 }}>
                          <View className="rounded-control" style={{ height: b.value > 0 ? Math.max(4, Math.round((b.value / max) * 86)) : 2, backgroundColor: b.value > 0 ? theme.primary : theme.border }} />
                        </View>
                      ))}
                    </View>
                    <View className="flex-row mt-1" style={{ gap: 4 }}>
                      {t.answer.bars!.map((b, i) => (
                        <Text key={i} className="flex-1 text-center text-label text-muted-foreground" numberOfLines={1}>
                          {t.answer.bars!.length > 12 ? b.label[0] : b.label}
                        </Text>
                      ))}
                    </View>
                    <Text className="text-label text-muted-foreground mt-1">Biggest month: {formatReportShort(max)}</Text>
                  </View>
                )
              })()}

              {(t.answer.figures.length > 0 || (t.answer.list && t.answer.list.length > 0)) && (
                <View className="rounded-card bg-card border border-border px-3 py-1.5">
                  {t.answer.figures.map((f) => (
                    <View key={f.label} className="flex-row py-1">
                      <Text className="text-meta text-muted-foreground flex-1" numberOfLines={1}>{f.label}</Text>
                      <Text className="text-meta font-semibold text-foreground">{f.value}</Text>
                    </View>
                  ))}
                  {t.answer.list?.slice(0, 8).map((f, i) => (
                    <View key={`${f.label}-${i}`} className="flex-row py-1.5" style={i > 0 || t.answer.figures.length ? { borderTopWidth: 1, borderTopColor: theme.border } : undefined}>
                      <Text className="text-meta text-foreground flex-1" numberOfLines={1}>{f.label}</Text>
                      <Text className="text-meta font-semibold text-foreground">{f.value}</Text>
                    </View>
                  ))}
                  {t.answer.list && t.answer.list.length > 8 && (
                    <Text className="text-label text-muted-foreground py-1.5">and {t.answer.list.length - 8} more</Text>
                  )}
                </View>
              )}

              {t.answer.expenseIds.length > 0 && (
                <Pressable
                  onPress={() => router.push({ pathname: "/insights/filtered", params: { expenseIds: t.answer.expenseIds.slice(0, 500).join(","), title: t.answer.seeTitle } })}
                  className="self-start"
                  hitSlop={6}
                  accessibilityRole="button"
                >
                  <Text className="text-meta font-semibold" style={{ color: theme.primary }}>
                    See {t.answer.expenseIds.length === 1 ? "it" : `these ${t.answer.expenseIds.length}`}
                  </Text>
                </Pressable>
              )}
            </View>
          ))}

          {working && <Text className="text-meta text-muted-foreground">Working it out…</Text>}
          {voice.error && (
            <Text className="text-meta" style={{ color: theme.danger }}>
              {voice.error}
            </Text>
          )}
        </ScrollView>

        {chips.length > 0 && !working && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 8 }}>
            {chips.map((c) => (
              <Chip key={c} label={c} onPress={() => void ask(c.replace(/^Payments mentioning “(.+)”$/, "payments mentioning $1"))} />
            ))}
          </ScrollView>
        )}

        <View className="flex-row items-center px-3 pt-2 border-t border-border" style={{ gap: 8, paddingBottom: 12 + insets.bottom }}>
          <TextInput
            value={listening ? voice.live : text}
            onChangeText={setText}
            editable={!listening}
            placeholder={listening ? "Listening…" : thread.length ? "Ask a follow-up" : "Ask anything about your money"}
            placeholderTextColor={theme.mutedForeground}
            onSubmitEditing={() => void ask(text)}
            returnKeyType="send"
            className="flex-1 rounded-pill border border-border bg-card px-4 text-body text-foreground"
            style={{ height: 46 }}
            accessibilityLabel="Ask Arth a question"
          />
          {text.trim() && !listening ? (
            <Pressable onPress={() => void ask(text)} accessibilityRole="button" accessibilityLabel="Ask" className="items-center justify-center rounded-pill" style={{ width: 46, height: 46, backgroundColor: theme.primary }}>
              <Ionicons name="arrow-up" size={20} color={theme.primaryForeground} />
            </Pressable>
          ) : isSpeechRecognitionAvailable ? (
            <Pressable
              onPress={() => (listening ? voice.stop() : void voice.start([...(ctxRef.current?.merchants.slice(0, 50) ?? []), ...(ctxRef.current?.categories.map((c) => c.name) ?? [])]))}
              accessibilityRole="button"
              accessibilityLabel={listening ? "Done speaking" : "Ask by voice"}
              className="items-center justify-center rounded-pill"
              style={{ width: 46, height: 46, backgroundColor: listening ? theme.danger : theme.primary }}
            >
              <Ionicons name={listening ? "stop" : "mic-outline"} size={20} color={theme.primaryForeground} />
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
