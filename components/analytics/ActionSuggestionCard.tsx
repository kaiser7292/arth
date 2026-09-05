import { memo } from "react";

import { Text } from "@/components/ui";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { formatAmount } from "@/utils/format";

import { StatusPill } from "@/components/ui/StatusPill";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";

interface ActionSuggestionCardProps {
  suggestion: string;
  savingsAmount: number;
  difficulty: "Easy" | "Medium" | "Hard";
}

function ActionSuggestionCardBase({
  suggestion,
  savingsAmount,
  difficulty,
}: ActionSuggestionCardProps) {
  
  const theme = useTheme();

  const difficultyColor = difficulty === "Easy" ? theme.success : difficulty === "Medium" ? theme.warning : theme.danger;

  return (
    <View
      className="rounded-2xl p-4 mb-3"
      style={{ backgroundColor: theme.alpha("primary", 0.31), borderWidth: 1, borderColor: theme.alpha("primary", 0.25) }}
      accessibilityLabel={`Suggestion: ${suggestion}. Potential savings: ${formatAmount(savingsAmount)} per month. Difficulty: ${difficulty}`}
    >
      <View className="flex-row items-start">
        <Ionicons name="bulb" size={18} color={theme.primary} style={{ marginRight: 8, marginTop: 1 }} />
        <View className="flex-1">
          <Text className="text-sm text-foreground leading-5">
            {suggestion}
          </Text>
          {savingsAmount > 0 && (
            <Text className="text-sm font-bold text-foreground mt-1">
              Save {formatAmount(savingsAmount)}/month
            </Text>
          )}
          <View className="mt-2">
            <StatusPill label={`Difficulty: ${difficulty}`} color={difficultyColor} />
          </View>
        </View>
      </View>
    </View>
  );
}

export const ActionSuggestionCard = memo(ActionSuggestionCardBase);

