import { useState } from "react";
import { View, ScrollView, Pressable, Platform } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, ScreenContainer, Text } from "@/components/ui";
import { SmsDisclosure } from "@/components/sms/SmsDisclosure";

import { acceptSmsDisclosure, enableSmsDetection } from "@/services/sms/sms-permissions";
import { setOnboardingCompletedVersion } from "@/services/settings";
import { getCurrentAppVersion } from "@/services/onboarding";
import { logger } from "@/utils/logger";
import { useTheme } from "@/hooks/use-theme";

/** iPhone: the ways payments come in without message access. */
const IOS_ROUTES: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  {
    icon: "chatbubble-ellipses-outline",
    title: "Bank messages, through Shortcuts",
    body: "Set up a Shortcuts automation once and each bank message is handed to Arth in the background. Takes two minutes.",
  },
  {
    icon: "image-outline",
    title: "Payment screenshots",
    body: "Share a Google Pay, PhonePe or bank app screenshot to Arth, or add one with + then From a Picture.",
  },
  {
    icon: "document-text-outline",
    title: "Statements and by hand",
    body: "Import a bank statement from Excel, or add a payment yourself, with voice if you like.",
  },
];

export default function OnboardingSmsConsent() {
  const router = useRouter();

  const theme = useTheme();
  const [requesting, setRequesting] = useState(false);

  const advance = () => router.push("/(onboarding)/accounts-preview");

  const handleGrant = async () => {
    setRequesting(true);
    let granted = false;
    try {
      acceptSmsDisclosure();
      granted = await enableSmsDetection();
    } catch (e) {
      logger.warn("enableSmsDetection from onboarding failed:", e);
    } finally {
      setRequesting(false);
      // With permission: choose how far back to read, then the first-scan summary.
      if (granted) router.push("/(onboarding)/first-scan");
      else advance();
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
          How payments get into Arth
        </Text>
        <Text className="text-sm text-muted-foreground mb-5 leading-5">
          iPhone doesn&apos;t let apps read your messages, so on iPhone they come in these ways. Everything is read on this phone,
          and you review it before it counts.
        </Text>
        {IOS_ROUTES.map((r) => (
          <View key={r.title} className="flex-row mb-4">
            <Ionicons name={r.icon} size={20} color={theme.primary} style={{ marginTop: 1 }} />
            <View className="flex-1 ml-3">
              <Text className="text-sm font-semibold text-foreground">{r.title}</Text>
              <Text className="text-xs text-muted-foreground mt-0.5 leading-4">{r.body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View className="px-6 pb-6 pt-2">
        <Button title="Set up bank messages" onPress={() => router.push("/settings/iphone-bank-messages")} className="mb-2" />
        <Button title="Continue" variant="ghost" onPress={advance} className="mb-2" />
        {skipAllLink}
      </View>
    </ScreenContainer>
  );
}
