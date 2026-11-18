import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";
import { Card, Chip, FieldRow, Text } from "@/components/ui";
import { Statement, UnderlineTabs } from "@/components/ui/LinkRow";
import { BRAND_COLOR, STATUS_COLORS } from "@/constants/semantic-colors";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount } from "@/utils/format";
import { Frame } from "../preview-kit/Frame";

/** Website screenshot: Budget overview (Left to spend + This month). Invented data. */
export default function ShotBudget() {
  const theme = useTheme();
  const rs = (n: number) => formatAmount(Math.round(n));
  const split = [
    { dot: theme.mutedForeground, label: "Loan EMIs", note: "from your loans", v: 18400, of: 18400, w: 0.13 },
    { dot: BRAND_COLOR, label: "Unavoidable", v: 41200, of: 62000, w: 0.3 },
    { dot: STATUS_COLORS.warning, label: "Discretionary", v: 17650, of: 26000, w: 0.13 },
  ];
  return (
    <Frame title="Budget" icons={["apps-outline", "search-outline", "eye-outline"]} tab="budget">
      <View className="flex-row items-center justify-center py-2" style={{ gap: 18 }}>
        <Ionicons name="chevron-back" size={20} color={theme.mutedForeground} />
        <View className="rounded-control px-3 py-1.5" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
          <Text className="text-body font-bold" style={{ color: theme.primary }}>Nov 2026 ▾</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={theme.mutedForeground} />
      </View>
      <UnderlineTabs tabs={[{ value: "o", label: "Overview" }, { value: "s", label: "Spending split" }, { value: "m", label: "Monthly summary" }]} value="o" onChange={() => {}} />
      <View className="px-4 pt-3" style={{ gap: 12 }}>
        <Card>
          <View className="flex-row items-end justify-between">
            <View className="flex-1">
              <Text className="text-meta text-muted-foreground">Left to spend</Text>
              <Text className="text-hero font-bold text-foreground">{rs(29150)}</Text>
            </View>
            <View className="items-end" style={{ gap: 4 }}>
              <Chip variant="status" className="self-end" tone="success" label="On track" />
              <Text className="text-meta text-muted-foreground text-right">of {rs(88000)}{"\n"}12 days left</Text>
            </View>
          </View>
          <View className="flex-row rounded-pill overflow-hidden mt-3.5" style={{ height: 8, backgroundColor: theme.alpha("foreground", 0.08) }}>
            {split.map((s) => (
              <View key={s.label} style={{ width: `${s.w * 100}%`, backgroundColor: s.dot }} />
            ))}
          </View>
          <View className="mt-2">
            {split.map((s) => (
              <View key={s.label} className="flex-row items-center py-2 border-t border-border" style={{ gap: 8 }}>
                <View className="w-2 h-2 rounded-pill" style={{ backgroundColor: s.dot }} />
                <View className="flex-1">
                  <Text className="text-meta text-foreground">{s.label}</Text>
                  {s.note ? <Text className="text-label text-muted-foreground">{s.note}</Text> : null}
                </View>
                <Text className="text-meta font-semibold text-foreground">{rs(s.v)}</Text>
                <Text className="text-label text-muted-foreground">/ {rs(s.of)}</Text>
                <Ionicons name="chevron-forward" size={12} color={theme.faintForeground} />
              </View>
            ))}
          </View>
          <View className="mt-3 px-3 py-2.5 rounded-control" style={{ backgroundColor: theme.alpha("success", 0.08) }}>
            <Text className="text-meta text-foreground">
              At this pace you&apos;ll spend <Text className="text-meta font-bold">{rs(79400)}</Text>. Keep to{" "}
              <Text className="text-meta font-bold">{rs(2429)} a day</Text> to stay on budget.
            </Text>
          </View>
        </Card>
        <Card>
          <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-1">This month</Text>
          <Statement lines={[{ label: "Budget", amount: rs(88000) }, { label: "Spent", sign: "−", amount: rs(58850) }]} total={{ label: "Left to spend", amount: rs(29150) }} />
          <FieldRow label="Money out, with EMIs" value={`${rs(77250)} of ${rs(106400)}`} />
          <FieldRow label="Per day left" value={rs(2429)} />
          <FieldRow label="Projected spend" value={rs(79400)} />
          <FieldRow label="Projected savings" value={rs(8600)} valueColor={theme.success} />
        </Card>
      </View>
    </Frame>
  );
}
