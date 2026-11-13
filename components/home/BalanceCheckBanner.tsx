import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { dismissBalanceNudge, getBalanceNudge } from "@/services/balance-update";

/**
 * Home: no money has moved for 3 days or more, so ask whether the balances and card dues are still
 * right. Opens Update balances; the cross hides it until money moves and goes quiet again.
 * Switched on or off in Customise Arth ("balance_check").
 */
export function BalanceCheckBanner() {
  const router = useRouter();
  const theme = useTheme();
  const [quietDays, setQuietDays] = useState<number | null>(null);

  useDataRefresh(
    useCallback(async () => {
      try {
        setQuietDays((await getBalanceNudge(DEFAULT_USER_ID))?.quietDays ?? null);
      } catch {
        setQuietDays(null);
      }
    }, []),
  );

  if (quietDays == null) return null;

  return (
    <Pressable
      onPress={() => router.push("/settings/update-balances")}
      accessibilityRole="button"
      accessibilityLabel="Check and update your balances"
    >
      <Card className="mx-4 mt-3">
        <View className="flex-row items-start">
          <View className="w-9 h-9 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.12) }}>
            <Ionicons name="scale-outline" size={18} color={theme.primary} />
          </View>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-foreground">Are your balances up to date?</Text>
            <Text className="text-xs text-muted-foreground mt-0.5 leading-4">
              No money has moved in {quietDays} days. If something was missed, check your accounts and cards and update them in a few seconds.
            </Text>
            <Text className="text-xs font-semibold mt-2" style={{ color: theme.primary }}>
              Check and update
            </Text>
          </View>
          <Pressable
            onPress={async () => {
              setQuietDays(null);
              await dismissBalanceNudge(DEFAULT_USER_ID).catch(() => {});
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="ml-2"
          >
            <Ionicons name="close" size={18} color={theme.mutedForeground} />
          </Pressable>
        </View>
      </Card>
    </Pressable>
  );
}
