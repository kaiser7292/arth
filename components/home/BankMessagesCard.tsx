import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Platform, Pressable, View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";

import { Button, Card, Text } from "@/components/ui";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getExpensesByIds } from "@/services/expense";
import { getLastArrival, markArrivalSeen } from "@/services/message-inbox";

/** A batch older than this no longer counts as "just in". */
const FRESH_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * iPhone: "3 bank messages read · 2 to review · 1 couldn't be read" - the bank messages the
 * Shortcut handed over arrive in the background, and this says what came of them. Opens "Just
 * arrived". Self-loading; hidden on Android, once opened or dismissed, and when nothing's left.
 */
export function BankMessagesCard() {
  const router = useRouter();
  const theme = useTheme();
  const [summary, setSummary] = useState<{ read: number; toReview: number; unreadable: number } | null>(null);

  useDataRefresh(
    useCallback(async () => {
      if (Platform.OS !== "ios") return;
      const a = getLastArrival();
      if (!a || a.seen || Date.now() - a.at > FRESH_MS) {
        setSummary(null);
        return;
      }
      const rows = a.addedIds.length ? await getExpensesByIds(a.addedIds).catch(() => []) : [];
      const toReview = rows.filter((e) => e.status === "pending_review" && !e.deleted_at).length;
      setSummary(toReview + a.unreadable.length > 0 ? { read: a.read, toReview, unreadable: a.unreadable.length } : null);
    }, []),
  );

  if (!summary) return null;

  const parts = [
    summary.toReview > 0 ? `${summary.toReview} to review` : null,
    summary.unreadable > 0 ? `${summary.unreadable} couldn't be read` : null,
  ].filter(Boolean);

  return (
    <Card className="mx-4 mt-3">
      <View className="flex-row items-center gap-2 mb-1">
        <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.primary} />
        <Text className="text-base font-semibold text-foreground">
          {summary.read} bank message{summary.read === 1 ? "" : "s"} read
        </Text>
      </View>
      <Text className="text-xs text-muted-foreground leading-5 mb-3">{parts.join(" · ")}</Text>
      <Button title="Review" onPress={() => router.push("/expense/just-arrived")} />
      <Pressable
        onPress={() => {
          markArrivalSeen();
          setSummary(null);
        }}
        hitSlop={8}
        className="self-end mt-3"
        accessibilityRole="button"
      >
        <Text className="text-xs font-medium" style={{ color: theme.primary }}>Dismiss</Text>
      </Pressable>
    </Card>
  );
}
