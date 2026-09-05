import { View, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";

import {
  setOnboardingCompletedVersion,
} from "@/services/settings";
import { getCurrentAppVersion } from "@/services/onboarding";
import { useTheme } from "@/hooks/use-theme";

const BULLETS: Array<{ icon: keyof typeof Ionicons.glyphMap; title: string; body: string }> = [
  {
    icon: "phone-portrait-outline",
    title: "100% on your phone",
    body: "No cloud, no sign-up. Your data stays on your device and is backed up only when you say so.",
  },
  {
    icon: "sparkles-outline",
    title: "Auto-detect from SMS",
    body: "Arth reads your bank SMS to log expenses, find accounts, and spot recurring payments. You review before anything is saved.",
  },
  {
    icon: "notifications-outline",
    title: "Reminders for recurring payments",
    body: "Netflix on the 5th, rent on the 1st, EMIs in a loop - we surface each upcoming bill and link real payments to it.",
  },
];

export default function OnboardingWelcome() {
  const router = useRouter();
  
  const theme = useTheme();

  const handleSkip = () => {
    setOnboardingCompletedVersion(getCurrentAppVersion());
    router.replace("/(tabs)");
  };

  return (
    <ScreenContainer safe padTop keyboardAware={false}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          className="text-3xl font-bold text-foreground mb-2"
          style={{ color: theme.primary }}
        >
          अर्थ
        </Text>
        <Text className="text-2xl font-bold text-foreground mb-3">
          Welcome to Arth
        </Text>
        <Text className="text-base text-muted-foreground mb-6 leading-6">
          A private finance tracker that respects your data and your time.
        </Text>

        {BULLETS.map((b) => (
          <View key={b.title} className="mb-5 flex-row">
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3 mt-0.5"
              style={{ backgroundColor: theme.primary + "1F" }}
            >
              <Ionicons
                name={b.icon}
                size={20}
                color={theme.primary}
              />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-foreground mb-1">
                {b.title}
              </Text>
              <Text className="text-sm text-muted-foreground leading-5">
                {b.body}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View className="px-6 pb-6 pt-2">
        <Button
          title="Get started"
          onPress={() => router.push("/(onboarding)/region")}
          className="mb-3"
        />
        <Pressable onPress={handleSkip} className="py-3 items-center">
          <Text className="text-sm text-muted-foreground">
            Skip for now
          </Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}
