import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /** When true, renders with flex-1 centered layout (full-screen empty states). Default true. */
  fillScreen?: boolean;
}

export function EmptyState({
  icon,
  title,
  subtitle,
  action,
  fillScreen = true,
}: EmptyStateProps) {
  const { colors } = useColorScheme();
  return (
    <View className={`items-center justify-center px-6 py-12 ${fillScreen ? "flex-1" : ""}`}>
      <Ionicons name={icon} size={48} color={colors.textSecondary} />
      <Text className="text-lg font-medium text-foreground mt-4 text-center">
        {title}
      </Text>
      {subtitle && (
        <Text className="text-sm text-muted-foreground mt-1 text-center">
          {subtitle}
        </Text>
      )}
      {action && <View className="mt-4">{action}</View>}
    </View>
  );
}
