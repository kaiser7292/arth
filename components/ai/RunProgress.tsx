import type { ReactNode } from "react";
import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pop } from "@/components/motion/Pop";
import { ProgressBar, ScreenContainer, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

export interface FeedItem {
  id: number;
  text: string;
  ok: boolean;
}

/**
 * A long wait made watchable: a big percentage and bar, what's happening now, running counters,
 * and a live list of the last few things handled. Showing the work, not just a spinner, is what
 * makes a wait feel worth it (the "labour illusion", Buell & Norton 2011), and past ~10 seconds
 * people need a percentage (Nielsen). Used by AI Assisted Setup while reading and applying a reply,
 * and by onboarding's first read of transaction messages.
 */
export function RunProgress({
  title,
  done,
  total,
  doing,
  counters,
  feed,
  fraction,
  standalone,
  footer,
}: {
  title: string;
  done: number;
  /** 0 when the total isn't known yet: the count line is left out. */
  total: number;
  doing: string;
  counters: { label: string; value: number | string }[];
  /** Newest first. */
  feed: FeedItem[];
  /** Overall progress when it isn't simply done / total (a scan with stages). */
  fraction?: number;
  /** A screen of its own with no header above it (onboarding): pads for the status bar. */
  standalone?: boolean;
  footer?: ReactNode;
}) {
  const theme = useTheme();
  const raw = fraction ?? (total > 0 ? done / total : 0);
  const pct = Math.max(0, Math.min(100, Math.round(raw * 100)));
  return (
    <ScreenContainer padTop={!!standalone} safe={standalone ? true : undefined}>
      <View className={`px-5 flex-1 ${standalone ? "pt-8" : "pt-4"}`}>
        <Text className="text-sm font-semibold text-muted-foreground">{title}</Text>
        <View className="flex-row items-baseline mt-2" accessibilityLabel={`${pct} percent, ${done} of ${total}`}>
          <Text style={{ fontSize: 48, fontWeight: "800", color: theme.foreground, letterSpacing: -1 }}>{pct}%</Text>
          {total > 0 && (
            <Text className="text-sm text-muted-foreground ml-3">
              {done.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
            </Text>
          )}
        </View>
        <ProgressBar value={pct / 100} height={10} className="mt-2" />
        <Text className="text-sm text-muted-foreground mt-2" numberOfLines={1}>
          {doing}…
        </Text>

        <View className="flex-row flex-wrap mt-5" style={{ marginHorizontal: -4 }}>
          {counters.map((c) => (
            <View key={c.label} style={{ width: "50%", padding: 4 }}>
              <View className="rounded-xl bg-card px-3 py-2.5">
                <Text className="text-xs text-muted-foreground" numberOfLines={1}>{c.label}</Text>
                <Text className="text-xl font-bold text-foreground mt-0.5" numberOfLines={1}>
                  {typeof c.value === "number" ? c.value.toLocaleString("en-IN") : c.value}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-6 mb-2">Just now</Text>
        <View style={{ flex: 1, overflow: "hidden" }}>
          {feed.map((f) => (
            <Pop key={f.id}>
              <View className="flex-row items-center py-2 border-b border-border">
                <Ionicons
                  name={f.ok ? "checkmark-circle" : "remove-circle-outline"}
                  size={16}
                  color={f.ok ? theme.success : theme.mutedForeground}
                />
                <Text className="text-sm ml-2 flex-1" style={{ color: f.ok ? theme.foreground : theme.mutedForeground }} numberOfLines={1}>
                  {f.text}
                </Text>
              </View>
            </Pop>
          ))}
        </View>
        {footer}
      </View>
    </ScreenContainer>
  );
}
