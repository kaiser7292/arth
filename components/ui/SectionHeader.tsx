import { View, Text, Pressable } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";

interface SectionHeaderProps {
  title: string;
  action?: {
    label: string;
    onPress: () => void;
  };
}

export function SectionHeader({ title, action }: SectionHeaderProps) {
  const { colors } = useColorScheme();
  return (
    <View className="flex-row items-center justify-between mb-3">
      <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
        {title}
      </Text>
      {action && (
        <Pressable onPress={action.onPress} hitSlop={8} accessibilityLabel={action.label} accessibilityRole="button"
        >
          <Text className="text-xs font-medium" style={{ color: colors.tint }}>
            {action.label}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
