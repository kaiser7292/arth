import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";

import { Button, Card, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { buildSetupOptions, createAiFile, isAiSetupPending, setAiSetupPending, shareAiFile } from "@/services/ai-share";

/**
 * "Finish setup with AI" on Home - shown from the moment the setup file is shared until the
 * assistant's reply is applied or the card is dismissed. Self-loading; hidden otherwise.
 */
export function AiSetupCard() {
  const router = useRouter();
  const theme = useTheme();
  const [pending, setPending] = useState(isAiSetupPending());
  const [sharing, setSharing] = useState(false);

  useDataRefresh(useCallback(async () => setPending(isAiSetupPending()), []));

  const shareAgain = useCallback(async () => {
    setSharing(true);
    try {
      const options = await buildSetupOptions(DEFAULT_USER_ID);
      const { file } = await createAiFile(DEFAULT_USER_ID, options);
      await shareAiFile(file, options);
    } catch {
      // The card stays; the user can try again.
    }
    setSharing(false);
  }, []);

  if (!pending) return null;

  return (
    <Card className="mx-4 mt-3">
      <View className="flex-row items-center gap-2 mb-1">
        <Ionicons name="sparkles-outline" size={18} color={theme.primary} />
        <Text className="text-base font-semibold text-foreground">Finish setup with AI</Text>
      </View>
      <Text className="text-xs text-muted-foreground leading-5 mb-3">
        In your assistant, tap copy on its reply. Then tap below to review what it suggests.
      </Text>
      <Button title="Paste AI reply" onPress={() => router.push("/insights/ai-suggestions?paste=1")} />
      <View className="flex-row justify-between mt-3">
        <Pressable onPress={shareAgain} disabled={sharing} hitSlop={8} accessibilityRole="button">
          <Text className="text-xs font-medium" style={{ color: theme.primary }}>
            {sharing ? "Preparing..." : "Share again"}
          </Text>
        </Pressable>
        <Pressable onPress={() => setAiSetupPending(false)} hitSlop={8} accessibilityRole="button">
          <Text className="text-xs font-medium" style={{ color: theme.primary }}>Dismiss</Text>
        </Pressable>
      </View>
    </Card>
  );
}
