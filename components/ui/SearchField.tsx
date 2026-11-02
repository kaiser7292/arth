import { Pressable, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/hooks/use-theme";

/** A small search box for lists in a screen: names and amounts (utils/amount-search.ts). */
export function SearchField({
  value,
  onChangeText,
  placeholder = "Search name or amount, like 450 or >5000",
  className = "",
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const theme = useTheme();
  return (
    <View className={`flex-row items-center rounded-lg px-3 bg-card border border-border ${className}`} style={{ minHeight: 40 }}>
      <Ionicons name="search-outline" size={16} color={theme.mutedForeground} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.mutedForeground}
        maxLength={60}
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Search this list"
        className="flex-1 ml-2 text-sm text-foreground py-2"
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChangeText("")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={16} color={theme.mutedForeground} />
        </Pressable>
      )}
    </View>
  );
}
