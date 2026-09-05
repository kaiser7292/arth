import { useState, useMemo } from "react";
import { Text } from "@/components/ui";
import { View, Pressable, TextInput, ScrollView, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { useTheme } from "@/hooks/use-theme";

interface FilterOption {
  id: string;
  label: string;
  color?: string;
}

interface FilterDropdownProps {
  label: string;
  options: FilterOption[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  searchable?: boolean;
  singleSelect?: boolean;
  autoOpen?: boolean;
  onDismiss?: () => void;
}

export function FilterDropdown({
  label,
  options,
  selectedIds,
  onSelectionChange,
  searchable = false,
  singleSelect = false,
  autoOpen = false,
  onDismiss,
}: FilterDropdownProps) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [open, setOpen] = useState(autoOpen);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  const selectedCount = selectedIds.length;
  const summaryText = selectedCount === 0
    ? "All"
    : selectedCount === 1
      ? options.find((o) => o.id === selectedIds[0])?.label ?? "1 selected"
      : `${selectedCount} selected`;

  const toggle = (id: string) => {
    if (singleSelect) {
      onSelectionChange(selectedIds.includes(id) ? [] : [id]);
      setOpen(false);
    } else {
      onSelectionChange(
        selectedIds.includes(id)
          ? selectedIds.filter((x) => x !== id)
          : [...selectedIds, id],
      );
    }
  };

  return (
    <>
      <Pressable
        onPress={() => { setOpen(true); setSearch(""); }}
        className="flex-row items-center justify-between py-3 px-3 rounded-lg bg-card mb-1.5"
      >
        <Text className="text-sm font-medium text-foreground">
          {label}
        </Text>
        <View className="flex-row items-center">
          <Text
            className="text-sm mr-1.5"
            style={{ color: selectedCount > 0 ? theme.primary : colors.textSecondary }}
            numberOfLines={1}
          >
            {summaryText}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
        </View>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent>
        <View className="flex-1 justify-end">
          <Pressable className="flex-1" style={{ backgroundColor: "rgba(0,0,0,0.4)" }} onPress={() => { setOpen(false); onDismiss?.(); }} />
          <View
            className="rounded-t-2xl max-h-[70%]"
            style={{ backgroundColor: colors.background }}
          >
            {/* Header */}
            <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
              <Text className="text-sm font-semibold text-foreground">
                {label}
              </Text>
              <View className="flex-row items-center">
                {selectedCount > 0 && (
                  <Pressable onPress={() => onSelectionChange([])} className="mr-4">
                    <Text className="text-xs" style={{ color: theme.primary }}>Clear</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => { setOpen(false); onDismiss?.(); }}>
                  <Text className="text-xs font-medium" style={{ color: theme.primary }}>Done</Text>
                </Pressable>
              </View>
            </View>

            {/* Search */}
            {searchable && options.length > 6 && (
              <View className="mx-4 mb-2 flex-row items-center rounded-lg bg-card px-3 py-2">
                <Ionicons name="search" size={14} color={colors.textSecondary} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder={`Search ${label.toLowerCase()}...`}
                  placeholderTextColor={colors.tabIconDefault}
                  className="flex-1 ml-2 text-xs text-foreground"
                  autoFocus={false}
                />
              </View>
            )}

            {/* Options list */}
            <ScrollView className="px-4 pb-6" showsVerticalScrollIndicator={false}>
              {filtered.map((option) => {
                const isSelected = selectedIds.includes(option.id);
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => toggle(option.id)}
                    className="flex-row items-center py-3 border-b border-border"
                  >
                    <View
                      className="w-5 h-5 rounded items-center justify-center mr-3"
                      style={{
                        backgroundColor: isSelected ? theme.primary : "transparent",
                        borderWidth: isSelected ? 0 : 1.5,
                        borderColor: isSelected ? theme.primary : colors.border,
                      }}
                    >
                      {isSelected && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
                    </View>
                    {option.color && (
                      <View className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: option.color }} />
                    )}
                    <Text className="text-sm text-foreground flex-1">
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
              {filtered.length === 0 && (
                <Text className="text-xs text-faint-foreground text-center py-4">No matches</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
