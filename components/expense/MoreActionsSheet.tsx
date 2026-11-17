import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, ScrollView, View } from "react-native";
import { SectionTitle, Sheet, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

export interface MoreAction {
  key: string;
  label: string;
  /** One line on what it does. */
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  danger?: boolean;
}

export interface MoreActionGroup {
  key: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  items: MoreAction[];
}

/**
 * Everything you can do to a transaction that isn't in its four-button row, in four groups:
 * Organise, Money moved, Link it to, Copy and remove. Only what applies is passed in, so an empty
 * group never shows.
 */
export function MoreActionsSheet({
  visible,
  onClose,
  groups,
}: {
  visible: boolean;
  onClose: () => void;
  groups: MoreActionGroup[];
}) {
  const theme = useTheme();
  const shown = groups.filter((g) => g.items.length > 0);
  return (
    <Sheet visible={visible} onClose={onClose} maxHeightPct={85}>
      <Text className="text-title font-bold text-foreground px-5 pb-2" accessibilityRole="header">
        More
      </Text>
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        {shown.map((g, gi) => (
          <View key={g.key} className={`px-5 pt-3 ${gi > 0 ? "border-t border-border mt-2" : ""}`}>
            <SectionTitle icon={g.icon} title={g.title} className="mb-1" />
            {g.items.map((it) => (
              <Pressable
                key={it.key}
                onPress={() => {
                  onClose();
                  // Let this sheet close before the next one opens.
                  setTimeout(it.onPress, 260);
                }}
                className="flex-row items-center py-3"
                style={{ minHeight: 56 }}
                accessibilityRole="button"
                accessibilityLabel={it.label}
                accessibilityHint={it.hint}
              >
                <View
                  className="w-10 h-10 rounded-control items-center justify-center mr-3"
                  style={{ backgroundColor: it.danger ? theme.alpha("danger", 0.1) : theme.alpha("primary", 0.1) }}
                >
                  <Ionicons name={it.icon} size={20} color={it.danger ? theme.danger : theme.primary} />
                </View>
                <View className="flex-1">
                  <Text className="text-body font-semibold" style={{ color: it.danger ? theme.danger : theme.foreground }}>
                    {it.label}
                  </Text>
                  <Text className="text-meta text-muted-foreground mt-0.5">{it.hint}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.faintForeground} />
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}
