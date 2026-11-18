import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";
import { Chip, FAB, GroupHeading, Text } from "@/components/ui";
import { tint } from "@/constants/brand";
import { useTheme } from "@/hooks/use-theme";
import { Frame } from "../preview-kit/Frame";

/** Website screenshot: Accounts list with balances and dues. Invented data. */
export default function ShotAccounts() {
  const theme = useTheme();
  const groups: { title: string; type: string; icon: keyof typeof Ionicons.glyphMap; rows: { name: string; sub: string; closed?: boolean }[] }[] = [
    {
      title: "Savings",
      type: "savings",
      icon: "business-outline",
      rows: [
        { name: "HDFC ****4821", sub: "₹1,42,380 · 2 modes" },
        { name: "Salary account", sub: "SBI · ₹38,210 · 1 mode" },
        { name: "Joint account ****5512", sub: "Closed Jun 2026", closed: true },
      ],
    },
    {
      title: "Credit cards",
      type: "credit_card",
      icon: "card-outline",
      rows: [
        { name: "ICICI ****1093", sub: "Owes ₹18,240 · 1 mode" },
        { name: "Axis ****6604", sub: "Nothing due" },
      ],
    },
    { title: "Loans", type: "loan", icon: "home-outline", rows: [{ name: "Home loan", sub: "Opens loan details · ₹18.4L left" }] },
    { title: "Pension", type: "pension", icon: "shield-checkmark-outline", rows: [{ name: "EPF", sub: "₹6,84,500" }] },
  ];
  const pill = (label: string, on: boolean) => (
    <View className="rounded-pill border px-2.5 justify-center" style={{ height: 28, borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.alpha("primary", 0.1) : theme.card }}>
      <Text className="text-meta font-semibold" style={{ color: on ? theme.primary : theme.foreground }}>{label} ▾</Text>
    </View>
  );
  return (
    <Frame title="Accounts" back overlay={<FAB icon="add" label="Account" onPress={() => {}} />}>
      <View className="mx-4 flex-row items-center rounded-control border border-border bg-card px-3" style={{ height: 44, gap: 8 }}>
        <Ionicons name="search" size={18} color={theme.mutedForeground} />
        <Text className="flex-1 text-body text-faint-foreground">Search accounts</Text>
        <Ionicons name="options-outline" size={20} color={theme.foreground} />
      </View>
      <View className="flex-row flex-wrap items-center px-4 py-2" style={{ gap: 8 }}>
        <Text className="text-meta text-muted-foreground">Grouped by</Text>
        {pill("Type", true)}
        <Text className="text-meta text-muted-foreground">sorted</Text>
        {pill("As listed", false)}
      </View>
      <View className="px-4">
        <View className="flex-row items-center rounded-card px-3.5 py-3 mb-1" style={{ backgroundColor: theme.alpha("warning", 0.08), gap: 12 }}>
          <Ionicons name="copy-outline" size={20} color={theme.warning} />
          <View className="flex-1">
            <Text className="text-body font-semibold text-foreground">1 account looks recorded twice</Text>
            <Text className="text-meta text-muted-foreground">Same bank and last digits · review and merge</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
        </View>
        {groups.map((g) => {
          const color = theme.data.accountType[g.type] ?? theme.primary;
          return (
            <View key={g.title} className="mb-1">
              <GroupHeading label={g.title} count={g.rows.length} total={0} inset={false} open onToggle={() => {}} noun={{ one: "account", many: "accounts" }} />
              <View className="bg-card border-x border-b border-border overflow-hidden" style={{ borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }}>
                {g.rows.map((r, i) => (
                  <View key={r.name} className={`flex-row items-center px-3.5 ${i > 0 ? "border-t border-border" : ""}`} style={{ minHeight: 64, gap: 12, opacity: r.closed ? 0.7 : 1 }}>
                    <View className="w-9 h-9 rounded-control items-center justify-center" style={{ backgroundColor: tint(color, 0.1) }}>
                      <Ionicons name={g.icon} size={17} color={color} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-body font-semibold text-foreground" numberOfLines={1}>{r.name}</Text>
                      <Text className="text-meta text-muted-foreground" numberOfLines={1}>{r.sub}</Text>
                    </View>
                    <Chip variant="status" className="self-center" tone={r.closed ? "neutral" : "success"} label={r.closed ? "Closed" : "Open"} />
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </Frame>
  );
}
