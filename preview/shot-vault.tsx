import Ionicons from "@expo/vector-icons/Ionicons";
import { ScrollView, View } from "react-native";
import { Text } from "@/components/ui";
import { FastScrollRail } from "@/components/ui/FastScrollRail";
import { tint } from "@/constants/brand";
import { useTheme } from "@/hooks/use-theme";
import { Frame } from "../preview-kit/Frame";

/** Website screenshot: the Vault grouped by type, with the thumb rail. Invented data. */
export default function ShotVault() {
  const theme = useTheme();
  const groups: { label: string; icon: keyof typeof Ionicons.glyphMap; rows: { t: string; s?: string; link?: boolean }[] }[] = [
    { label: "Net banking", icon: "business-outline", rows: [{ t: "HDFC NetBanking", s: "user4821" }, { t: "SBI YONO", s: "+91 98•••• 4410" }] },
    { label: "Credit / debit card", icon: "card-outline", rows: [{ t: "ICICI Coral card", link: true }, { t: "Axis Flipkart card" }] },
    { label: "Demat / trading", icon: "trending-up-outline", rows: [{ t: "Zerodha Kite", s: "AB1234" }] },
    { label: "Subscription", icon: "play-circle-outline", rows: [{ t: "Netflix", s: "family@example.com" }, { t: "Spotify", s: "family@example.com" }] },
    { label: "Insurance", icon: "shield-checkmark-outline", rows: [{ t: "Health cover", s: "Policy 4410-22" }] },
    { label: "Other", icon: "ellipsis-horizontal-circle-outline", rows: [{ t: "Wi-Fi router" }] },
  ];
  return (
    <Frame title="Arth · अर्थ" icons={["search-outline", "mic-outline", "eye-outline"]} tab="home" scroll={false}>
      <View className="flex-row border-b border-border px-2">
        {["Overview", "Insights", "Projections", "Vault"].map((t) => (
          <View key={t} className="px-3 py-2.5" style={{ borderBottomWidth: t === "Vault" ? 3 : 0, borderBottomColor: theme.primary }}>
            <Text className="text-body font-semibold" style={{ color: t === "Vault" ? theme.foreground : theme.mutedForeground }}>{t}</Text>
          </View>
        ))}
      </View>
      <View className="mx-4 mt-2 mb-1 flex-row items-center rounded-control px-3 py-2.5" style={{ gap: 8, backgroundColor: theme.alpha("primary", 0.08) }}>
        <Ionicons name="lock-closed-outline" size={15} color={theme.primary} />
        <Text className="text-meta text-foreground flex-1">Encrypted and kept only on this phone.</Text>
      </View>
      <View className="mx-4 my-2 flex-row items-center rounded-control border border-border bg-card px-3" style={{ height: 44, gap: 8 }}>
        <Ionicons name="search" size={18} color={theme.mutedForeground} />
        <Text className="text-body text-faint-foreground">Search vault</Text>
      </View>
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingLeft: 16, paddingRight: 40, paddingBottom: 40 }}>
          {groups.map((g) => (
            <View key={g.label}>
              <View className="flex-row items-center pt-4 pb-2" style={{ gap: 8 }}>
                <Ionicons name={g.icon} size={15} color={theme.primary} />
                <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground flex-1">{g.label}</Text>
                <Text className="text-label font-semibold text-muted-foreground">{g.rows.length}</Text>
              </View>
              <View className="rounded-card border border-border overflow-hidden">
                {g.rows.map((r, i) => (
                  <View key={r.t} className={`flex-row items-center px-3.5 bg-card ${i > 0 ? "border-t border-border" : ""}`} style={{ minHeight: 64, gap: 12 }}>
                    <View className="w-10 h-10 rounded-control items-center justify-center" style={{ backgroundColor: tint(theme.primary, 0.1) }}>
                      <Ionicons name={g.icon} size={18} color={theme.primary} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-body font-semibold text-foreground">{r.t}</Text>
                      {r.s ? <Text className="text-meta text-muted-foreground">{r.s}</Text> : null}
                    </View>
                    {r.link && <View className="w-2 h-2 rounded-pill" style={{ backgroundColor: theme.warning }} />}
                  </View>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
        <FastScrollRail items={groups.map((g) => ({ key: g.label, label: g.label, icon: g.icon }))} onSelect={() => {}} />
      </View>
    </Frame>
  );
}
