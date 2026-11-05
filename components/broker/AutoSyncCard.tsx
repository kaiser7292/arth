import { useState } from "react";
import { Switch, View } from "react-native";

import { Card, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { isAutoSyncOn, setAutoSyncOn } from "@/services/broker-history/auto-sync";
import type { ApiBroker } from "@/services/broker-history/types";

const NOTE: Record<ApiBroker, string> = {
  kite: "Once a day after 5 pm on weekdays, on days you've logged in to Zerodha. Your phone picks the exact moment, so it can run later.",
  angel: "Once a day after 5 pm on weekdays. Your phone picks the exact moment, so it can run later.",
  zebpay: "Once a day after 5 pm, every day. Your phone picks the exact moment, so it can run later. Tap Sync for the latest.",
};

/** This broker's own automatic sync. Switching it off leaves the other brokers alone. */
export function AutoSyncCard({ broker }: { broker: ApiBroker }) {
  const theme = useTheme();
  const { colors } = useColorScheme();
  const [on, setOn] = useState(() => isAutoSyncOn(broker));
  return (
    <Card className="mx-4 mb-3">
      <View className="flex-row items-center">
        <View className="flex-1 mr-3">
          <Text className="text-sm font-semibold text-foreground">Sync automatically</Text>
          <Text className="text-xs text-muted-foreground mt-0.5">{NOTE[broker]}</Text>
        </View>
        <Switch
          value={on}
          onValueChange={(v) => {
            setOn(v);
            setAutoSyncOn(broker, v);
          }}
          trackColor={{ false: colors.border, true: theme.primary }}
          thumbColor="#ffffff"
          accessibilityLabel="Sync automatically"
        />
      </View>
    </Card>
  );
}
