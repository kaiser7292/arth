import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import type { SplitView, SplitViewPerson } from "@/services/split-draft";
import { formatAmount } from "@/utils/format";

/** How a bill is split: the total, who paid, each person's percentage and amount, who owes whom. */
export function SplitCard({
  view,
  onEdit,
  onOpenPerson,
}: {
  view: SplitView;
  onEdit: () => void;
  onOpenPerson: (person: SplitViewPerson) => void;
}) {
  const theme = useTheme();
  const payer = view.paidBy === "me" ? "you paid" : `${view.people[0]?.name ?? "they"} paid`;
  return (
    <Card>
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-foreground">Split</Text>
        <Pressable onPress={onEdit} hitSlop={10} accessibilityRole="button" accessibilityLabel="Edit split">
          <Text className="text-sm font-semibold" style={{ color: theme.primary }}>Edit</Text>
        </Pressable>
      </View>
      <Text className="text-xs text-muted-foreground mt-0.5">
        {formatAmount(view.total)} · {payer} · {view.modeLabel}
      </Text>

      <View className="flex-row h-1.5 rounded-full overflow-hidden my-3" style={{ backgroundColor: theme.alpha("foreground", 0.08) }}>
        <View style={{ flex: Math.max(view.me.amount, 0), backgroundColor: theme.primary }} />
        <View style={{ flex: Math.max(view.total - view.me.amount, 0) }} />
      </View>

      <View className="flex-row items-center justify-between py-1.5">
        <Text className="text-sm text-foreground">You</Text>
        <Text className="text-sm text-muted-foreground">
          {view.me.pct}% · <Text className="text-sm font-semibold text-foreground">{formatAmount(view.me.amount)}</Text>
        </Text>
      </View>
      {view.people.map((p) => (
        <Pressable
          key={p.personId}
          onPress={() => onOpenPerson(p)}
          className="flex-row items-center justify-between py-1.5"
          accessibilityRole="button"
          accessibilityLabel={`${p.name}, ${p.pct} percent, ${formatAmount(p.amount)}. Open their Hisaab`}
        >
          <View className="flex-1 mr-3">
            <Text className="text-sm text-foreground" numberOfLines={1}>{p.name}</Text>
            {p.description ? <Text className="text-xs text-muted-foreground" numberOfLines={1}>{p.description}</Text> : null}
          </View>
          <Text className="text-sm text-muted-foreground">
            {p.pct}% · <Text className="text-sm font-semibold text-foreground">{formatAmount(p.amount)}</Text>
          </Text>
          <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} style={{ marginLeft: 4 }} />
        </Pressable>
      ))}

      {view.owes && (
        <View className="flex-row items-center justify-between pt-2 mt-1.5 border-t border-border">
          <Text className="text-xs font-semibold text-muted-foreground">{view.owes.text}</Text>
          <Text className="text-sm font-bold text-foreground">{formatAmount(view.owes.amount)}</Text>
        </View>
      )}
    </Card>
  );
}
