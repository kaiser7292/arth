import { View, Pressable } from "react-native";
import { Text } from "@/components/ui";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useColorScheme } from "@/hooks/use-color-scheme";

import { formatAmount } from "@/utils/format";
import { formatDisplayDate as formatDate } from "@/utils/date";
import { useTheme } from "@/hooks/use-theme";

interface LearningNudgeProps {
  merchant: string;
  amount: number;
  evidence: { amount: number; date: string }[];
  onConfirm: () => void;
  onDeny: () => void;
  onDismiss: () => void;
}

export function LearningNudge({
  merchant,
  amount,
  evidence,
  onConfirm,
  onDeny,
  onDismiss,
}: LearningNudgeProps) {
  
  const theme = useTheme();

  const handleConfirm = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onConfirm();
  };

  const handleDeny = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onDeny();
  };

  return (
    <View
      className="rounded-2xl p-4 mb-3"
      style={{ backgroundColor: theme.alpha("primary", 0.25) }}
      accessibilityLabel={`Pattern suggestion: ${merchant} looks like a monthly expense. Confirm or deny.`}
    >
      <View className="flex-row items-start mb-2">
        <Ionicons name="bulb-outline" size={18} color={theme.primary} style={{ marginRight: 8, marginTop: 1 }} />
        <Text className="text-sm font-medium text-foreground flex-1">
          This looks like a monthly expense. Is it?
        </Text>
      </View>

      {evidence.length > 0 && (
        <View className="ml-7 mb-3">
          <Text className="text-xs text-muted-foreground mb-1">
            Similar payments:
          </Text>
          {evidence.slice(0, 3).map((e, i) => (
            <Text key={i} className="text-xs text-muted-foreground">
              · {formatAmount(e.amount)} on {formatDate(e.date)}
            </Text>
          ))}
        </View>
      )}

      <View className="flex-row items-center gap-3 ml-7">
        <Pressable
          onPress={handleConfirm}
          className="px-3.5 py-2 rounded-full border"
          style={{ borderColor: theme.primary, backgroundColor: theme.alpha("primary", 0.06) }}
          accessibilityLabel="Yes, monthly"
          accessibilityRole="button"
        >
          <Text className="text-xs font-medium" style={{ color: theme.primary }}>
            Yes, monthly
          </Text>
        </Pressable>
        <Pressable
          onPress={handleDeny}
          className="px-3.5 py-2 rounded-full border border-border"
          accessibilityLabel="No, one-time"
          accessibilityRole="button"
        >
          <Text className="text-xs font-medium text-muted-foreground">
            No, one-time
          </Text>
        </Pressable>
      </View>

      <Pressable onPress={onDismiss} className="mt-2 ml-7">
        <Text className="text-xs text-faint-foreground">
          Don't ask again for this
        </Text>
      </Pressable>
    </View>
  );
}


