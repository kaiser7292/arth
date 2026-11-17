import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ScrollView,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
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
 * The filter sheet for every list that isn't the Transactions tab, working exactly like
 * TransactionFilterSheet: split 20 / 80, an icon rail on the left and EVERY section in one
 * scrolling column on the right. Tapping a rail item scrolls to its section; scrolling moves the
 * rail's highlight with you. Name kept for its callers; it is a bottom sheet, not a full-screen modal.
 */
export function FullScreenFilter({ visible, sections, onApply, onReset, onClose, countFor, noun }: FullScreenFilterProps) {
  const theme = useTheme();
  const { height: winH } = useWindowDimensions();

  const firstKey = sections[0]?.key ?? "";
  const [active, setActive] = useState(firstKey);
  const [localSelections, setLocalSelections] = useState<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {};
    for (const s of sections) map[s.key] = [...s.selectedIds];
    return map;
  });
  // Each searchable section has its own search box.
  const [queries, setQueries] = useState<Record<string, string>>({});

  const paneRef = useRef<ScrollView>(null);
  const railRef = useRef<ScrollView>(null);
  const sectionY = useRef<Record<string, number>>({});
  const railY = useRef<Record<string, { y: number; h: number }>>({});
  const [paneH, setPaneH] = useState(0);
  const [railH, setRailH] = useState(0);
  // While a tap-to-jump scroll is running, the scroll handler leaves the highlight alone.
  const lockUntil = useRef(0);

  // Each opening starts from what's applied, at the top.
  useEffect(() => {
    if (!visible) return;
    const map: Record<string, string[]> = {};
    for (const s of sections) map[s.key] = [...s.selectedIds];
    setLocalSelections(map);
    setQueries({});
    setActive(firstKey);
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Keep the highlighted rail item in view when the column scrolls far.
  useEffect(() => {
    const r = railY.current[active];
    if (!r || railH === 0) return;
    railRef.current?.scrollTo({ y: Math.max(0, r.y - railH / 2 + r.h / 2), animated: true });
  }, [active, railH]);

  const toggle = (section: FilterSection, id: string) => {
    setLocalSelections((prev) => {
      const current = prev[section.key] ?? [];
      if (section.type === "single") return { ...prev, [section.key]: current.includes(id) ? [] : [id] };
      return { ...prev, [section.key]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id] };
    });
  };

  const setDate = (key: string, index: 0 | 1, value: string) =>
    setLocalSelections((prev) => {
      const [from = "", to = ""] = prev[key] ?? [];
      return { ...prev, [key]: index === 0 ? [value, to] : [from, value] };
    });

  const totalSelected = sections.reduce((sum, s) => sum + countOn(s, localSelections[s.key] ?? []), 0);

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

  const jump = (key: string) => {
    setActive(key);
    const y = sectionY.current[key];
    if (y == null) return;
    lockUntil.current = Date.now() + 650;
    paneRef.current?.scrollTo({ y, animated: true });
  };

  const onPaneScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (Date.now() < lockUntil.current || sections.length === 0) return;
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const top = contentOffset.y;
    let next = sections[0].key;
    // Bottom of the column: the last section, even if it can't reach the top.
    if (top + layoutMeasurement.height >= contentSize.height - 4) {
      next = sections[sections.length - 1].key;
    } else {
      for (const s of sections) {
        const y = sectionY.current[s.key];
        if (y != null && y <= top + 32) next = s.key;
      }
    }
    if (next !== active) setActive(next);
  };

  const count = countFor ? countFor(localSelections) : null;

  if (!visible) return null;

  return (
    <Sheet visible={visible} onClose={onClose} maxHeightPct={88} draggable>
      <View style={{ height: Math.round(winH * 0.8), flexShrink: 1 }}>
        <FilterSheetHeader onClear={handleReset} clearDisabled={totalSelected === 0} onClose={onClose} />

        {/* 20 / 80 */}
        <View className="flex-1 flex-row" style={{ minHeight: 0 }}>
          <ScrollView
            ref={railRef}
            onLayout={(e) => setRailH(e.nativeEvent.layout.height)}
            style={{ width: "20%", flexGrow: 0, backgroundColor: theme.alpha("foreground", 0.035) }}
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
                on={active === section.key}
                onPress={() => jump(section.key)}
                onLayout={(e) => {
                  railY.current[section.key] = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height };
                }}
              />
            ))}
          </ScrollView>

          <ScrollView
            ref={paneRef}
            style={{ flex: 1 }}
            onLayout={(e) => setPaneH(e.nativeEvent.layout.height)}
            onScroll={onPaneScroll}
            scrollEventThrottle={32}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            // Room after the last section so every section can scroll up to the top.
            contentContainerStyle={{ paddingBottom: Math.max(120, paneH * 0.55) }}
          >
            {sections.map((section, i) => {
              const selected = localSelections[section.key] ?? [];
              const n = countOn(section, selected);
              const hint = section.hint ?? HINT[section.type];
              const q = (queries[section.key] ?? "").trim().toLowerCase();
              const matches = q ? section.options.filter((o) => o.label.toLowerCase().includes(q)) : section.options;
              // Picked options stay visible even when the cap would hide them.
              const ordered = [...matches.filter((o) => selected.includes(o.id)), ...matches.filter((o) => !selected.includes(o.id))];
              const shown = ordered.slice(0, Math.max(LIST_CAP, selected.length));
              const Row = section.type === "single" ? RadioRow : CheckRow;
              return (
                <View
                  key={section.key}
                  onLayout={(e: LayoutChangeEvent) => {
                    sectionY.current[section.key] = e.nativeEvent.layout.y;
                  }}
                  className={`px-4 pt-4 pb-5 ${i === sections.length - 1 ? "" : "border-b border-border"}`}
                >
                  <SectionTitle
                    icon={section.icon ?? iconForFilter(section.key, section.label)}
                    title={section.label}
                    hint={hint ? (n > 0 ? `${hint} · ${n} on` : hint) : undefined}
                    active={n > 0}
                    className="mb-3"
                  />
                  {section.type === "custom" ? (
                    section.render?.()
                  ) : section.type === "dates" ? (
                    <View>
                      <DateInput label="From" value={selected[0] ?? ""} onChange={(v) => setDate(section.key, 0, v)} />
                      <DateInput label="To" value={selected[1] ?? ""} onChange={(v) => setDate(section.key, 1, v)} />
                    </View>
                  ) : (
                    <>
                      {section.searchable && section.options.length > 6 && (
                        <SearchField
                          className="mb-2"
                          value={queries[section.key] ?? ""}
                          onChangeText={(t) => setQueries((prev) => ({ ...prev, [section.key]: t }))}
                          placeholder={`Search ${section.label.toLowerCase()}`}
                          accessibilityLabel={`Search ${section.label}`}
                        />
                      )}
                      {shown.map((option) => (
                        <Row
                          key={option.id}
                          label={option.label}
                          color={option.color}
                          on={selected.includes(option.id)}
                          onPress={() => toggle(section, option.id)}
                        />
                      ))}
                      {ordered.length > shown.length && (
                        <Text className="text-meta text-muted-foreground mt-2">
                          {ordered.length - shown.length} more. Search to find them.
                        </Text>
                      )}
                      {ordered.length === 0 && (
                        <Text className="text-meta text-muted-foreground my-2">{q ? "Nothing matches" : "Nothing to pick yet"}</Text>
                      )}
                    </>
                  )}
                </View>
              );
            })}
          </ScrollView>
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
