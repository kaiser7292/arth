import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { Href } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { Card, StatusPill, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import type { CheckInCounts } from "@/services/check-ins";
import { getCheckInCounts } from "@/services/check-ins";

const ROWS: {
  key: keyof CheckInCounts;
  href: Href;
  icon: keyof typeof Ionicons.glyphMap;
  label: (n: number) => string;
}[] = [
  { key: "monthEnd", href: "/check-in/month-end", icon: "calendar-outline", label: (n) => `Month-end check · ${n} account${n !== 1 ? "s" : ""}` },
  { key: "settleUp", href: "/check-in/settle-up", icon: "people-outline", label: (n) => `${n} ${n !== 1 ? "people owe" : "person owes"} you` },
  { key: "subscriptions", href: "/check-in/subscriptions", icon: "repeat-outline", label: (n) => `${n} subscription${n !== 1 ? "s" : ""} to review` },
  { key: "ruleSuggestions", href: "/check-in/rules", icon: "flash-outline", label: (n) => `${n} rule suggestion${n !== 1 ? "s" : ""}` },
];

/**
 * Home entry to the check-in decks. Loads its own counts (in its own try/catch via
 * getCheckInCounts) so it can never take Home's main load down with it. Hidden when there's
 * nothing to check.
 */
export function CheckInsCard() {
  const router = useRouter();
  const theme = useTheme();
  const [counts, setCounts] = useState<CheckInCounts | null>(null);

  useDataRefresh(
    useCallback(async () => {
      setCounts(await getCheckInCounts(DEFAULT_USER_ID));
    }, []),
  );

  if (!counts) return null;
  const rows = ROWS.filter((r) => counts[r.key] > 0);
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + counts[r.key], 0);

  return (
    <Card className="mx-4 mt-3">
      <View className="flex-row items-center justify-between mb-1">
        <View className="flex-row items-center">
          <View
            className="w-9 h-9 rounded-full items-center justify-center mr-3"
            style={{ backgroundColor: theme.alpha("primary", 0.1) }}
          >
            <Ionicons name="albums-outline" size={18} color={theme.primary} />
          </View>
          <View>
            <Text className="text-sm font-semibold text-foreground">Check-ins</Text>
            <Text className="text-xs text-muted-foreground">Quick swipes to keep things tidy</Text>
          </View>
        </View>
        <StatusPill label={`${total}`} color={theme.primary} />
      </View>
      {rows.map((r) => (
        <Pressable
          key={r.key}
          onPress={() => router.push(r.href)}
          className="flex-row items-center ml-12 py-2"
          accessibilityRole="button"
        >
          <Ionicons name={r.icon} size={14} color={theme.primary} style={{ marginRight: 8 }} />
          <Text className="text-sm text-foreground flex-1">{r.label(counts[r.key])}</Text>
          <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
        </Pressable>
      ))}
    </Card>
  );
}
