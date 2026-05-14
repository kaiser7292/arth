import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface StatusPillProps {
  label: string;
  color: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

export function StatusPill({ label, color, icon }: StatusPillProps) {
  return (
    <View
      className="flex-row items-center px-2.5 py-1 rounded-full self-start"
      style={{ backgroundColor: `${color}12` }}
      accessibilityLabel={`Status: ${label}`}
      accessibilityRole="text"
    >
      {icon && (
        <Ionicons name={icon} size={12} color={color} style={{ marginRight: 4 }} />
      )}
      <Text className="text-xs font-medium" style={{ color }}>
        {label}
      </Text>
    </View>
  );
}
