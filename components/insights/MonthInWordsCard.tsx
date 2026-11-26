import { useCallback, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { isAiJobOn } from "@/services/ai/ai-reading";
import { getNanoStatus } from "@/services/ai/nano";
import { loadMonthFacts, savedSentences, writeMonthNote, type MonthFact } from "@/services/ai/tasks/month-note";
import { logger } from "@/utils/logger";

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * "Your month in words" at the top of Insights (services/ai/tasks/month-note.ts). The facts show at
 * once in Insights' own wording; on phones with on-device AI they're rewritten as plain sentences
 * when ready, checked number by number. Each line opens what it's about. Shows nothing when there
 * are no facts yet (a new month, no history).
 */
export function MonthInWordsCard() {
  const theme = useTheme();
  const router = useRouter();
  const [which, setWhich] = useState<"this" | "last">("this");
  const [facts, setFacts] = useState<MonthFact[]>([]);
  const [sentences, setSentences] = useState<(string | null)[] | null>(null);
  const [writing, setWriting] = useState(false);
  /** Only the latest load may write (period switched mid-load). */
  const loadSeq = useRef(0);
  /** The facts being written right now, if any. */
  const writingKey = useRef<string | null>(null);

  const now = new Date();
  const month = which === "this" ? ym(now) : ym(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const f = await loadMonthFacts(month, which === "this");
      if (seq !== loadSeq.current) return;
      // New facts: no sentences until the ones for these facts are found (never another month's).
      setFacts(f);
      setSentences(null);
      if (f.length === 0) return setSentences(null);
      const saved = await savedSentences(month, f);
      if (seq !== loadSeq.current) return;
      setSentences(saved);
      if (saved || !isAiJobOn("month_note")) return;
      if ((await getNanoStatus().catch(() => "unavailable")) !== "available") return;
      // One write per set of facts at a time: data refreshes mid-write don't start another.
      const key = `${month}|${f.map((x) => x.text).join("|")}`;
      if (writingKey.current === key) return;
      writingKey.current = key;
      setWriting(true);
      const written = await writeMonthNote(month, f)
        .catch((e) => {
          logger.warn("Month in words: AI didn't write it (plain facts shown)", e);
          return null;
        })
        .finally(() => {
          if (writingKey.current === key) writingKey.current = null;
        });
      if (seq === loadSeq.current && written) setSentences(written);
    } catch (e) {
      logger.warn("Month in words: load failed", e);
      if (seq === loadSeq.current) setFacts([]);
    } finally {
      if (seq === loadSeq.current) setWriting(false);
    }
  }, [month, which]);

  useDataRefresh(load);

  if (facts.length === 0) return null;
  return (
    <Card className="mb-3">
      <View className="flex-row items-center mb-2">
        <Ionicons name="sparkles-outline" size={16} color={theme.primary} />
        <Text className="text-base font-semibold text-foreground ml-2 flex-1">Your month in words</Text>
        {(["this", "last"] as const).map((w) => (
          <Pressable
            key={w}
            onPress={() => setWhich(w)}
            className="px-2.5 py-1 rounded-full ml-1"
            style={{ backgroundColor: which === w ? theme.alpha("primary", 0.12) : "transparent" }}
            accessibilityRole="button"
            accessibilityState={{ selected: which === w }}
          >
            <Text className="text-xs font-semibold" style={{ color: which === w ? theme.primary : theme.mutedForeground }}>
              {w === "this" ? "This month" : "Last month"}
            </Text>
          </Pressable>
        ))}
      </View>
      {facts.map((f, i) => (
        <Pressable
          key={f.text}
          onPress={() => router.push((f.href.params ? { pathname: f.href.pathname, params: f.href.params } : f.href.pathname) as never)}
          className="flex-row items-start py-1.5"
          accessibilityRole="button"
        >
          <Text className="text-sm text-foreground flex-1 leading-5">{sentences?.[i] ?? f.text}</Text>
          <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} style={{ marginTop: 3, marginLeft: 6 }} />
        </Pressable>
      ))}
      {writing && <Text className="text-label text-muted-foreground mt-1">Writing it in plain words, on this phone…</Text>}
    </Card>
  );
}
