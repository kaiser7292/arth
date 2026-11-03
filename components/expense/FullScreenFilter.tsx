import { useState, useMemo, type ReactNode } from "react";
import { DateInput, Text } from "@/components/ui";
import { View, Pressable, ScrollView, TextInput, Modal } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/use-theme";

interface FilterSection {
  key: string;
  label: string;
  /** "dates" is a from and a to, kept in selectedIds. "custom" draws itself with render. */
  type: "multi" | "single" | "dates" | "custom";
  options: { id: string; label: string; color?: string }[];
  selectedIds: string[];
  searchable?: boolean;
  render?: () => ReactNode;
}

const countOn = (section: FilterSection, selected: string[]) =>
  section.type === "custom" ? 0 : section.type === "dates" ? (selected[0] && selected[1] ? 1 : 0) : selected.length;

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
  const { colors, colorScheme } = useColorScheme();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  // Opens on a filter, not on a section like saved views.
  const firstSection = (sections.find((s) => s.type !== "custom") ?? sections[0])?.key ?? "";
  const [activeSection, setActiveSection] = useState(firstSection);
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
    setActiveSection(firstSection);
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

  const totalSelected = sections.reduce((sum, s) => sum + countOn(s, localSelections[s.key] ?? []), 0);

  const setDate = (index: 0 | 1, value: string) =>
    setLocalSelections((prev) => {
      const [from = "", to = ""] = prev[activeSection] ?? [];
      return { ...prev, [activeSection]: index === 0 ? [value, to] : [from, value] };
    });

  // One date on its own, or the wrong way round, can't be applied.
  const dateProblem = sections
    .filter((s) => s.type === "dates")
    .map((s) => {
      const [from = "", to = ""] = localSelections[s.key] ?? [];
      if (!from && !to) return null;
      if (!from || !to) return "Choose both dates";
      return from > to ? "'From' must be before 'To'" : null;
    })
    .find(Boolean);

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
            <Text className="text-sm" style={{ color: theme.primary }}>Reset</Text>
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
              const count = countOn(section, localSelections[section.key] ?? []);
              return (
                <Pressable
                  key={section.key}
                  onPress={() => { setActiveSection(section.key); setSearchQuery(""); }}
                  className={`px-2 py-3.5 border-b border-border ${isActive ? "border-l-2" : ""}`}
                  style={isActive ? { borderLeftColor: theme.primary, backgroundColor: colors.background } : { backgroundColor: colorScheme === "dark" ? "#1A1A1A" : "#F5F5F5" }}
                >
                  <Text
                    className={`text-label ${isActive ? "font-semibold" : "text-muted-foreground"}`}
                    style={isActive ? { color: theme.primary } : undefined}
                    numberOfLines={2}
                  >
                    {section.label}
                  </Text>
                  {count > 0 && (
                    <View
                      className="absolute top-1.5 right-1 w-4 h-4 rounded-full items-center justify-center"
                      style={{ backgroundColor: theme.primary }}
                    >
                      <Text className="text-label font-bold text-primary-foreground">{count}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
          </View>

          {/* Right side — options for active section (70% width) */}
          <View style={{ flex: 0.7 }}>
            {currentSection?.type === "custom" && (
              <ScrollView className="flex-1 px-3 pt-3" showsVerticalScrollIndicator={false}>
                {currentSection.render?.()}
              </ScrollView>
            )}
            {currentSection?.type === "dates" && (
              <View className="px-3 pt-3">
                <DateInput label="From" value={currentSelected[0] ?? ""} onChange={(v) => setDate(0, v)} />
                <DateInput label="To" value={currentSelected[1] ?? ""} onChange={(v) => setDate(1, v)} />
                {dateProblem ? <Text className="text-xs text-danger mt-1">{dateProblem}</Text> : null}
              </View>
            )}
            {currentSection?.type !== "custom" && currentSection?.type !== "dates" && (
            <>
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
              {filteredOptions.length === 0 && (
                <Text className="text-xs text-faint-foreground text-center py-8">No options match</Text>
              )}
              <View style={{ height: 20 }} />
            </ScrollView>
            </>
            )}
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
            disabled={!!dateProblem}
            className="px-5 py-2.5 rounded-lg"
            style={{ backgroundColor: dateProblem ? theme.alpha("foreground", 0.25) : theme.primary }}
          >
            <Text className="text-sm font-semibold text-primary-foreground">Apply</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
