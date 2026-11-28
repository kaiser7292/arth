import { useCallback, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Card, Text } from "@/components/ui";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { AI_JOBS, isAiJobSwitchOn, setAiJobSwitch, type AiJobKey } from "@/services/ai/ai-reading";
import { countAiItems, loadCatchUpAiItems } from "@/services/catch-up-ai";

/**
 * Settings → AI → On this phone: a switch per job (services/ai/ai-reading.ts AI_JOBS). What the
 * jobs offer for a decision (formats ready to learn, "Same place?") waits in Catch Up
 * (docs/AI_HUB_PROPOSAL.md §3); this only says how many and links there.
 */
export function AiJobsSettings() {
  const router = useRouter();
  const theme = useTheme();
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(AI_JOBS.map((j) => [j.key, isAiJobSwitchOn(j.key)])));
  const [waiting, setWaiting] = useState(0);

  useDataRefresh(
    useCallback(async () => {
      const items = await loadCatchUpAiItems().catch(() => null);
      // The assistant's reply isn't on-device AI's: count only what the jobs offered.
      setWaiting(items ? countAiItems({ ...items, replyWaiting: false }) : 0);
    }, []),
  );

  const toggle = (key: AiJobKey, v: boolean) => {
    setOn((s) => ({ ...s, [key]: v }));
    setAiJobSwitch(key, v);
  };

  return (
    <>
      {waiting > 0 && (
        <Pressable
          onPress={() => router.push("/expense/catch-up")}
          className="flex-row items-center rounded-card px-4 mb-4"
          style={{ minHeight: 52, backgroundColor: theme.alpha("primary", 0.08) }}
          accessibilityRole="button"
        >
          <Ionicons name="albums-outline" size={18} color={theme.primary} />
          <Text className="text-body font-semibold flex-1 ml-3" style={{ color: theme.primary }} numberOfLines={1}>
            {waiting} suggestion{waiting === 1 ? "" : "s"} waiting in Catch Up
          </Text>
          <Ionicons name="chevron-forward" size={16} color={theme.primary} />
        </Pressable>
      )}

      <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">What else it does</Text>
      <Card className="mb-4">
        {AI_JOBS.map((j, i) => (
          <View key={j.key} className={`flex-row items-center${i > 0 ? " pt-3 mt-3 border-t border-border" : ""}`}>
            <View className="flex-1 mr-3">
              <Text className="text-body font-semibold text-foreground">{j.label}</Text>
              <Text className="text-meta text-muted-foreground mt-0.5">{j.note}</Text>
            </View>
            <Switch value={on[j.key] !== false} onValueChange={(v) => toggle(j.key, v)} accessibilityLabel={j.label} />
          </View>
        ))}
      </Card>
    </>
  );
}
