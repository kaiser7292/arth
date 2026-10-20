import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import { buildSetupOptions, createAiFile, setAiSetupPending, shareAiFile } from "@/services/ai-share";

/**
 * Onboarding, AI route: share the setup file with an assistant, then paste its reply back. The
 * reply is checked, reviewed and applied on the AI suggestions screen, which carries on to the
 * steps the reply left out and then Protect (services/onboarding-flow.ts). "Finish later" moves on;
 * a Home card waits for the reply.
 */
export default function OnboardingAiSetup() {
  const router = useRouter();
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

  const Step = ({ n, title, body, done, children }: { n: number; title: string; body: string; done?: boolean; children?: React.ReactNode }) => (
    <Card className="mb-3">
      <View className="flex-row items-start">
        <View
          className="w-7 h-7 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: done ? theme.success : theme.alpha("primary", 0.12) }}
        >
          {done ? (
            <Ionicons name="checkmark" size={16} color={theme.background} />
          ) : (
            <Text className="text-sm font-bold" style={{ color: theme.primary }}>{n}</Text>
          )}
        </View>
        <View className="flex-1">
          <Text className="text-base font-semibold text-foreground">{title}</Text>
          <Text className="text-sm text-muted-foreground mt-1 leading-5">{body}</Text>
          {children}
        </View>
      </View>
    </Card>
  );

  return (
    <ScreenContainer safe padTop>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }}>
        <Text className="text-2xl font-bold text-foreground mb-2">Set up with your AI assistant</Text>
        <Text className="text-sm text-muted-foreground mb-6 leading-5">
          It suggests categories for your merchants, budgets, how to read messages Arth couldn't, and your income and goals.
          Nothing changes until you approve it.
        </Text>

        <Step
          n={1}
          done={state === "shared"}
          title="Share the file"
          body="Pick Claude, ChatGPT or Gemini and send it. It has your accounts, the transactions found and unread transaction messages, never your password vault or logins."
        >
          {state !== "shared" && (
            <Button title="Share with AI" onPress={share} loading={state === "working"} className="mt-3" />
          )}
          {state === "failed" && (
            <Text className="text-xs mt-2" style={{ color: theme.warning }}>
              {"Couldn't prepare the file. Try again, or set up by hand."}
            </Text>
          )}
        </Step>

        <Step
          n={2}
          title="Copy its reply"
          body="When the assistant has answered, tap copy on its reply (the whole reply, including the grey code block)."
        />

        <Step n={3} title="Paste it here" body="Arth shows what you pasted, checks it, and lets you approve each change.">
          <Button
            title="Paste AI reply"
            variant={state === "shared" ? "primary" : "outline"}
            onPress={() => router.push({ pathname: "/settings/ai-suggestions", params: { paste: "1", onboarding: "1" } })}
            className="mt-3"
          />
        </Step>
      </ScrollView>
      <View className="px-6 pb-6 pt-2">
        <Button title="Finish later" variant="ghost" onPress={() => router.push("/(onboarding)/protect")} />
        <Text className="text-xs text-muted-foreground text-center mt-1">A card on Home will wait for the reply.</Text>
      </View>
    </ScreenContainer>
  );
}
