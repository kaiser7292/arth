import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import {
  SYNC_BROKER_NAMES,
  SYNC_BROKER_ROUTES,
  getConnectedBrokers,
  syncAllBrokers,
  syncBroker,
  type BrokerSyncResult,
  type SyncBroker,
} from "@/services/broker-sync";
import { isKiteTokenExpired } from "@/services/kite-connect";
import { formatAmount } from "@/utils/expense-validation";

/** One Sync for every connected broker, saving today's snapshot. Hidden with no broker connected. */
export function BrokerSyncCard() {
  const router = useRouter();
  const theme = useTheme();
  const [brokers, setBrokers] = useState<SyncBroker[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [results, setResults] = useState<BrokerSyncResult[] | null>(null);
  const resultsRef = useRef(results);
  resultsRef.current = results;

  useFocusEffect(
    useCallback(() => {
      getConnectedBrokers().then(setBrokers).catch(() => setBrokers([]));
      // Back from logging in to Zerodha: carry on where the sync stopped.
      const waiting = resultsRef.current?.some((r) => r.broker === "kite" && r.status === "needs_login");
      if (waiting && !isKiteTokenExpired()) {
        syncBroker("kite")
          .then((done) => setResults((prev) => prev?.map((r) => (r.broker === "kite" ? done : r)) ?? [done]))
          .catch(() => {});
      }
    }, []),
  );

  if (brokers.length === 0) return null;

  const run = async () => {
    setSyncing(true);
    try {
      setResults(await syncAllBrokers());
    } finally {
      setSyncing(false);
    }
  };

  const fix = (r: BrokerSyncResult) => {
    const route = SYNC_BROKER_ROUTES[r.broker];
    router.push((r.status === "needs_login" ? `${route}?loginForSync=1` : route) as Href);
  };

  return (
    <Card className="mx-4 mt-4">
      <Button
        title={syncing ? "Syncing..." : "Sync today's investments"}
        onPress={run}
        loading={syncing}
        disabled={syncing}
      />
      <Text className="text-xs text-muted-foreground mt-2 text-center">
        {brokers.map((b) => SYNC_BROKER_NAMES[b]).join(", ")}, and saves today's snapshot
      </Text>
      {results?.map((r) => (
        <View key={r.broker} className="flex-row items-center mt-3 pt-3 border-t border-border">
          <Ionicons
            name={r.status === "saved" ? "checkmark-circle" : r.status === "failed" ? "alert-circle" : "information-circle"}
            size={18}
            color={r.status === "saved" ? theme.success : r.status === "failed" ? theme.danger : theme.warning}
          />
          <View className="flex-1 ml-2">
            <Text className="text-sm font-medium text-foreground">{SYNC_BROKER_NAMES[r.broker]}</Text>
            <Text className="text-xs text-muted-foreground mt-0.5">
              {r.status === "saved"
                ? `Portfolio ${formatAmount(r.portfolio)} · funds ${formatAmount(r.fund)}`
                : r.status === "needs_login"
                  ? "Its login ends every day, so this one needs you"
                  : r.status === "needs_account"
                    ? "Link it to an account to save its snapshot"
                    : r.message}
            </Text>
          </View>
          {r.status === "needs_login" || r.status === "needs_account" ? (
            <Pressable onPress={() => fix(r)} hitSlop={8} accessibilityRole="button">
              <Text className="text-xs font-semibold" style={{ color: theme.primary }}>
                {r.status === "needs_login" ? "Log in" : "Link"}
              </Text>
            </Pressable>
          ) : syncing ? (
            <ActivityIndicator size="small" />
          ) : null}
        </View>
      ))}
    </Card>
  );
}
