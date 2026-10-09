import { useCallback } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, ScreenContainer, Text } from "@/components/ui";
import { Appear, DriftingShapes } from "@/components/motion";
import { useColorScheme } from "@/hooks/use-color-scheme";

import {
  getOnboardingCompletedVersion,
  setOnboardingCompletedVersion,
} from "@/services/settings";
import { getDatabase } from "@/database";
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

  // Coming back from "Restore from a backup": a successful restore brings back the onboarding
  // stamp (it's in the backup's settings) or at least the user's data, so go straight in.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (getOnboardingCompletedVersion()) {
          if (!cancelled) router.replace("/(tabs)");
          return;
        }
        const row = await getDatabase()
          .getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM expenses WHERE deleted_at IS NULL;")
          .catch(() => null);
        if (!cancelled && (row?.n ?? 0) > 0) {
          setOnboardingCompletedVersion(getCurrentAppVersion());
          router.replace("/(tabs)");
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [router]),
  );

  const handleSkip = () => {
    setOnboardingCompletedVersion(getCurrentAppVersion());
    router.replace("/(tabs)");
  };

  return (
    <ScreenContainer safe padTop keyboardAware={false}>
      <DriftingShapes />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Appear index={0}>
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
        </Appear>

        {BULLETS.map((b, i) => (
          <Appear key={b.title} index={i + 1} delay={60}>
          <View className="mb-5 flex-row">
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
          </Appear>
        ))}
      </ScrollView>

      <View className="px-6 pb-6 pt-2">
        <Button
          title="Get started"
          onPress={() => router.push("/(onboarding)/region")}
          className="mb-3"
        />
        <Pressable onPress={() => router.push("/settings/backup-restore")} className="py-3 items-center">
          <Text className="text-sm font-semibold text-primary">
            Restore from a backup
          </Text>
        </Pressable>
        <Pressable onPress={handleSkip} className="py-2 items-center">
          <Text className="text-sm text-muted-foreground">
            Skip for now
          </Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}
