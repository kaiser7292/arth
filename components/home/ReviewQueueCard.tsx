import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { Card, StatusPill, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

export interface ReviewQueueCounts {
  pending: number;
  duplicates: number;
  uncategorized: number;
}

interface ReviewQueueCardProps {
  counts: ReviewQueueCounts;
  onPress: () => void;
}

const KINDS: {
  key: keyof ReviewQueueCounts;
  icon: keyof typeof Ionicons.glyphMap;
  one: string;
  many: string;
}[] = [
  { key: "pending", icon: "swap-horizontal-outline", one: "pending review", many: "pending review" },
  { key: "duplicates", icon: "copy-outline", one: "possible duplicate", many: "possible duplicates" },
  { key: "uncategorized", icon: "help-circle-outline", one: "uncategorized", many: "uncategorized" },
];

/**
 * The home strip that leads into the review queue.
 *
 * Overdue dues are deliberately excluded from this count — they have their own surface
 * (Upcoming Dues, with its own action bar) and approving/rejecting an overdue forecast
 * never clears it from "overdue" (it just moves buckets), which made this card's total
 * look frozen. This card only counts things that actually leave the queue when acted on:
 * pending review, duplicates, uncategorized.
 */
export function ReviewQueueCard({ counts, onPress }: ReviewQueueCardProps) {
  const theme = useTheme();

  const lines = KINDS.map(({ key, icon, one, many }) => ({
    key,
    icon,
    count: counts[key],
    label: counts[key] === 1 ? one : many,
  })).filter((i) => i.count > 0);

  if (lines.length === 0) return null;

  const total = lines.reduce((sum, i) => sum + i.count, 0);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${total} items need action: ${lines.map((i) => `${i.count} ${i.label}`).join(", ")}`}
    >
      <Card className="mx-4 mt-3">
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-row items-center">
            <View
              className="w-9 h-9 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: theme.alpha("primary", 0.1) }}
            >
              <Ionicons name="clipboard-outline" size={18} color={theme.primary} />
            </View>
            <View>
              <Text className="text-sm font-semibold text-foreground">
                Action Required
              </Text>
              <Text className="text-xs text-muted-foreground">
                Tap to review and resolve
              </Text>
            </View>
          </View>
          <View className="flex-row items-center">
            <StatusPill label={`${total}`} color={theme.primary} />
            <Ionicons
              name="chevron-forward"
              size={16}
              color={theme.alpha("primary", 0.25)}
              style={{ marginLeft: 6 }}
            />
          </View>
        </View>
        {lines.map((line) => (
          <View key={line.key} className="flex-row items-center ml-12 mb-0.5">
            <Ionicons name={line.icon} size={12} color={theme.primary} style={{ marginRight: 6 }} />
            <Text className="text-xs text-muted-foreground">
              {line.count} {line.label}
            </Text>
          </View>
        ))}
      </Card>
    </Pressable>
  );
}
