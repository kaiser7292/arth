import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";
import { Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

/** True for a transaction on-device AI read from a message no pattern knew. */
export function isReadByAi(expense: { parse_source?: string | null }): boolean {
  return expense.parse_source === "ai";
}

/**
 * The "Read by AI" mark on a transaction Gemini Nano read (Catch Up card, review list). The AI's
 * reading passed Arth's checks against the message, but the person should look before approving.
 * `compact` is the small tag for list rows.
 */
export function ReadByAiChip({ compact }: { compact?: boolean }) {
  const theme = useTheme();
  if (compact) {
    return (
      <View className="px-1.5 py-0.5 rounded mr-1.5 flex-row items-center" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
        <Ionicons name="sparkles-outline" size={10} color={theme.primary} />
        <Text className="text-label font-semibold ml-0.5" style={{ color: theme.primary }}>
          AI
        </Text>
      </View>
    );
  }
  return (
    <View
      className="flex-row items-center self-center px-2.5 py-1 rounded-full mb-3"
      style={{ backgroundColor: theme.alpha("primary", 0.1) }}
      accessibilityLabel="Read by on-device AI. Check the amount and account before approving."
    >
      <Ionicons name="sparkles-outline" size={12} color={theme.primary} />
      <Text className="text-xs font-semibold ml-1" style={{ color: theme.primary }}>
        Read by on-device AI · check it
      </Text>
    </View>
  );
}
