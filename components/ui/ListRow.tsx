import { View, Pressable } from "react-native";
import Animated from "react-native-reanimated";
import { usePressScale } from "@/components/motion/motion";
import { Text } from "./Text";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { COMPONENTS } from "@/constants/design-tokens";

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
  const press = usePressScale(!!(onPress || onLongPress));
  const resolvedColor = iconColor ?? colors.textSecondary;
  const content = (
    <View className={COMPONENTS.listRow.base} accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}>
      <View
        className="w-9 h-9 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: `${resolvedColor}18` }}
      >
        <Ionicons name={icon} size={COMPONENTS.listRow.icon} color={resolvedColor} />
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
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityLabel={title}
        accessibilityRole="button"
      >
        <Animated.View style={press.style}>{content}</Animated.View>
      </Pressable>
    );
  }

  return content;
}
