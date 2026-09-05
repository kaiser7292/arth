import { View, Pressable } from "react-native";
import { Text } from "@/components/ui";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { formatAmount } from "@/utils/format";
import { useTheme } from "@/hooks/use-theme";

interface ReviewItem {
  id: string;
  merchant: string;
  amount: number;
  frequency: string;
}

interface MonthlyReviewCardProps {
  items: ReviewItem[];
  onConfirm: (id: string) => void;
  onDeny: (id: string) => void;
  onConfirmAll: () => void;
  onSkip: () => void;
}

export function MonthlyReviewCard({
  items,
  onConfirm,
  onDeny,
  onConfirmAll,
  onSkip,
}: MonthlyReviewCardProps) {
  
  const theme = useTheme();

  if (items.length === 0) return null;

  return (
    <Card className="mb-4">
      <View className="flex-row items-center mb-3">
        <Ionicons name="bulb-outline" size={18} color={theme.primary} style={{ marginRight: 8 }} />
        <Text className="text-sm font-semibold text-foreground">
          Quick check (takes 30 seconds)
        </Text>
      </View>

      <Text className="text-xs text-muted-foreground mb-3">
        I noticed these might be regular:
      </Text>

      <View className="rounded-xl border border-border overflow-hidden">
        {items.map((item, idx) => (
          <View
            key={item.id}
            className={`flex-row items-center justify-between px-3 py-2.5 ${
              idx < items.length - 1 ? "border-b border-border" : ""
            }`}
          >
            <View className="flex-1 mr-3">
              <Text className="text-sm font-medium text-foreground capitalize">
                {formatAmount(item.amount)}  {item.merchant}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {capitalizeFirst(item.frequency)}?
              </Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={() => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  onConfirm(item.id);
                }}
                className="w-7 h-7 rounded-full items-center justify-center"
                style={{ backgroundColor: theme.success + "18" }}
                accessibilityLabel={`Confirm ${item.merchant} as recurring`}
              >
                <Ionicons name="checkmark" size={14} color={theme.success} />
              </Pressable>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onDeny(item.id);
                }}
                className="w-7 h-7 rounded-full items-center justify-center"
                style={{ backgroundColor: theme.danger + "18" }}
                accessibilityLabel={`Deny ${item.merchant} as recurring`}
              >
                <Ionicons name="close" size={14} color={theme.danger} />
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      <View className="flex-row items-center justify-between mt-4">
        <Button title="Confirm All" onPress={onConfirmAll} />
        <Pressable onPress={onSkip}>
          <Text className="text-xs font-medium text-muted-foreground">
            Skip for Now
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}


function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
