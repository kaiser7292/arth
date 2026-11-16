import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Text } from "./Text";
import { useTheme } from "@/hooks/use-theme";
import { COMPONENTS } from "@/constants/design-tokens";

/**
 * A section's title with its icon: the same icon the filter rail shows, so a section reads the
 * same in the rail, the sheet, an edit form's group and a detail card.
 *
 * Not the small uppercase SectionHeader - that one labels a screen's sections; this one heads a
 * group of controls or fields.
 */
export function SectionTitle({
  icon,
  title,
  hint,
  right,
  active = false,
  className = "",
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint?: string;
  /** An action on the right, e.g. "Edit" or a count. */
  right?: ReactNode;
  /** Tints the icon box: something in this section is on. */
  active?: boolean;
  className?: string;
}) {
  const theme = useTheme();
  const S = COMPONENTS.sectionTitle;
  return (
    <View className={`${S.base} ${className}`}>
      <View
        className={S.iconBox}
        style={{ backgroundColor: active ? theme.alpha("primary", 0.1) : theme.alpha("foreground", 0.06) }}
      >
        <Ionicons name={icon} size={S.icon} color={active ? theme.primary : theme.mutedForeground} />
      </View>
      <View className="flex-1">
        <Text className={S.title} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {hint ? <Text className={S.hint}>{hint}</Text> : null}
      </View>
      {right}
    </View>
  );
}
