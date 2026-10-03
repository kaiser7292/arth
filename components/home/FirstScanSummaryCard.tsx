import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { FirstScanSummaryView } from "@/components/onboarding/FirstScanSummaryView";
import { Button, Card, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import {
  buildFirstScanSummary,
  clearPendingFirstScanSummary,
  getPendingFirstScanSince,
  type FirstScanSummary,
} from "@/services/first-scan";
import { logger } from "@/utils/logger";

/**
 * "Here's your money" on Home, once — for a first scan that was still running when onboarding
 * moved on. Self-loading; hidden otherwise.
 */
export function FirstScanSummaryCard() {
  const router = useRouter();
  const [summary, setSummary] = useState<FirstScanSummary | null>(null);

  useDataRefresh(
    useCallback(async () => {
      const since = getPendingFirstScanSince();
      if (!since) {
        setSummary(null);
        return;
      }
      try {
        setSummary(await buildFirstScanSummary(DEFAULT_USER_ID, since));
      } catch (e) {
        logger.warn("First-scan summary failed (non-fatal):", e);
        setSummary(null);
      }
    }, []),
  );

  if (!summary) return null;

  return (
    <Card className="mx-4 mt-3">
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        Your first scan is done
      </Text>
      <Text className="text-base font-semibold text-foreground mb-3">Here’s your money since {summary.since}</Text>
      <FirstScanSummaryView summary={summary} />
      <View className="flex-row gap-3 mt-3">
        <View className="flex-1">
          <Button title="Dismiss" variant="outline" onPress={clearPendingFirstScanSummary} />
        </View>
        {summary.toReview > 0 && (
          <View className="flex-1">
            <Button
              title="Review now"
              onPress={() => {
                clearPendingFirstScanSummary();
                router.push("/expense/catch-up");
              }}
            />
          </View>
        )}
      </View>
    </Card>
  );
}
