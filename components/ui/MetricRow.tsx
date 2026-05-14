import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";

interface MetricRowProps {
  label: string;
  value: string;
  sublabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  color?: string;
  bold?: boolean;
}

export function MetricRow({
  label,
  value,
  sublabel,
  icon,
  color,
  bold,
}: MetricRowProps) {
  const { colors } = useColorScheme();

  return (
    <View className="flex-row items-center justify-between py-1.5">
      <View className="flex-row items-center flex-1 mr-2">
        {icon && (
          <Ionicons
            name={icon}
            size={16}
            color={color ?? colors.textSecondary}
            style={{ marginRight: 6 }}
          />
        )}
        <View className="flex-1">
          <Text
            className={`text-sm ${bold ? "font-semibold text-text-primary dark:text-text-dark-primary" : "text-text-secondary dark:text-text-dark-secondary"}`}
          >
            {label}
          </Text>
          {sublabel && (
            <Text className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
              {sublabel}
            </Text>
          )}
        </View>
      </View>
      <Text
        className={`text-sm ${bold ? "font-bold" : "font-semibold"} text-text-primary dark:text-text-dark-primary`}
        style={color ? { color } : undefined}
      >
        {value}
      </Text>
    </View>
  );
}
