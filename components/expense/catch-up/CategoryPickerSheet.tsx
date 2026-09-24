import { Ionicons } from "@expo/vector-icons";
import { FlatList, Pressable, View } from "react-native";
import { Sheet, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import type { Category } from "@/services/category";

interface CategoryPickerSheetProps {
  visible: boolean;
  categories: Category[];
  selectedId: string | null;
  onSelect: (categoryId: string) => void;
  onClose: () => void;
}

export function CategoryPickerSheet({ visible, categories, selectedId, onSelect, onClose }: CategoryPickerSheetProps) {
  const theme = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} maxHeightPct={70}>
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 pb-2">
        Choose category
      </Text>
      <FlatList
        data={categories}
        keyExtractor={(c) => c.id}
        initialNumToRender={16}
        contentContainerStyle={{ paddingBottom: 12 }}
        renderItem={({ item: cat }) => {
          const selected = cat.id === selectedId;
          return (
            <Pressable
              onPress={() => onSelect(cat.id)}
              className="flex-row items-center px-4 py-3 border-b border-border"
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <View
                className="w-8 h-8 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: cat.color + "14" }}
              >
                <Ionicons name={cat.icon as keyof typeof Ionicons.glyphMap} size={16} color={cat.color} />
              </View>
              <Text className="text-sm font-medium text-foreground flex-1">{cat.name}</Text>
              {selected && <Ionicons name="checkmark" size={18} color={theme.primary} />}
            </Pressable>
          );
        }}
      />
    </Sheet>
  );
}
