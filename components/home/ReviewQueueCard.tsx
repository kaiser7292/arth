import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { Badge, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

export interface ReviewQueueCounts {
  pending: number;
  overdue: number;
  duplicates: number;
  uncategorized: number;
}

interface ReviewQueueCardProps {
  counts: ReviewQueueCounts;
  onPress: () => void;
}

/** Singular and plural written out; "1 duplicates" is the kind of thing people notice. */
const KINDS: {
  key: keyof ReviewQueueCounts;
  one: string;
  many: string;
}[] = [
  { key: "pending", one: "to review", many: "to review" },
  { key: "overdue", one: "overdue", many: "overdue" },
  { key: "duplicates", one: "duplicate", many: "duplicates" },
  { key: "uncategorized", one: "uncategorised", many: "uncategorised" },
];

/**
 * The home strip that leads into the review queue.
 *
 * It used to always print a generic total and then repeat the breakdown underneath, so the common
 * case - one kind of item - read as:
 *
 *     4 things need you
 *     4 pending review
 *
 * The same number twice, in two different phrasings. With one kind of item there is nothing to
 * total, so the item IS the headline. The total only earns its line when there is more than one
 * kind, and then the breakdown carries its own labels instead of being a joined string.
 *
 * It also fixes a real inconsistency: the total was pending + duplicates + uncategorised while the
 * breakdown below it also listed overdue, so the headline could read "4" above a list of 6. The
 * total is now derived from exactly the items shown.
 */
export function ReviewQueueCard({ counts, onPress }: ReviewQueueCardProps) {
  const theme = useTheme();

  const items = KINDS.map(({ key, one, many }) => ({
    key,
    count: counts[key],
    label: counts[key] === 1 ? one : many,
  })).filter((i) => i.count > 0);

  if (items.length === 0) return null;

  const total = items.reduce((sum, i) => sum + i.count, 0);
  const single = items.length === 1;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Review queue: ${items.map((i) => `${i.count} ${i.label}`).join(", ")}`}
    >
      {/* A queue, not a metric - so it reads as a strip rather than another equal-weight card. */}
      <View
        className="mx-4 mt-3 px-4 py-3 rounded-card flex-row items-center"
        style={{
          backgroundColor: theme.alpha("primary", 0.1),
          borderWidth: 1,
          borderColor: theme.alpha("primary", 0.22),
        }}
      >
        <View className="flex-1 pr-3">
          <Text className="text-body font-semibold text-foreground">
            {single
              ? `${total} ${items[0].label}`
              : `${total} ${total === 1 ? "thing needs" : "things need"} you`}
          </Text>
          {!single && (
            <View className="flex-row flex-wrap items-center mt-1.5" style={{ gap: 6 }}>
              {items.map((i) => (
                <Badge key={i.key} label={`${i.count} ${i.label}`} variant="primary" />
              ))}
            </View>
          )}
        </View>
        <Text className="text-meta font-semibold" style={{ color: theme.primary }}>
          Review
        </Text>
        <Ionicons name="chevron-forward" size={15} color={theme.primary} />
      </View>
    </Pressable>
  );
}
