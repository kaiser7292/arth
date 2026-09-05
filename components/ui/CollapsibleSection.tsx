import { useColorScheme } from "@/hooks/use-color-scheme";
import { settingsStorage as storage } from "@/services/storage";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { LayoutAnimation, Platform, Pressable, Text, UIManager, View } from "react-native";

// Enable LayoutAnimation on Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface CollapsibleSectionProps {
  title: string;
  /** Unique key for persisting collapse state */
  storageKey: string;
  /** Default expanded state (only used on first render if no stored value) */
  defaultExpanded?: boolean;
  /** Optional right-side content (e.g., total amount) */
  rightContent?: React.ReactNode;
  /** Optional icon */
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  /** Badge count */
  badge?: number;
  children: React.ReactNode;
}

export function CollapsibleSection({
  title,
  storageKey,
  defaultExpanded = true,
  rightContent,
  icon,
  iconColor,
  badge,
  children,
}: CollapsibleSectionProps) {
  const { colors } = useColorScheme();
  const fullKey = `collapsible_${storageKey}`;

  const [expanded, setExpanded] = useState(() => {
    const stored = storage.getBoolean(fullKey);
    return stored !== undefined ? stored : defaultExpanded;
  });

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const newVal = !expanded;
    setExpanded(newVal);
    storage.set(fullKey, newVal);
  };

  return (
    <View>
      <Pressable
        onPress={toggle}
        accessibilityLabel={`${title}, ${expanded ? "collapse" : "expand"}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        className="flex-row items-center justify-between py-2"
      >
        <View className="flex-row items-center flex-1">
          {icon && (
            <Ionicons
              name={icon}
              size={18}
              color={iconColor ?? colors.textSecondary}
              style={{ marginRight: 8 }}
            />
          )}
          <Text className="text-sm font-semibold text-foreground">
            {title}
          </Text>
          {badge !== undefined && badge > 0 && (
            <View className="ml-2 px-1.5 py-0.5 rounded-full bg-muted-light/10">
              <Text className="text-[10px] font-bold text-secondary-light">
                {badge}
              </Text>
            </View>
          )}
        </View>
        <View className="flex-row items-center">
          {rightContent}
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={16}
            color={colors.textSecondary}
          />
        </View>
      </Pressable>
      {expanded && children}
    </View>
  );
}
