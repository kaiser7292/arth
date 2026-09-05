import { View, Pressable } from "react-native";
import { Text } from "./Text";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";

interface ListRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  title: string;
  subtitle?: string;
  rightContent?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
}

export function ListRow({
  icon,
  iconColor,
  title,
  subtitle,
  rightContent,
  onPress,
  onLongPress,
}: ListRowProps) {
  const { colors } = useColorScheme();
  const resolvedColor = iconColor ?? colors.textSecondary;
  const content = (
    <View className="flex-row items-center py-3" accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}>
      <View
        className="w-9 h-9 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: `${resolvedColor}18` }}
      >
        <Ionicons name={icon} size={18} color={resolvedColor} />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-medium text-foreground">
          {title}
        </Text>
        {subtitle && (
          <Text className="text-xs text-muted-foreground mt-0.5">
            {subtitle}
          </Text>
        )}
      </View>
      {rightContent}
    </View>
  );

  if (onPress || onLongPress) {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityLabel={title}
        accessibilityRole="button"
      >
        {content}
      </Pressable>
    );
  }

  return content;
}
