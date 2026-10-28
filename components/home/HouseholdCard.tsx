import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, Text } from "@/components/ui";
import { Avatar } from "@/components/household/HouseholdBits";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getFlag } from "@/services/feature-flags";
import { formatAmount } from "@/utils/format";
import { getStatement, type Statement } from "@/services/household/statement";

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * Home: the household at a glance (Together rework). Spent together this month with each person's
 * part, who owes whom, and the latest shared spends. Opens Together. Self-loading; hidden outside
 * a household.
 */
export function HouseholdCard() {
  const router = useRouter();
  const theme = useTheme();
  const [s, setS] = useState<Statement | null>(null);

  useDataRefresh(
    useCallback(async () => {
      if (!getFlag("household")) return;
      setS(await getStatement(thisMonth()).catch(() => null));
    }, []),
  );

  if (!s) return null;
  const h = s.household;
  const owing = s.balances.find((b) => Math.abs(b.amount) > 0.5);
  const latest = s.rows.filter((r) => r.relation.kind !== "settle").slice(0, 2);
  const monthName = new Date().toLocaleDateString("en-IN", { month: "long" });

  return (
    <Pressable onPress={() => router.push("/together")} accessibilityRole="button" accessibilityLabel={`${h.name}, ${monthName}`}>
      <Card className="mx-4 mt-3">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <Ionicons name="home-outline" size={16} color={theme.primary} />
            <Text className="text-sm font-semibold text-foreground ml-1.5">
              {h.name} · {monthName}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
        </View>
        <Text className="text-xl font-bold text-foreground mt-1">
          {formatAmount(s.together)} <Text className="text-xs text-muted-foreground">together</Text>
        </Text>
        {s.together > 0 && (
          <View className="flex-row h-1.5 rounded-full overflow-hidden mt-2" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
            {s.byMember.map((b) => (
              <View key={b.member.id} style={{ flex: b.paid, backgroundColor: b.member.colour ?? theme.primary }} />
            ))}
          </View>
        )}
        <Text className="text-xs text-muted-foreground mt-1.5">
          {s.byMember
            .map((b) => `${b.member.id === h.my_member_id ? "You" : b.member.name} ${formatAmount(b.paid)}`)
            .join(" · ")}
        </Text>

        {owing && (
          <View className="flex-row items-center justify-between mt-3 pt-3 border-t border-border">
            <Text className="text-sm text-foreground flex-1 mr-2">
              {owing.amount < 0 ? `You owe ${owing.name} ${formatAmount(-owing.amount)}` : `${owing.name} owes you ${formatAmount(owing.amount)}`}
            </Text>
            <Pressable
              onPress={() => router.push({ pathname: "/together/settle", params: { memberId: owing.memberId } })}
              className="px-3 py-1 rounded-full"
              style={{ backgroundColor: theme.alpha("primary", 0.12) }}
              accessibilityRole="button"
              hitSlop={6}
            >
              <Text className="text-xs font-semibold" style={{ color: theme.primary }}>Settle up</Text>
            </Pressable>
          </View>
        )}

        {latest.length > 0 && (
          <View className="mt-3">
            {latest.map((r) => (
              <View key={r.id} className="flex-row items-center py-1.5">
                <Avatar member={r.member} size={22} />
                <Text className="text-sm text-foreground flex-1 ml-2" numberOfLines={1}>
                  {r.merchant || r.category || "Shared"}
                </Text>
                <Text className="text-sm text-muted-foreground">{formatAmount(r.paid)}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>
    </Pressable>
  );
}
