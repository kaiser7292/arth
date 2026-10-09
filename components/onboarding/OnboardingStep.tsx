import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Button, ScreenContainer, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { getCurrentAppVersion } from "@/services/onboarding";
import { setOnboardingCompletedVersion } from "@/services/settings";

interface OnboardingStepProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  children?: ReactNode;
  primaryLabel?: string;
  onPrimary: () => void;
  primaryLoading?: boolean;
  primaryDisabled?: boolean;
  /** "Skip this step" — moves on without saving. */
  onSkipStep?: () => void;
}

/** Shared layout for the optional onboarding steps: header, content, Continue / Skip. */
export function OnboardingStep({
  icon,
  title,
  subtitle,
  children,
  primaryLabel = "Continue",
  onPrimary,
  primaryLoading,
  primaryDisabled,
  onSkipStep,
}: OnboardingStepProps) {
  const theme = useTheme();
  const router = useRouter();

  const skipAll = () => {
    setOnboardingCompletedVersion(getCurrentAppVersion());
    router.replace("/(tabs)");
  };

  return (
    <ScreenContainer safe padTop>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View
          className="w-12 h-12 rounded-full items-center justify-center mb-4"
          style={{ backgroundColor: theme.primary + "1F" }}
        >
          <Ionicons name={icon} size={24} color={theme.primary} />
        </View>
        <Text className="text-2xl font-bold text-foreground mb-2">{title}</Text>
        <Text className="text-sm text-muted-foreground mb-6 leading-5">{subtitle}</Text>
        {children}
      </ScrollView>

      <View className="px-6 pb-6 pt-2">
        <Button
          title={primaryLabel}
          onPress={onPrimary}
          loading={primaryLoading}
          disabled={primaryDisabled}
          className="mb-2"
        />
        {onSkipStep ? (
          <Pressable onPress={onSkipStep} className="py-2 items-center">
            <Text className="text-sm text-muted-foreground">Skip this step</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={skipAll} className="py-2 items-center">
          <Text className="text-xs text-faint-foreground">Skip setup entirely</Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}
