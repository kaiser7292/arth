import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, type ReactNode } from "react";
import { useColorScheme as useNativeWindColorScheme } from "nativewind";
import { ScrollView, View } from "react-native";
import { Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

/**
 * A phone screen for the website's screenshots (preview harness only): the app's header, the
 * page, and the bottom tabs. Every figure on these pages is invented.
 */
export function Frame({
  title,
  back = false,
  icons = [],
  tab,
  children,
  scroll = true,
  overlay,
}: {
  title: string;
  back?: boolean;
  icons?: (keyof typeof Ionicons.glyphMap)[];
  tab?: "home" | "transactions" | "budget" | "goals" | "settings";
  children: ReactNode;
  scroll?: boolean;
  overlay?: ReactNode;
}) {
  const theme = useTheme();
  // ?dark=1 renders the dark theme, to match the website's dark phone frames.
  const { setColorScheme } = useNativeWindColorScheme();
  useEffect(() => {
    if (typeof window !== "undefined" && /[?&]dark=1/.test(window.location.search)) setColorScheme("dark");
  }, [setColorScheme]);
  const tabs: { id: NonNullable<typeof tab>; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { id: "home", label: "Arth", icon: "home-outline" },
    { id: "transactions", label: "Transactions", icon: "receipt-outline" },
    { id: "budget", label: "Budget", icon: "wallet-outline" },
    { id: "goals", label: "Goals", icon: "trophy-outline" },
    { id: "settings", label: "Settings", icon: "settings-outline" },
  ];
  return (
    // A phone-width page (390px), so a 500px-wide headless browser can be cropped to it.
    <View style={{ width: 390, height: 844, overflow: "hidden", backgroundColor: theme.background }}>
      {/* Status bar, so the picture sits in a phone frame without a gap */}
      <View className="flex-row items-center justify-between" style={{ height: 34, paddingHorizontal: 26, paddingTop: 6 }}>
        <Text className="text-meta font-semibold text-foreground">9:41</Text>
        <View className="flex-row items-center" style={{ gap: 5 }}>
          <Ionicons name="cellular" size={14} color={theme.foreground} />
          <Ionicons name="wifi" size={14} color={theme.foreground} />
          <Ionicons name="battery-full" size={18} color={theme.foreground} />
        </View>
      </View>
      <View className="flex-row items-center px-4" style={{ height: 56, gap: 10, paddingTop: 4 }}>
        {back && <Ionicons name="chevron-back" size={24} color={theme.primary} />}
        <Text className="flex-1 font-bold text-foreground" style={{ fontSize: back ? 18 : 24 }} numberOfLines={1}>
          {title}
        </Text>
        {icons.map((ic) => (
          <Ionicons key={ic} name={ic} size={22} color={theme.foreground} style={{ marginLeft: 12 }} />
        ))}
      </View>
      <View style={{ flex: 1 }}>
        {scroll ? <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>{children}</ScrollView> : children}
        {overlay}
      </View>
      {tab && (
        <View className="flex-row bg-card border-t border-border" style={{ height: 64 }}>
          {tabs.map((t) => {
            const on = t.id === tab;
            return (
              <View key={t.id} className="flex-1 items-center justify-center" style={{ gap: 3 }}>
                <Ionicons name={t.icon} size={22} color={on ? theme.primary : theme.mutedForeground} />
                <Text className="text-label font-semibold" style={{ color: on ? theme.primary : theme.mutedForeground }}>
                  {t.label}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
