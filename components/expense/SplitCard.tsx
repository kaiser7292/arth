import { View } from "react-native";
import { FieldRow, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import type { SplitView, SplitViewPerson } from "@/services/split-draft";
import { formatAmount } from "@/utils/format";
import { LinkedCard } from "./LinkedCard";

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
    <LinkedCard
      heading="Split"
      icon="people-outline"
      title={`${formatAmount(view.total)} · ${payer}`}
      subtitle={view.modeLabel}
      actions={[{ label: "Edit split", icon: "create-outline", onPress: onEdit }]}
    >
      {/* Your share of the bill */}
      <View className="flex-row h-1.5 rounded-pill overflow-hidden mb-1" style={{ backgroundColor: theme.alpha("foreground", 0.08) }}>
        <View style={{ flex: Math.max(view.me.amount, 0), backgroundColor: theme.primary }} />
        <View style={{ flex: Math.max(view.total - view.me.amount, 0) }} />
      </View>
      <FieldRow divider={false} label="You" value={`${view.me.pct}% · ${formatAmount(view.me.amount)}`} />
      {view.people.map((p) => (
        <FieldRow
          key={p.personId}
          label={p.description ? `${p.name} · ${p.description}` : p.name}
          value={`${p.pct}% · ${formatAmount(p.amount)}`}
          onPress={() => onOpenPerson(p)}
          accessibilityLabel={`${p.name}, ${p.pct} percent, ${formatAmount(p.amount)}. Open their Hisaab`}
        />
      ))}
      {view.owes && (
        <FieldRow label={view.owes.text}>
          <Text className="text-body font-bold text-foreground">{formatAmount(view.owes.amount)}</Text>
        </FieldRow>
      )}
    </LinkedCard>
  );
}
