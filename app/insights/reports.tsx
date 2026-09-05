import { View, ScrollView, Pressable } from "react-native";

import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { useTheme } from "@/hooks/use-theme";

interface ReportCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
  inputsNeeded: string;
  onPress: () => void;
}

function ReportCard({ icon, iconColor, iconBg, title, description, inputsNeeded, onPress }: ReportCardProps) {
  return (
    <Pressable
      onPress={onPress}
      className="bg-card rounded-2xl p-4 mb-3 border border-border"
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View className="flex-row items-start gap-3">
        <View
          className="w-10 h-10 rounded-lg items-center justify-center"
          style={{ backgroundColor: iconBg }}
        >
          <Ionicons name={icon} size={20} color={iconColor} />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-semibold text-foreground">
            {title}
          </Text>
          <Text className="text-xs text-muted-foreground mt-0.5">
            {description}
          </Text>
        </View>
      </View>
      <View className="flex-row items-center justify-between mt-3 pt-2 border-t border-border">
        <Text className="text-xs text-muted-foreground opacity-60">
          {inputsNeeded}
        </Text>
        <View className="flex-row items-center gap-1">
          <Text className="text-xs font-medium" style={{ color: iconColor }}>
            Generate
          </Text>
          <Ionicons name="arrow-forward" size={12} color={iconColor} />
        </View>
      </View>
    </Pressable>
  );
}

export default function ReportsHubScreen() {
  const router = useRouter();
  
  const theme = useTheme();

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View className="px-4 pt-2 pb-4">
          <Text className="text-xs text-muted-foreground leading-5">
            Personalized reports generated from your actual financial data
          </Text>
        </View>

        <View className="px-4">
          <ReportCard
            icon="heart-outline"
            iconColor={theme.success}
            iconBg={theme.alpha("success", 0.08)}
            title="Financial health"
            description="Net worth, savings rate, debt ratio, emergency readiness, grade card"
            inputsNeeded="No user input needed"
            onPress={() => router.push("/insights/report-financial-health")}
          />

          <ReportCard
            icon="umbrella-outline"
            iconColor={theme.primary}
            iconBg="#3B82F614"
            title="Retirement readiness"
            description="Corpus target, SIP plan, phase roadmap, risk assessment, scenarios"
            inputsNeeded="5 inputs needed"
            onPress={() => router.push("/insights/report-retirement")}
          />

          <ReportCard
            icon="trending-down-outline"
            iconColor={theme.warning}
            iconBg={theme.alpha("warning", 0.08)}
            title="Loan payoff strategy"
            description="Avalanche vs snowball, interest saved, optimal payoff sequence"
            inputsNeeded="1 input needed"
            onPress={() => router.push("/insights/report-loan-payoff")}
          />

          <ReportCard
            icon="person-outline"
            iconColor="#EC4899"
            iconBg="#EC489914"
            title="Spending personality"
            description="Archetype, patterns, top merchants, behavioral shifts, consistency"
            inputsNeeded="No user input needed"
            onPress={() => router.push("/insights/report-spending-personality")}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
