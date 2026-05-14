import { useState } from "react";
import { View, Text, ScrollView, Pressable, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Button } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import { enableSmsDetection } from "@/services/sms/sms-permissions";
import { setOnboardingCompletedVersion } from "@/services/settings";
import { getCurrentAppVersion } from "@/services/onboarding";
import { logger } from "@/utils/logger";

const POINTS: Array<{ icon: keyof typeof Ionicons.glyphMap; text: string }> = [
  { icon: "eye-off-outline", text: "Only bank/UPI SMS are read. Personal messages are ignored." },
  { icon: "phone-portrait-outline", text: "All processing happens on your device. Nothing is uploaded." },
  { icon: "checkmark-done-outline", text: "Every detected expense goes to a review queue. You approve each one." },
  { icon: "toggle-outline", text: "You can turn it off any time in Settings." },
];

export default function OnboardingSmsConsent() {
  const router = useRouter();
  const { accent, colorScheme } = useColorScheme();
  const [requesting, setRequesting] = useState(false);

  const advance = () => router.push("/(onboarding)/accounts-preview" as never);

  const handleGrant = async () => {
    setRequesting(true);
    try {
      await enableSmsDetection();
    } catch (e) {
      logger.warn("enableSmsDetection from onboarding failed:", e);
    } finally {
      setRequesting(false);
      advance();
    }
  };

  const handleSkipStep = () => {
    advance();
  };

  const handleSkipAll = () => {
    setOnboardingCompletedVersion(getCurrentAppVersion());
    router.replace("/(tabs)" as never);
  };

  return (
    <ScreenContainer safe padTop>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          className="w-12 h-12 rounded-full items-center justify-center mb-4"
          style={{ backgroundColor: ac(accent, colorScheme, 500, 200) + "1F" }}
        >
          <Ionicons
            name="mail-unread-outline"
            size={24}
            color={ac(accent, colorScheme, 500, 200)}
          />
        </View>

        <Text className="text-2xl font-bold text-text-primary dark:text-text-dark-primary mb-2">
          Read bank SMS?
        </Text>
        <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mb-6 leading-5">
          {Platform.OS === "android"
            ? "The fastest way to set up Artha. We read your bank SMS on this device, match them to accounts, and queue expenses for your review."
            : "SMS auto-detect is only available on Android. You can still log expenses manually or import from Excel."}
        </Text>

        {POINTS.map((p) => (
          <View key={p.text} className="flex-row items-start mb-4">
            <Ionicons
              name={p.icon}
              size={18}
              color={ac(accent, colorScheme, 500, 200)}
              style={{ marginTop: 2, marginRight: 12 }}
            />
            <Text className="flex-1 text-sm text-text-primary dark:text-text-dark-primary leading-5">
              {p.text}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View className="px-6 pb-6 pt-2">
        {Platform.OS === "android" ? (
          <>
            <Button
              title="Allow SMS access"
              onPress={handleGrant}
              loading={requesting}
              className="mb-3"
            />
            <Pressable onPress={handleSkipStep} className="py-2 items-center mb-1">
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
                Not now
              </Text>
            </Pressable>
          </>
        ) : (
          <Button title="Continue" onPress={advance} className="mb-3" />
        )}
        <Pressable onPress={handleSkipAll} className="py-2 items-center">
          <Text className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
            Skip setup entirely
          </Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}
