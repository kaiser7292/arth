import Ionicons from "@expo/vector-icons/Ionicons";
import { Switch, View } from "react-native";
import { FAB, Text } from "@/components/ui";
import { tint } from "@/constants/brand";
import { useTheme } from "@/hooks/use-theme";
import { Frame } from "../preview-kit/Frame";

/** Website screenshot: Categories as cards with sub-category pills. Invented data. */
export default function ShotCategories() {
  const theme = useTheme();
  const cats: { name: string; icon: keyof typeof Ionicons.glyphMap; color: string; count: string; unavoidable?: boolean; off?: boolean; subs: string[] }[] = [
    { name: "Food & Dining", icon: "restaurant-outline", color: "#F97316", count: "142 transactions", subs: ["Groceries", "Eating out", "Food delivery"] },
    { name: "Bills", icon: "flash-outline", color: "#2563EB", count: "61 transactions", unavoidable: true, subs: ["Rent", "Electricity", "Mobile"] },
    { name: "Transport", icon: "car-outline", color: "#8B5CF6", count: "88 transactions", subs: ["Commute", "Fuel"] },
    { name: "Gym", icon: "fitness-outline", color: "#64748B", count: "No transactions yet", off: true, subs: [] },
  ];
  return (
    <Frame title="Categories" back overlay={<FAB icon="add" label="Category" onPress={() => {}} />}>
      <View className="mx-4 mb-3 flex-row items-center rounded-card px-4 py-3" style={{ backgroundColor: theme.alpha("primary", 0.08), gap: 12 }}>
        <Ionicons name="git-merge-outline" size={20} color={theme.primary} />
        <View className="flex-1">
          <Text className="text-body font-semibold text-foreground">Organise into sub-categories</Text>
          <Text className="text-meta text-muted-foreground">See suggestions; nothing changes until you apply</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={theme.faintForeground} />
      </View>
      {cats.map((c) => (
        <View key={c.name} className="mx-4 mb-3 rounded-card bg-card border border-border overflow-hidden" style={{ opacity: c.off ? 0.7 : 1 }}>
          <View className="flex-row items-center pl-3.5 pr-2.5" style={{ minHeight: 60, gap: 10 }}>
            <View className="w-9 h-9 rounded-control items-center justify-center" style={{ backgroundColor: tint(c.color, 0.12) }}>
              <Ionicons name={c.icon} size={18} color={c.color} />
            </View>
            <View className="flex-1 py-2" style={{ gap: 3 }}>
              <Text className="text-body font-bold text-foreground">{c.name}</Text>
              <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
                {c.unavoidable && (
                  <View className="rounded-pill px-1.5" style={{ backgroundColor: theme.alpha("foreground", 0.07) }}>
                    <Text className="text-label font-semibold text-muted-foreground">Unavoidable</Text>
                  </View>
                )}
                {c.off && (
                  <View className="rounded-pill px-1.5" style={{ backgroundColor: theme.alpha("danger", 0.08) }}>
                    <Text className="text-label font-semibold" style={{ color: theme.danger }}>Inactive</Text>
                  </View>
                )}
                <Text className="text-label text-muted-foreground">{c.count}</Text>
              </View>
            </View>
            <Switch value={!c.off} trackColor={{ false: theme.border, true: theme.primary }} thumbColor="#FFFFFF" />
            <View className="w-9 h-9 items-center justify-center">
              <Ionicons name="trash-outline" size={17} color={theme.mutedForeground} />
            </View>
          </View>
          <View className="flex-row flex-wrap pb-3" style={{ gap: 8, paddingLeft: 60, paddingRight: 14 }}>
            {c.subs.map((s) => (
              <View key={s} className="rounded-pill flex-row items-center px-3" style={{ height: 30, gap: 5, backgroundColor: tint(c.color, 0.12) }}>
                <Text className="text-meta font-semibold" style={{ color: c.color }}>{s}</Text>
              </View>
            ))}
            {!c.off && (
              <View className="rounded-pill items-center justify-center px-3" style={{ height: 30, borderWidth: 1.5, borderStyle: "dashed", borderColor: theme.border }}>
                <Text className="text-meta font-semibold text-muted-foreground">+ Sub-category</Text>
              </View>
            )}
          </View>
        </View>
      ))}
    </Frame>
  );
}
