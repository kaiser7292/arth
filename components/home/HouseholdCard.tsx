import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, Text } from "@/components/ui";
import { Avatar, ago } from "@/components/household/HouseholdBits";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getFlag } from "@/services/feature-flags";
import { settingsStorage } from "@/services/storage";
import { getActiveHousehold, getEvents, getMembers } from "@/services/household/store";
import type { HouseholdMember } from "@/services/household/types";

const SEEN_KEY = "household_card_seen_at";
const FRESH_MS = 3 * 24 * 60 * 60 * 1000;

interface Summary {
  name: string;
  members: HouseholdMember[];
  line: string;
  at: string;
}

/**
 * Home: "Home · Aastha shared 4 updates · 2 h ago". Shows when someone else in the household did
 * something in the last 3 days that this phone hasn't been shown yet; opens Settings → Household.
 * Self-loading; hidden outside a household.
 */
export function HouseholdCard() {
  const router = useRouter();
  const theme = useTheme();
  const [s, setS] = useState<Summary | null>(null);

  useDataRefresh(
    useCallback(async () => {
      if (!getFlag("household")) return;
      const h = await getActiveHousehold().catch(() => null);
      if (!h) {
        setS(null);
        return;
      }
      const [members, events] = await Promise.all([getMembers(h.id), getEvents(h.id, 20)]);
      const seen = settingsStorage.getString(SEEN_KEY) ?? "";
      const fresh = events.filter(
        (e) => e.member_id !== h.my_member_id && e.at > seen && Date.now() - new Date(`${e.at.replace(" ", "T")}Z`).getTime() < FRESH_MS,
      );
      if (fresh.length === 0) {
        setS(null);
        return;
      }
      const latest = fresh[0];
      const who = members.find((m) => m.id === latest.member_id)?.name ?? "Someone";
      const shared = fresh.filter((e) => e.type === "shared" && e.member_id === latest.member_id).length;
      const line =
        latest.type === "joined"
          ? `${who} joined`
          : latest.type === "left"
            ? `${who} left`
            : `${who} shared ${shared > 1 ? `${shared} updates` : "an update"}`;
      setS({ name: h.name, members, line, at: latest.at });
    }, []),
  );

  if (!s) return null;

  return (
    <Pressable
      onPress={() => {
        settingsStorage.set(SEEN_KEY, s.at);
        setS(null);
        router.push("/settings/household");
      }}
      accessibilityRole="button"
      accessibilityLabel={`${s.name}: ${s.line}`}
    >
      <Card className="mx-4 mt-3">
        <View className="flex-row items-center">
          <View className="flex-row mr-3">
            {s.members.slice(0, 3).map((m, i) => (
              <View key={m.id} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                <Avatar member={m} size={28} />
              </View>
            ))}
          </View>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-foreground">{s.name}</Text>
            <Text className="text-xs text-muted-foreground mt-0.5">
              {s.line} · {ago(s.at)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
        </View>
      </Card>
    </Pressable>
  );
}
