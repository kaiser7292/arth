import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View } from "react-native";
import { Card, SectionTitle, StatusPill, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

export interface ReviewQueueCounts {
  pending: number;
  duplicates: number;
  uncategorized: number;
  /** What the AI has waiting for a decision in Catch Up: a reply to paste, formats, same-place names. */
  ai?: number;
}

interface ReviewQueueCardProps {
  counts: ReviewQueueCounts;
  onPress: () => void;
  /** Opens Catch Up, the one-card-at-a-time review. */
  onCatchUp?: () => void;
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
  { key: "ai", icon: "sparkles-outline", one: "from AI to check", many: "from AI to check" },
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
export function ReviewQueueCard({ counts, onPress, onCatchUp }: ReviewQueueCardProps) {
  const theme = useTheme();

  const lines = KINDS.map(({ key, icon, one, many }) => ({
    key,
    icon,
    count: counts[key] ?? 0,
    label: counts[key] === 1 ? one : many,
  })).filter((i) => i.count > 0);

  if (lines.length === 0) return null;

  const total = lines.reduce((sum, i) => sum + i.count, 0);
  // The review queue shows no AI items: when they're all that waits, the card opens Catch Up.
  const onlyAi = lines.every((l) => l.key === "ai");
  const open = onlyAi && onCatchUp ? onCatchUp : onPress;

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${total} items need action: ${lines.map((i) => `${i.count} ${i.label}`).join(", ")}`}
    >
      <Card className="mx-4 mt-3">
        <SectionTitle
          icon="clipboard-outline"
          title="Action required"
          hint="Tap to review and resolve"
          active
          right={
            <View className="flex-row items-center" style={{ gap: 6 }}>
              <StatusPill label={`${total}`} color={theme.primary} />
              <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
            </View>
          }
        />
        <View className="mt-2" style={{ paddingLeft: 42 }}>
          {lines.map((line) => (
            <View key={line.key} className="flex-row items-center" style={{ minHeight: 30, gap: 8 }}>
              <Ionicons name={line.icon} size={14} color={theme.primary} />
              <Text className="text-body font-bold text-foreground">{line.count}</Text>
              <Text className="text-body text-muted-foreground">{line.label}</Text>
            </View>
          ))}
        </View>
        {onCatchUp && (
          <Pressable
            onPress={onCatchUp}
            className="flex-row items-center justify-center mt-3 rounded-pill"
            style={{ backgroundColor: theme.primary, height: 44, gap: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Catch up on ${total} items one at a time`}
          >
            <Ionicons name="albums-outline" size={16} color={theme.primaryForeground} />
            <Text className="text-body font-bold" style={{ color: theme.primaryForeground }}>
              Catch up ({total})
            </Text>
          </Pressable>
        )}
      </Card>
    </Pressable>
  );
}
