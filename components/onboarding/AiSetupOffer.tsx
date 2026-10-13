import { useCallback, useState } from "react";
import { View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";

import { Button, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import { buildSetupOptions, createAiFile, setAiSetupPending, shareAiFile } from "@/services/ai-share";

/**
 * "AI Assisted Setup" during onboarding. One button: it builds the setup file (accounts,
 * every transaction found so far, bank messages Arth couldn't read) and opens the share sheet.
 * Optional and never blocking - the reply is picked up later from the card on Home.
 */
export function AiSetupOffer() {
  const theme = useTheme();
  const [state, setState] = useState<"idle" | "working" | "shared" | "failed">("idle");

  const share = useCallback(async () => {
    setState("working");
    try {
      const options = await buildSetupOptions(DEFAULT_USER_ID);
      const { file } = await createAiFile(DEFAULT_USER_ID, options);
      await shareAiFile(file, options);
      setAiSetupPending(true);
      setState("shared");
    } catch {
      setState("failed");
    }
  }, []);

  return (
    <View className="mt-4 p-4 rounded-xl border bg-card" style={{ borderColor: theme.primary }}>
      <View className="flex-row items-center gap-2 mb-1">
        <Ionicons name="sparkles-outline" size={18} color={theme.primary} />
        <Text className="text-base font-semibold text-foreground">AI Assisted Setup</Text>
      </View>
      <Text className="text-xs text-muted-foreground leading-5">
        Your AI assistant (Claude, ChatGPT, Gemini) suggests categories for your merchants, budgets, how to read the
        bank messages Arth could not, and your income and goals. It asks you a few questions first. You approve
        everything.
      </Text>
      <Text className="text-xs text-muted-foreground leading-5 mt-2">
        Shares your accounts, the transactions found so far and unread bank messages with the assistant you pick.
        Never your password vault or login credentials.
      </Text>
      {state === "shared" ? (
        <Text className="text-xs leading-5 mt-3" style={{ color: theme.success }}>
          Shared. Send it in your assistant, then carry on here. A card on Home will be waiting for its reply.
        </Text>
      ) : (
        <Button
          title="Share with AI"
          onPress={share}
          loading={state === "working"}
          variant="outline"
          className="mt-3"
        />
      )}
      {state === "failed" && (
        <Text className="text-xs mt-2" style={{ color: theme.warning }}>
          {"Couldn't prepare the file. You can do this later from Insights."}
        </Text>
      )}
    </View>
  );
}
