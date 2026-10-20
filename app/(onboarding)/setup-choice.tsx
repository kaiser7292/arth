import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import { getDatabase } from "@/database";

type Route = "ai" | "manual";

/**
 * Onboarding: how to set Arth up. AI assisted (the user's assistant suggests categories, budgets,
 * merchants and goals from the transactions found) or by hand (categories, income, budgets).
 * Only the chosen route's steps follow. See services/onboarding-flow.ts.
 */
export default function SetupChoice() {
  const router = useRouter();
  const theme = useTheme();
  const [found, setFound] = useState<{ tx: number; accounts: number } | null>(null);
  const [route, setRoute] = useState<Route>("ai");

  useEffect(() => {
    const db = getDatabase();
    Promise.all([
      db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM expenses WHERE user_id = ? AND deleted_at IS NULL;`, DEFAULT_USER_ID),
      db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM financial_accounts WHERE user_id = ? AND is_active = 1 AND closed_at IS NULL;`,
        DEFAULT_USER_ID,
      ),
    ])
      .then(([t, a]) => {
        const tx = t?.n ?? 0;
        setFound({ tx, accounts: a?.n ?? 0 });
        // With nothing read from messages the AI has little to work from: suggest doing it by hand.
        if (tx < 20) setRoute("manual");
      })
      .catch(() => setFound({ tx: 0, accounts: 0 }));
  }, []);

  const go = () => {
    if (route === "ai") router.push("/(onboarding)/ai-setup");
    else router.push("/(onboarding)/categories");
  };

  const Option = ({
    value,
    title,
    body,
    steps,
    recommended,
  }: {
    value: Route;
    title: string;
    body: string;
    steps: string[];
    recommended?: boolean;
  }) => {
    const on = route === value;
    return (
      <Pressable
        onPress={() => setRoute(value)}
        className="rounded-2xl p-4 mb-3"
        style={{ borderWidth: 1.5, borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.alpha("primary", 0.06) : undefined }}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
      >
        <View className="flex-row items-center">
          <Text className="text-base font-bold text-foreground flex-1">
            {title}
          </Text>
          {recommended && (
            <View className="rounded-full px-2.5 py-0.5 mr-2" style={{ backgroundColor: theme.primary }}>
              <Text className="text-label font-bold" style={{ color: theme.background }}>Recommended</Text>
            </View>
          )}
          <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? theme.primary : theme.mutedForeground} />
        </View>
        <Text className="text-sm text-muted-foreground mt-1.5 leading-5">{body}</Text>
        <View className="flex-row flex-wrap mt-3" style={{ gap: 6 }}>
          {steps.map((s) => (
            <View key={s} className="rounded-md px-2 py-1" style={{ backgroundColor: theme.alpha("foreground", 0.06) }}>
              <Text className="text-xs text-muted-foreground">{s}</Text>
            </View>
          ))}
        </View>
      </Pressable>
    );
  };

  const recommendAi = (found?.tx ?? 0) >= 20;
  return (
    <ScreenContainer safe padTop>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }}>
        <Text className="text-2xl font-bold text-foreground mb-2">How would you like to set up Arth?</Text>
        <Text className="text-sm text-muted-foreground mb-6 leading-5">
          {found && found.tx > 0
            ? `Arth found ${found.tx.toLocaleString("en-IN")} transactions and ${found.accounts} account${found.accounts === 1 ? "" : "s"}. `
            : ""}
          Either way, you approve everything.
        </Text>
        <Option
          value="ai"
          title="AI assisted"
          recommended={recommendAi}
          body="Your AI assistant (Claude, ChatGPT, Gemini) sets up categories, budgets, merchants and goals from your transactions. About 5 minutes."
          steps={["Share a file", "Paste the reply", "Review"]}
        />
        <Option
          value="manual"
          title="I'll set it up myself"
          recommended={!recommendAi}
          body="Pick your categories, add your income and set budgets yourself."
          steps={["Categories", "Income", "Budgets"]}
        />
        <Text className="text-xs text-muted-foreground text-center mt-2">You can use AI Assisted Setup any time later from Settings.</Text>
      </ScrollView>
      <View className="px-6 pb-6 pt-2">
        <Button title={route === "ai" ? "Continue with AI" : "Continue"} onPress={go} />
      </View>
    </ScreenContainer>
  );
}
