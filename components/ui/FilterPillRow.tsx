import { ScrollView, View } from "react-native";
import type Ionicons from "@expo/vector-icons/Ionicons";
import { FilterChip } from "./FilterChip";

export interface FilterPill {
  key: string;
  label: string;
  active: boolean;
  onPress: () => void;
  /** Opens a list of choices (a drawer) rather than switching on. */
  caret?: boolean;
  /** Clears just this one; shown as an × while it's on. */
  onClear?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  count?: number;
  /** Stays where it is instead of moving to the front when on, like an "all filters" pill. */
  pinned?: boolean;
}

/**
 * One line of filter pills that scrolls sideways. Pills that are on move to the front (after any
 * pinned ones), so what's narrowing the list can be read without scrolling.
 */
export function FilterPillRow({ pills, inset = true }: { pills: FilterPill[]; inset?: boolean }) {
  const pinned = pills.filter((p) => p.pinned);
  const rest = pills.filter((p) => !p.pinned);
  const ordered = [...pinned, ...rest.filter((p) => p.active), ...rest.filter((p) => !p.active)];
  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: inset ? 16 : 0, paddingVertical: 6 }}
      >
        {ordered.map((p) => (
          <FilterChip
            key={p.key}
            label={p.label}
            active={p.active}
            onPress={p.onPress}
            caret={p.caret}
            onClear={p.onClear}
            icon={p.icon}
            count={p.count}
          />
        ))}
      </ScrollView>
    </View>
  );
}
