import { useState, useMemo } from "react";
import { View, Text, Pressable, ScrollView, TextInput, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface FilterSection {
  key: string;
  label: string;
  type: "multi" | "single";
  options: { id: string; label: string; color?: string }[];
  selectedIds: string[];
  searchable?: boolean;
}

interface FullScreenFilterProps {
  visible: boolean;
  sections: FilterSection[];
  onApply: (selections: Record<string, string[]>) => void;
  onReset: () => void;
  onClose: () => void;
}

export function FullScreenFilter({
  visible,
  sections,
  onApply,
  onReset,
  onClose,
}: FullScreenFilterProps) {
  const { colors, accent, colorScheme } = useColorScheme();
  const insets = useSafeAreaInsets();

  const [activeSection, setActiveSection] = useState(sections[0]?.key ?? "");
  const [localSelections, setLocalSelections] = useState<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {};
    for (const s of sections) map[s.key] = [...s.selectedIds];
    return map;
  });
  const [searchQuery, setSearchQuery] = useState("");

  // Reset local state when modal opens
  const resetLocal = () => {
    const map: Record<string, string[]> = {};
    for (const s of sections) map[s.key] = [...s.selectedIds];
    setLocalSelections(map);
    setActiveSection(sections[0]?.key ?? "");
    setSearchQuery("");
  };

  const currentSection = sections.find((s) => s.key === activeSection);
  const currentSelected = localSelections[activeSection] ?? [];

  const filteredOptions = useMemo(() => {
    if (!currentSection) return [];
    if (!searchQuery.trim()) return currentSection.options;
    const q = searchQuery.toLowerCase();
    return currentSection.options.filter((o) => o.label.toLowerCase().includes(q));
  }, [currentSection, searchQuery]);

  const toggle = (id: string) => {
    setLocalSelections((prev) => {
      const current = prev[activeSection] ?? [];
      if (currentSection?.type === "single") {
        return { ...prev, [activeSection]: current.includes(id) ? [] : [id] };
      }
      return {
        ...prev,
        [activeSection]: current.includes(id)
          ? current.filter((x) => x !== id)
          : [...current, id],
      };
    });
  };

  const totalSelected = Object.values(localSelections).reduce((sum, ids) => sum + ids.length, 0);

  const handleApply = () => {
    onApply(localSelections);
    onClose();
  };

  const handleReset = () => {
    const empty: Record<string, string[]> = {};
    for (const s of sections) empty[s.key] = [];
    setLocalSelections(empty);
    onReset();
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onShow={resetLocal}>
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
          <Pressable onPress={onClose} className="flex-row items-center">
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
          <Text className="text-base font-semibold text-foreground">
            Filters
          </Text>
          <Pressable onPress={handleReset}>
            <Text className="text-sm" style={{ color: accent[500] }}>Reset</Text>
          </Pressable>
        </View>

        {/* Body: sidebar + options */}
        <View className="flex-1 flex-row">
          {/* Left sidebar — filter categories (30% width) */}
          <View style={{ flex: 0.3 }} className="border-r border-border">
          <ScrollView
            showsVerticalScrollIndicator={false}
          >
            {sections.map((section) => {
              const isActive = activeSection === section.key;
              const count = (localSelections[section.key] ?? []).length;
              return (
                <Pressable
                  key={section.key}
                  onPress={() => { setActiveSection(section.key); setSearchQuery(""); }}
                  className={`px-2 py-3.5 border-b border-border ${isActive ? "border-l-2" : ""}`}
                  style={isActive ? { borderLeftColor: accent[500], backgroundColor: colors.background } : { backgroundColor: colorScheme === "dark" ? "#1A1A1A" : "#F5F5F5" }}
                >
                  <Text
                    className={`text-[10px] ${isActive ? "font-semibold" : "text-muted-foreground"}`}
                    style={isActive ? { color: accent[500] } : undefined}
                    numberOfLines={2}
                  >
                    {section.label}
                  </Text>
                  {count > 0 && (
                    <View
                      className="absolute top-1.5 right-1 w-4 h-4 rounded-full items-center justify-center"
                      style={{ backgroundColor: accent[500] }}
                    >
                      <Text className="text-[9px] font-bold text-white">{count}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
          </View>

          {/* Right side — options for active section (70% width) */}
          <View style={{ flex: 0.7 }}>
            {/* Search (if applicable) */}
            {currentSection?.searchable && currentSection.options.length > 6 && (
              <View className="mx-3 mt-3 mb-2 flex-row items-center rounded-lg bg-card px-3 py-2">
                <Ionicons name="search" size={14} color={colors.textSecondary} />
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder={`Search...`}
                  placeholderTextColor={colors.tabIconDefault}
                  className="flex-1 ml-2 text-sm text-foreground"
                />
                {searchQuery !== "" && (
                  <Pressable onPress={() => setSearchQuery("")}>
                    <Ionicons name="close-circle" size={14} color={colors.textSecondary} />
                  </Pressable>
                )}
              </View>
            )}

            {/* Options list */}
            <ScrollView className="flex-1 px-3" showsVerticalScrollIndicator={false}>
              {filteredOptions.map((option) => {
                const isSelected = currentSelected.includes(option.id);
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => toggle(option.id)}
                    className="flex-row items-center py-3 border-b border-border"
                  >
                    <View
                      className="w-5 h-5 rounded items-center justify-center mr-3"
                      style={{
                        backgroundColor: isSelected ? accent[500] : "transparent",
                        borderWidth: isSelected ? 0 : 1.5,
                        borderColor: isSelected ? accent[500] : colors.border,
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
              {filteredOptions.length === 0 && (
                <Text className="text-xs text-faint-foreground text-center py-8">No options match</Text>
              )}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>

        {/* Footer — Apply button */}
        <View
          className="flex-row items-center justify-between px-4 py-3 border-t border-border"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <Text className="text-xs text-muted-foreground">
            {totalSelected > 0 ? `${totalSelected} filter${totalSelected > 1 ? "s" : ""} selected` : "No filters applied"}
          </Text>
          <Pressable
            onPress={handleApply}
            className="px-5 py-2.5 rounded-lg"
            style={{ backgroundColor: accent[500] }}
          >
            <Text className="text-sm font-semibold text-white">Apply</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
