import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Platform, Pressable, View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";

import { Button, Card, Text } from "@/components/ui";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getLastArrival, markArrivalSeen } from "@/services/message-inbox";

/** A batch older than this no longer counts as "just in". */
const FRESH_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * iPhone: bank messages the Shortcut handed over that couldn't be read. Those that could are in Catch
 * Up; these appear nowhere else, and are what a new template gets made from. Opens "Just arrived".
 * Self-loading; hidden on Android, once opened or dismissed, and when nothing's left.
 */
export function BankMessagesCard() {
  const router = useRouter();
  const theme = useTheme();
  const [unreadable, setUnreadable] = useState(0);

  useDataRefresh(
    useCallback(async () => {
      if (Platform.OS !== "ios") return;
      const a = getLastArrival();
      if (!a || a.seen || Date.now() - a.at > FRESH_MS) {
        setUnreadable(0);
        return;
      }
      setUnreadable(a.unreadable.length);
    }, []),
  );

  if (unreadable === 0) return null;

  return (
    <Card className="mx-4 mt-3">
      <View className="flex-row items-center gap-2 mb-1">
        <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.primary} />
        <Text className="text-base font-semibold text-foreground">
          {unreadable} bank message{unreadable === 1 ? "" : "s"} couldn't be read
        </Text>
      </View>
      <Text className="text-xs text-muted-foreground leading-5 mb-3">See {unreadable === 1 ? "it" : "them"}, and teach Arth the format.</Text>
      <Button title="See messages" onPress={() => router.push("/expense/just-arrived")} />
      <Pressable
        onPress={() => {
          markArrivalSeen();
          setUnreadable(0);
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
