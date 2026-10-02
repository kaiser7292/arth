import { View, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button, ScreenContainer, Text } from "@/components/ui";

import { setOnboardingCompletedVersion } from "@/services/settings";
import { getCurrentAppVersion } from "@/services/onboarding";
import { useTheme } from "@/hooks/use-theme";

/** Where things live, so a new user isn't dropped into a busy app cold. */
const TOUR: Array<{ icon: keyof typeof Ionicons.glyphMap; title: string; body: string }> = [
  { icon: "home-outline", title: "Arth", body: "Your month at a glance. The Queue tab holds transactions waiting for your approval." },
  { icon: "receipt-outline", title: "Transactions", body: "Everything you've spent and received. Tap + to add cash spends." },
  { icon: "wallet-outline", title: "Budget", body: "How each category is doing this month." },
  { icon: "trophy-outline", title: "Goals", body: "Your yearly plan, milestones, loans and net worth." },
  { icon: "settings-outline", title: "Settings", body: "Accounts, categories, merchant rules, backups and the Help Center." },
];

export default function OnboardingDone() {
  const router = useRouter();
  const theme = useTheme();

  const finish = (andAddExpense: boolean) => {
    setOnboardingCompletedVersion(getCurrentAppVersion());
    router.replace("/(tabs)");
    // Defer the push slightly so the tabs layout mounts first.
    if (andAddExpense) setTimeout(() => router.push("/expense/add"), 50);
  };

  return (
    <ScreenContainer safe padTop>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <View
          className="w-16 h-16 rounded-full items-center justify-center mb-5"
          style={{ backgroundColor: theme.primary + "1F" }}
        >
          <Ionicons name="checkmark" size={32} color={theme.primary} />
        </View>
        <Text className="text-2xl font-bold text-foreground mb-2">You're set</Text>
        <Text className="text-sm text-muted-foreground leading-5 mb-6">
          When a bank SMS comes in or you add a transaction, it shows up for you to review. Here's where everything lives:
        </Text>
        {TOUR.map((t) => (
          <View key={t.title} className="flex-row items-start mb-4">
            <Ionicons name={t.icon} size={18} color={theme.primary} style={{ marginTop: 2, marginRight: 12 }} />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-foreground mb-0.5">{t.title}</Text>
              <Text className="text-xs text-muted-foreground leading-4">{t.body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
      <View className="px-6 pb-6 pt-2">
        <Button title="Log my first expense" onPress={() => finish(true)} className="mb-2" />
        <Pressable onPress={() => finish(false)} className="py-3 items-center">
          <Text className="text-sm text-muted-foreground">Take me to the dashboard</Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}
