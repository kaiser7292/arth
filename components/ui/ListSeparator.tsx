import { View } from "react-native";
import { COMPONENTS } from "@/constants/design-tokens";

interface ListSeparatorProps {
  /** Left inset, for lists whose rows lead with an icon or avatar the rule should clear. */
  inset?: number;
}

/**
 * The hairline between rows of a list.
 *
 * Rows were drawing this themselves with `border-b border-border`, which puts a rule under the
 * LAST row too - a stray line hanging below the final item, most obvious inside a Card. A list
 * separator goes between items and not after the last one, which is what the divider is for.
 *
 * Passed as `ItemSeparatorComponent`, so it also costs one view fewer per row than a border on
 * every row did.
 */
export function ListSeparator({ inset = 0 }: ListSeparatorProps) {
  return <View className={COMPONENTS.separator} style={inset ? { marginLeft: inset } : undefined} />;
}
