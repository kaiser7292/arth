import { View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { setOnboardingCompletedVersion } from "@/services/settings";
import { getCurrentAppVersion } from "@/services/onboarding";
import { useTheme } from "@/hooks/use-theme";

export default function OnboardingDone() {
  const router = useRouter();
  
  const theme = useTheme();

  const finish = (andAddExpense: boolean) => {
    setOnboardingCompletedVersion(getCurrentAppVersion());
    if (andAddExpense) {
      router.replace("/(tabs)" as never);
      // Defer the push slightly so the tabs layout mounts first.
      setTimeout(() => router.push("/expense/add" as never), 50);
    } else {
      router.replace("/(tabs)" as never);
    }
  };

  return (
    <ScreenContainer safe padTop centered>
      <View className="items-center px-8">
        <View
          className="w-20 h-20 rounded-full items-center justify-center mb-6"
          style={{ backgroundColor: theme.primary + "1F" }}
        >
          <Ionicons
            name="checkmark"
            size={40}
            color={theme.primary}
          />
        </View>
        <Text className="text-2xl font-bold text-foreground text-center mb-3">
          You're set
        </Text>
        <Text className="text-sm text-muted-foreground text-center leading-5 mb-10">
          Arth will keep working quietly in the background. When a bank SMS comes in or you log an expense manually, it shows up in your dashboard.
        </Text>
        <Button
          title="Log my first expense"
          onPress={() => finish(true)}
          className="mb-3 self-stretch"
        />
        <Pressable onPress={() => finish(false)} className="py-3">
          <Text className="text-sm text-muted-foreground">
            Take me to the dashboard
          </Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}
