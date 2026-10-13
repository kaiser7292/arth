import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";

import { Button, Card, Text } from "@/components/ui";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { isAiSetupPending, setAiSetupPending } from "@/services/ai-share";

/**
 * "AI Assisted Setup" on Home - shown from the moment a setup file is shared until the
 * assistant's reply is applied or the card is dismissed. Self-loading; hidden otherwise.
 */
export function AiSetupCard() {
  const router = useRouter();
  const theme = useTheme();
  const [pending, setPending] = useState(isAiSetupPending());

  useDataRefresh(useCallback(async () => setPending(isAiSetupPending()), []));

  if (!pending) return null;

  return (
    <Card className="mx-4 mt-3">
      <View className="flex-row items-center gap-2 mb-1">
        <Ionicons name="sparkles-outline" size={18} color={theme.primary} />
        <Text className="text-base font-semibold text-foreground">AI Assisted Setup</Text>
      </View>
      <Text className="text-xs text-muted-foreground leading-5 mb-3">
        {"Waiting for your assistant's reply. Tap copy on it there, then tap below to review what it suggests."}
      </Text>
      <Button title="Paste AI reply" onPress={() => router.push("/settings/ai-suggestions?paste=1")} />
      <View className="flex-row justify-between mt-3">
        <Pressable onPress={() => router.push("/settings/ai-assisted-setup")} hitSlop={8} accessibilityRole="button">
          <Text className="text-xs font-medium" style={{ color: theme.primary }}>Share again</Text>
        </Pressable>
        <Pressable onPress={() => setAiSetupPending(false)} hitSlop={8} accessibilityRole="button">
          <Text className="text-xs font-medium" style={{ color: theme.primary }}>Dismiss</Text>
        </Pressable>
      </View>
    </Card>
  );
}
