import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { Button, Card, Text, useToast } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { recheckSelfTransfers } from "@/services/money-events";
import { addSelfName, dismissSelfNameSuggestion, getSelfNameSuggestion } from "@/services/self-names";
import { logger } from "@/utils/logger";

/**
 * One-time Home prompt: "Is SOURAV BAID you?" — the name Arth keeps seeing on transfers in the
 * user's bank SMS. Yes saves it (and re-checks the review queue for transfers between their
 * own accounts); No never asks about that name again. Self-loading; hidden when there's no
 * suggestion, so it can't affect Home's own load.
 */
export function SelfNamePromptCard() {
  const theme = useTheme();
  const showToast = useToast();
  const [suggestion, setSuggestion] = useState<{ name: string; count: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useDataRefresh(
    useCallback(async () => {
      try {
        setSuggestion(await getSelfNameSuggestion(DEFAULT_USER_ID));
      } catch (e) {
        logger.warn("Self-name suggestion failed (non-fatal):", e);
        setSuggestion(null);
      }
    }, []),
  );

  if (!suggestion) return null;

  const accept = async () => {
    setBusy(true);
    try {
      addSelfName(suggestion.name);
      const n = await recheckSelfTransfers(DEFAULT_USER_ID);
      showToast(n > 0 ? `Saved. ${n} transfer${n !== 1 ? "s" : ""} between your accounts spotted.` : "Saved");
    } catch (e) {
      logger.warn("Saving self name failed:", e);
    } finally {
      setBusy(false);
      setSuggestion(null);
    }
  };

  return (
    <Card className="mx-4 mt-3">
      <View className="flex-row items-start">
        <Ionicons name="person-circle-outline" size={22} color={theme.primary} />
        <View className="flex-1 ml-2.5">
          <Text className="text-sm font-semibold text-foreground">Is {suggestion.name} you?</Text>
          <Text className="text-xs text-muted-foreground mt-1">
            This name appears in {suggestion.count} of your bank messages on transfers. If it’s you, money sent to or
            from it counts as moving between your own accounts, not spending or income.
          </Text>
        </View>
      </View>
      <View className="flex-row gap-3 mt-3">
        <View className="flex-1">
          <Button
            title="No"
            variant="outline"
            onPress={() => {
              dismissSelfNameSuggestion(suggestion.name);
              setSuggestion(null);
            }}
          />
        </View>
        <View className="flex-1">
          <Button title="Yes, that's me" onPress={() => void accept()} loading={busy} />
        </View>
      </View>
    </Card>
  );
}
