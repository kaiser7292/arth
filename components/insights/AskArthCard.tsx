import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, Chip, ChipWrap, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { useVoiceCapture } from "@/hooks/use-voice-capture";
import { isSpeechRecognitionAvailable } from "@/services/speech-recognition";
import type { Category } from "@/services/category";
import {
  answerQuestion,
  askFyStart,
  cannotAnswer,
  EXAMPLE_QUESTIONS,
  loadAskContext,
  readQuestion,
  type AskAnswer,
  type AskQuestion,
} from "@/services/ask-arth";

/**
 * Ask Arth at the top of Insights (docs/SPEED_AND_VOICE_PROPOSAL.md §2.3): type or say a question,
 * get a reply in a sentence with the figures underneath and the transactions behind it. A short
 * thread: "and last month?" keeps the rest of the question before.
 */
interface Turn {
  said: string;
  answer: AskAnswer;
}

const THREAD = 3;

export function AskArthCard() {
  const router = useRouter();
  const theme = useTheme();
  const [text, setText] = useState("");
  const [thread, setThread] = useState<Turn[]>([]);
  const [working, setWorking] = useState(false);
  const lastQ = useRef<AskQuestion | null>(null);
  const ctxRef = useRef<{ merchants: string[]; categories: Category[] } | null>(null);
  const askSeq = useRef(0);

  useEffect(() => {
    loadAskContext()
      .then((c) => {
        ctxRef.current = c;
      })
      .catch(() => {});
  }, []);

  const ask = useCallback(async (said: string) => {
    const q0 = said.trim();
    if (!q0) return;
    const seq = ++askSeq.current;
    setWorking(true);
    setText("");
    try {
      // Fresh each time, so a merchant or category added since is known.
      const ctx = (ctxRef.current = await loadAskContext().catch(() => ctxRef.current ?? { merchants: [], categories: [] }));
      const q = readQuestion(q0, ctx, lastQ.current, new Date(), askFyStart());
      const answer = q ? await answerQuestion(q, ctx.categories) : cannotAnswer();
      if (seq !== askSeq.current) return;
      if (q) lastQ.current = q;
      setThread((t) => [...t, { said: q0, answer }].slice(-THREAD));
    } catch {
      if (seq !== askSeq.current) return;
      setThread((t) => [...t, { said: q0, answer: { ...cannotAnswer(), sentence: "Something went wrong working that out. Try again in a moment." } }].slice(-THREAD));
    } finally {
      if (seq === askSeq.current) setWorking(false);
    }
  }, []);

  const voice = useVoiceCapture({
    onFinal: (guesses) => {
      // The guess Arth can answer, else the best one.
      const ctx = ctxRef.current;
      const best = ctx ? guesses.find((g) => readQuestion(g, ctx, lastQ.current) != null) ?? guesses[0] : guesses[0];
      void ask(best);
    },
  });
  const listening = voice.state === "listening";
  // Leaving the page stops listening.
  useFocusEffect(useCallback(() => () => voice.abort(), [voice.abort]));

  const examples = thread.length === 0 ? EXAMPLE_QUESTIONS.slice(0, 3) : thread[thread.length - 1].answer.examples;

  return (
    <Card className="mb-3">
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.primary} />
        <Text className="text-body font-semibold text-foreground flex-1">Ask Arth</Text>
        {thread.length > 0 && (
          <Pressable
            onPress={() => {
              setThread([]);
              lastQ.current = null;
            }}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text className="text-label font-semibold" style={{ color: theme.primary }}>
              Clear
            </Text>
          </Pressable>
        )}
      </View>

      {thread.map((t, i) => (
        <View key={`${i}-${t.said}`} className="mt-3">
          <Text className="text-meta text-muted-foreground" numberOfLines={2}>
            You: {t.said}
          </Text>
          <Text className="text-body text-foreground mt-1 leading-6">{t.answer.sentence}</Text>
          {t.answer.figures.length > 0 && (
            <View className="mt-2 rounded-control px-3 py-2" style={{ backgroundColor: theme.alpha("primary", 0.06) }}>
              {t.answer.figures.map((f) => (
                <View key={f.label} className="flex-row py-0.5">
                  <Text className="text-meta text-muted-foreground flex-1" numberOfLines={1}>
                    {f.label}
                  </Text>
                  <Text className="text-meta font-semibold text-foreground">{f.value}</Text>
                </View>
              ))}
            </View>
          )}
          {t.answer.expenseIds.length > 0 && (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/insights/filtered",
                  params: { expenseIds: t.answer.expenseIds.slice(0, 500).join(","), title: t.answer.seeTitle },
                })
              }
              className="mt-1.5 self-start"
              hitSlop={6}
              accessibilityRole="button"
            >
              <Text className="text-meta font-semibold" style={{ color: theme.primary }}>
                See these transactions
              </Text>
            </Pressable>
          )}
        </View>
      ))}

      {examples && examples.length > 0 && !working && (
        <ChipWrap className="mt-3">
          {examples.map((e) => (
            <Chip key={e} label={e} onPress={() => void ask(e)} />
          ))}
        </ChipWrap>
      )}

      {working && <Text className="text-meta text-muted-foreground mt-3">Working it out…</Text>}
      {voice.error && (
        <Text className="text-meta mt-2" style={{ color: theme.danger }}>
          {voice.error}
        </Text>
      )}

      <View className="flex-row items-center mt-3 rounded-control border border-border px-3" style={{ gap: 8 }}>
        <TextInput
          value={listening ? voice.live : text}
          onChangeText={setText}
          editable={!listening}
          placeholder={listening ? "Listening…" : thread.length ? "Ask a follow-up: and last month?" : "What did I spend by day 15?"}
          placeholderTextColor={theme.mutedForeground}
          onSubmitEditing={() => void ask(text)}
          returnKeyType="send"
          className="flex-1 py-2.5 text-body text-foreground"
          accessibilityLabel="Ask Arth a question about your money"
        />
        {text.trim() && !listening ? (
          <Pressable onPress={() => void ask(text)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Ask">
            <Ionicons name="arrow-up-circle" size={26} color={theme.primary} />
          </Pressable>
        ) : isSpeechRecognitionAvailable ? (
          <Pressable
            onPress={() => (listening ? voice.stop() : void voice.start([...(ctxRef.current?.merchants.slice(0, 50) ?? []), ...(ctxRef.current?.categories.map((c) => c.name) ?? []), "spend", "budget", "last month", "this month"]))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={listening ? "Done speaking" : "Ask by voice"}
          >
            <Ionicons name={listening ? "radio-button-on" : "mic-outline"} size={22} color={listening ? theme.danger : theme.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}
