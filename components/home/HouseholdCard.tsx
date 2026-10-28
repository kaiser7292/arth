import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
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
 * Home → People & Money: the household, in the same shape as the Hisaab card. Spent together this
 * month and who owes whom; opens Together. Self-loading; hidden outside a household, and from
 * Settings → Home Cards ("household").
 */
export function HouseholdCard() {
  const router = useRouter();
  const theme = useTheme();
  const { colors } = useColorScheme();
  const [s, setS] = useState<Statement | null>(null);

  useDataRefresh(
    useCallback(async () => {
      if (!getFlag("household")) return;
      setS(await getStatement(thisMonth()).catch(() => null));
    }, []),
  );

  if (!s) return null;
  const owedToMe = s.balances.filter((b) => b.amount > 0.5).reduce((sum, b) => sum + b.amount, 0);
  const iOwe = s.balances.filter((b) => b.amount < -0.5).reduce((sum, b) => sum - b.amount, 0);

  return (
    <Pressable onPress={() => router.push("/together")} accessibilityLabel={`Open Together, ${s.household.name}`} accessibilityRole="button">
      <Card className="mx-4 mt-2">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center flex-1">
            <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.08) }}>
              <Ionicons name="home-outline" size={20} color={colors.blue} />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-semibold text-foreground">{s.household.name} - Together</Text>
              {s.together > 0 || owedToMe > 0 || iOwe > 0 ? (
                <View className="flex-row items-center flex-wrap mt-0.5">
                  <Text className="text-xs text-muted-foreground mr-3">{formatAmount(s.together)} together this month</Text>
                  {owedToMe > 0 && <Text className="text-xs text-success mr-3">+{formatAmount(owedToMe)} owed</Text>}
                  {iOwe > 0 && <Text className="text-xs text-danger">{formatAmount(iOwe)} you owe</Text>}
                </View>
              ) : (
                <Text className="text-xs text-muted-foreground">Shared spending, who owes whom, budget and goals</Text>
              )}
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </View>
      </Card>
    </Pressable>
  );
}
