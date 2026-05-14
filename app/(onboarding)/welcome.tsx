import { View, Text, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Button } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import {
  setOnboardingCompletedVersion,
} from "@/services/settings";
import { getCurrentAppVersion } from "@/services/onboarding";

const BULLETS: Array<{ icon: keyof typeof Ionicons.glyphMap; title: string; body: string }> = [
  {
    icon: "phone-portrait-outline",
    title: "100% on your phone",
    body: "No cloud, no sign-up. Your data stays on your device and is backed up only when you say so.",
  },
  {
    icon: "sparkles-outline",
    title: "Auto-detect from SMS",
    body: "Artha reads your bank SMS to log expenses, find accounts, and spot recurring payments. You review before anything is saved.",
  },
  {
    icon: "notifications-outline",
    title: "Reminders for recurring payments",
    body: "Netflix on the 5th, rent on the 1st, EMIs in a loop — we surface each upcoming bill and link real payments to it.",
  },
];

export default function OnboardingWelcome() {
  const router = useRouter();
  const { accent, colorScheme } = useColorScheme();

  const handleSkip = () => {
    setOnboardingCompletedVersion(getCurrentAppVersion());
    router.replace("/(tabs)" as never);
  };

  return (
    <ScreenContainer safe padTop keyboardAware={false}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          className="text-3xl font-bold text-text-primary dark:text-text-dark-primary mb-2"
          style={{ color: ac(accent, colorScheme, 500, 200) }}
        >
          अर्थ
        </Text>
        <Text className="text-2xl font-bold text-text-primary dark:text-text-dark-primary mb-3">
          Welcome to Artha
        </Text>
        <Text className="text-base text-text-secondary dark:text-text-dark-secondary mb-6 leading-6">
          A private finance tracker that respects your data and your time.
        </Text>

        {BULLETS.map((b) => (
          <View key={b.title} className="mb-5 flex-row">
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3 mt-0.5"
              style={{ backgroundColor: ac(accent, colorScheme, 500, 200) + "1F" }}
            >
              <Ionicons
                name={b.icon}
                size={20}
                color={ac(accent, colorScheme, 500, 200)}
              />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary mb-1">
                {b.title}
              </Text>
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary leading-5">
                {b.body}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View className="px-6 pb-6 pt-2">
        <Button
          title="Get started"
          onPress={() => router.push("/(onboarding)/region" as never)}
          className="mb-3"
        />
        <Pressable onPress={handleSkip} className="py-3 items-center">
          <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
            Skip for now
          </Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}
