import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import type Ionicons from "@expo/vector-icons/Ionicons";
import { CheckRow, DateInput, RadioRow, SearchField, SectionTitle, Sheet, Text } from "@/components/ui";
import {
  FilterRailItem,
  FilterSheetFooter,
  FilterSheetHeader,
  applyLabelFor,
  iconForFilter,
} from "@/components/ui/FilterSheetParts";
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
  /** Rail icon. Guessed from the key and label when left out. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Under the section title. Defaults to "Select any" / "Pick one" / "Choose a range". */
  hint?: string;
  /** What counts as "nothing changed" (sort and group): not counted on the rail or in Apply. */
  defaultIds?: string[];
}

const countOn = (section: FilterSection, selected: string[]) =>
  section.type === "custom"
    ? 0
    : section.type === "dates"
      ? (selected[0] && selected[1] ? 1 : 0)
      : section.defaultIds && (selected.length === 0 || selected.join("|") === section.defaultIds.join("|"))
        ? 0
        : selected.length;

type Choice = { value: string; defaultValue: string; options: { value: string; label: string }[]; onChange: (v: string) => void };

export const SORT_KEY = "__sort";
export const GROUP_KEY = "__group";

/**
 * Sort and Group as the first sections of a filter sheet, so every list sets all three in one
 * place (the Transactions tab's layout). Pair with applySortGroup in onApply.
 */
export function sortGroupSections(sort?: Choice, group?: Choice): FilterSection[] {
  const out: FilterSection[] = [];
  if (sort && sort.options.length > 1) {
    out.push({ key: SORT_KEY, label: "Sort", icon: "swap-vertical-outline", type: "single", hint: "Pick one", options: sort.options.map((o) => ({ id: o.value, label: o.label })), selectedIds: [sort.value], defaultIds: [sort.defaultValue] });
  }
  if (group && group.options.length > 1) {
    out.push({ key: GROUP_KEY, label: "Group", icon: "layers-outline", type: "single", hint: "How the list is arranged", options: group.options.map((o) => ({ id: o.value, label: o.label })), selectedIds: [group.value], defaultIds: [group.defaultValue] });
  }
  return out;
}

/** Applies the Sort and Group sections; nothing picked means back to the default. */
export function applySortGroup(selections: Record<string, string[]>, sort?: Choice, group?: Choice): void {
  if (sort && selections[SORT_KEY]) sort.onChange(selections[SORT_KEY][0] ?? sort.defaultValue);
  if (group && selections[GROUP_KEY]) group.onChange(selections[GROUP_KEY][0] ?? group.defaultValue);
}

const HINT: Record<FilterSection["type"], string> = {
  multi: "Select any",
  single: "Pick one",
  dates: "Choose a range",
  custom: "",
};

/** Long lists show this many until a search narrows them. */
const LIST_CAP = 60;

interface FullScreenFilterProps {
  visible: boolean;
  sections: FilterSection[];
  onApply: (selections: Record<string, string[]>) => void;
  onReset: () => void;
  onClose: () => void;
  /** How many rows the selections would show, for "Show 24 items". Null when it can't tell. */
  countFor?: (selections: Record<string, string[]>) => number | null;
  /** What the rows are called: { one: "merchant", many: "merchants" }. */
  noun?: { one: string; many: string };
}

/**
 * The filter sheet for every list that isn't the Transactions tab: the same frame as
 * TransactionFilterSheet (icon rail, section title with its icon, Cancel / Apply) showing one
 * section at a time. Name kept for its callers; it is now a bottom sheet, not a full-screen modal.
 */
export function FullScreenFilter({ visible, sections, onApply, onReset, onClose, countFor, noun }: FullScreenFilterProps) {
  const theme = useTheme();
  const { height: winH } = useWindowDimensions();

  // Opens on a filter, not on a section like saved views.
  // Opens on the first real filter: not sort or group, not a section like saved views.
  const firstSection =
    (sections.find((s) => s.type !== "custom" && s.key !== SORT_KEY && s.key !== GROUP_KEY) ??
      sections.find((s) => s.type !== "custom") ??
      sections[0])?.key ?? "";
  const [activeSection, setActiveSection] = useState(firstSection);
  const [localSelections, setLocalSelections] = useState<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {};
    for (const s of sections) map[s.key] = [...s.selectedIds];
    return map;
  });
  const [searchQuery, setSearchQuery] = useState("");

  // Each opening starts from what's applied.
  useEffect(() => {
    if (!visible) return;
    const map: Record<string, string[]> = {};
    for (const s of sections) map[s.key] = [...s.selectedIds];
    setLocalSelections(map);
    setActiveSection(firstSection);
    setSearchQuery("");
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const currentSection = sections.find((s) => s.key === activeSection);
  const currentSelected = localSelections[activeSection] ?? [];

  const filteredOptions = useMemo(() => {
    if (!currentSection) return [];
    const q = searchQuery.trim().toLowerCase();
    const matches = q ? currentSection.options.filter((o) => o.label.toLowerCase().includes(q)) : currentSection.options;
    // Picked options stay visible even when the cap would hide them.
    return [...matches.filter((o) => currentSelected.includes(o.id)), ...matches.filter((o) => !currentSelected.includes(o.id))];
  }, [currentSection, searchQuery, currentSelected]);
  const shownOptions = filteredOptions.slice(0, Math.max(LIST_CAP, currentSelected.length));

  const toggle = (id: string) => {
    setLocalSelections((prev) => {
      const current = prev[activeSection] ?? [];
      if (currentSection?.type === "single") {
        return { ...prev, [activeSection]: current.includes(id) ? [] : [id] };
      }
      return {
        ...prev,
        [activeSection]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
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

  const count = countFor ? countFor(localSelections) : null;
  const Row = currentSection?.type === "single" ? RadioRow : CheckRow;
  const currentCount = currentSection ? countOn(currentSection, currentSelected) : 0;
  const hint = currentSection ? currentSection.hint ?? HINT[currentSection.type] : "";

  if (!visible) return null;

  return (
    <Sheet visible={visible} onClose={onClose} maxHeightPct={88} draggable>
      <View style={{ height: Math.round(winH * 0.8), flexShrink: 1 }}>
        <FilterSheetHeader onClear={handleReset} clearDisabled={totalSelected === 0} onClose={onClose} />

        <View className="flex-1 flex-row" style={{ minHeight: 0 }}>
          <ScrollView
            style={{ width: "22%", flexGrow: 0, backgroundColor: theme.alpha("foreground", 0.035) }}
            contentContainerStyle={{ paddingVertical: 6 }}
            showsVerticalScrollIndicator={false}
            accessibilityRole="tablist"
          >
            {sections.map((section) => (
              <FilterRailItem
                key={section.key}
                label={section.label}
                icon={section.icon ?? iconForFilter(section.key, section.label)}
                count={countOn(section, localSelections[section.key] ?? [])}
                on={activeSection === section.key}
                onPress={() => {
                  setActiveSection(section.key);
                  setSearchQuery("");
                }}
              />
            ))}
          </ScrollView>

          <View style={{ flex: 1 }}>
            {currentSection && (
              <SectionTitle
                className="px-4 pt-4 pb-2"
                icon={currentSection.icon ?? iconForFilter(currentSection.key, currentSection.label)}
                title={currentSection.label}
                hint={hint ? (currentCount > 0 ? `${hint} · ${currentCount} on` : hint) : undefined}
                active={currentCount > 0}
              />
            )}
            {currentSection?.type === "custom" && (
              <ScrollView className="flex-1 px-4 pt-1" showsVerticalScrollIndicator={false}>
                {currentSection.render?.()}
              </ScrollView>
            )}
            {currentSection?.type === "dates" && (
              <View className="px-4 pt-1">
                <DateInput label="From" value={currentSelected[0] ?? ""} onChange={(v) => setDate(0, v)} />
                <DateInput label="To" value={currentSelected[1] ?? ""} onChange={(v) => setDate(1, v)} />
              </View>
            )}
            {currentSection?.type !== "custom" && currentSection?.type !== "dates" && (
              <>
                {currentSection?.searchable && currentSection.options.length > 6 && (
                  <SearchField
                    className="mx-4 mb-2"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder={`Search ${currentSection.label.toLowerCase()}`}
                    accessibilityLabel={`Search ${currentSection.label}`}
                  />
                )}
                <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  {shownOptions.map((option) => (
                    <Row
                      key={option.id}
                      label={option.label}
                      color={option.color}
                      on={currentSelected.includes(option.id)}
                      onPress={() => toggle(option.id)}
                    />
                  ))}
                  {filteredOptions.length > shownOptions.length && (
                    <Text className="text-meta text-muted-foreground mt-2">
                      {filteredOptions.length - shownOptions.length} more. Search to find them.
                    </Text>
                  )}
                  {filteredOptions.length === 0 && (
                    <Text className="text-meta text-muted-foreground text-center py-8">Nothing matches</Text>
                  )}
                  <View style={{ height: 20 }} />
                </ScrollView>
              </>
            )}
          </View>
        </View>

        <FilterSheetFooter
          onCancel={onClose}
          onApply={handleApply}
          disabled={!!dateProblem}
          note={dateProblem}
          applyLabel={applyLabelFor(count, totalSelected, noun ?? { one: "item", many: "items" })}
        />
      </View>
    </Sheet>
  );
}
