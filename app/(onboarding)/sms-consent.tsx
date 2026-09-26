import { useState } from "react";
import { View, ScrollView, Pressable, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button, ScreenContainer, Text } from "@/components/ui";
import { SmsDisclosure } from "@/components/sms/SmsDisclosure";

import { acceptSmsDisclosure, enableSmsDetection } from "@/services/sms/sms-permissions";
import { setOnboardingCompletedVersion } from "@/services/settings";
import { getCurrentAppVersion } from "@/services/onboarding";
import { logger } from "@/utils/logger";
import { useTheme } from "@/hooks/use-theme";

export default function OnboardingSmsConsent() {
  const router = useRouter();

  const theme = useTheme();
  const [requesting, setRequesting] = useState(false);

  const advance = () => router.push("/(onboarding)/accounts-preview");

  const handleGrant = async () => {
    setRequesting(true);
    try {
      acceptSmsDisclosure();
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
    router.replace("/(tabs)");
  };

  const skipAllLink = (
    <Pressable onPress={handleSkipAll} className="py-2 items-center">
      <Text className="text-xs text-faint-foreground">
        Skip setup entirely
      </Text>
    </Pressable>
  );

  if (Platform.OS === "android") {
    return (
      <ScreenContainer safe padTop>
        <SmsDisclosure
          onAccept={handleGrant}
          onDecline={handleSkipStep}
          accepting={requesting}
          footer={skipAllLink}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer safe padTop>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          className="w-12 h-12 rounded-full items-center justify-center mb-4"
          style={{ backgroundColor: theme.primary + "1F" }}
        >
          <Ionicons
            name="mail-unread-outline"
            size={24}
            color={theme.primary}
          />
        </View>

        <Text className="text-2xl font-bold text-foreground mb-2">
          Read bank SMS?
        </Text>
        <Text className="text-sm text-muted-foreground mb-6 leading-5">
          SMS auto-detect is only available on Android. You can still log expenses manually or import from Excel.
        </Text>
      </ScrollView>

      <View className="px-6 pb-6 pt-2">
        <Button title="Continue" onPress={advance} className="mb-3" />
        {skipAllLink}
      </View>
    </ScreenContainer>
  );
}
