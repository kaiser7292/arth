import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Card, ProgressBar, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

/**
 * Presentational pieces of the swipe decks (check-ins and Catch Up). No data access here, so the
 * browser preview harness can render them.
 */

type IconName = keyof typeof Ionicons.glyphMap;
type Role = "primary" | "danger" | "mutedForeground";


/** "2 of 17" plus a progress bar, under the Stack header. */
export function DeckProgress({ position, total, context }: { position: number; total: number; context?: string }) {
  return (
    <View className="px-4 pt-2 pb-4">
      <View className="flex-row items-center justify-between mb-2">
        {context ? (
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{context}</Text>
        ) : (
          <View />
        )}
        <Text className="text-xs text-muted-foreground">
          {position} of {total}
        </Text>
      </View>
      <ProgressBar value={total > 0 ? position / total : 0} />
    </View>
  );
}

export interface FooterAction {
  label: string;
  icon: IconName;
  role?: Role;
  onPress: () => void;
}

/**
 * Extra actions as full-width rows at the bottom of the card (Settings-row style), so the only
 * buttons below the card are Skip and the main action.
 */
export function DeckCardActions({ actions, disabled }: { actions: FooterAction[]; disabled?: boolean }) {
  const theme = useTheme();
  if (actions.length === 0) return null;
  return (
    <View className="mt-3 -mb-1 border-t border-border">
      {actions.map((a, i) => {
        const color = theme[a.role ?? "primary"];
        return (
          <Pressable
            key={a.label}
            onPress={a.onPress}
            disabled={disabled}
            className={`flex-row items-center py-3 ${i > 0 ? "border-t border-border" : ""}`}
            style={{ minHeight: 48 }}
            accessibilityRole="button"
          >
            <Ionicons name={a.icon} size={20} color={color} />
            <Text className="text-sm font-semibold ml-3 flex-1" style={{ color }}>
              {a.label}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A card that fills the space between the progress bar and the footer, so a swipe can start
 * anywhere in the middle of the screen. Content scrolls inside it; extra actions stay pinned to
 * the card's bottom edge.
 */
export function DeckCard({
  actions,
  disabled,
  children,
}: {
  actions: FooterAction[];
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex-1">
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
      <DeckCardActions actions={actions} disabled={disabled} />
    </Card>
  );
}

/** Skip + the main action - always the same place on every deck, clear of the gesture bar. */
export function DeckFooter({
  hint,
  onSkip,
  primaryLabel,
  onPrimary,
  disabled,
}: {
  hint?: string;
  onSkip: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  disabled?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View className="px-4 pt-3" style={{ paddingBottom: insets.bottom + 20 }}>
      {hint ? <Text className="text-xs text-faint-foreground text-center mb-3">{hint}</Text> : null}
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Button title="Skip" variant="secondary" onPress={onSkip} disabled={disabled} />
        </View>
        <View className="flex-1">
          <Button title={primaryLabel} onPress={onPrimary} disabled={disabled} />
        </View>
      </View>
    </View>
  );
}

/** Centred card heading: small section label, then the title. */
export function DeckHeadline({ kicker, title, subtitle }: { kicker: string; title: string; subtitle?: string }) {
  return (
    <View className="items-center">
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{kicker}</Text>
      <Text className="text-base font-bold text-foreground text-center mt-1.5" numberOfLines={2}>
        {title}
      </Text>
      {subtitle ? <Text className="text-sm text-muted-foreground text-center mt-1">{subtitle}</Text> : null}
    </View>
  );
}

/** Label / value row for card details. */
export function DeckRow({ label, value, valueColor }: { label: string; value: React.ReactNode; valueColor?: string }) {
  return (
    <View className="flex-row justify-between items-center py-2.5 border-b border-border">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      {typeof value === "string" ? (
        <Text className="text-sm font-semibold text-foreground" style={valueColor ? { color: valueColor } : undefined}>
          {value}
        </Text>
      ) : (
        value
      )}
    </View>
  );
}
