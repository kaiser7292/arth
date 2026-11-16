import { View, Pressable } from "react-native";
import { Text } from "./Text";
import { useTheme } from "@/hooks/use-theme";

interface SectionHeaderProps {
  title: string;
  action?: {
    label: string;
    onPress: () => void;
  };
}

export function SectionHeader({ title, action }: SectionHeaderProps) {
  const theme = useTheme();
  return (
    <View className="flex-row items-center justify-between mb-3">
      <Text className="text-label font-semibold tracking-wider uppercase text-muted-foreground">
        {title}
      </Text>
      {action && (
        <Pressable onPress={action.onPress} hitSlop={8} accessibilityLabel={action.label} accessibilityRole="button"
        >
          <Text className="text-meta font-medium" style={{ color: theme.primary }}>
            {action.label}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
