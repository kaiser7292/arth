import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import type { Href } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { Card, SectionTitle, StatusPill, Text } from "@/components/ui";
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
  { key: "bills", href: "/check-in/bills", icon: "calendar-number-outline", label: (n) => `${n} possible bill${n !== 1 ? "s" : ""} to confirm` },
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
      <SectionTitle
        icon="albums-outline"
        title="Check-ins"
        hint="Quick swipes to keep things tidy"
        active
        right={<StatusPill label={`${total}`} color={theme.primary} />}
      />
      <View className="mt-1.5">
        {rows.map((r, i) => (
          <Pressable
            key={r.key}
            onPress={() => router.push(r.href)}
            className={`flex-row items-center ${i > 0 ? "border-t border-border" : ""}`}
            style={{ minHeight: 48, paddingLeft: 42, gap: 8 }}
            accessibilityRole="button"
          >
            <Ionicons name={r.icon} size={15} color={theme.primary} />
            <Text className="text-body text-foreground flex-1">{r.label(counts[r.key])}</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
          </Pressable>
        ))}
      </View>
    </Card>
  );
}
