import type { ReactNode } from "react";
import { Pressable, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/hooks/use-theme";
import { COMPONENTS } from "@/constants/design-tokens";

/** The hint every transaction search shows: names and amounts (utils/amount-search.ts). */
export const AMOUNT_SEARCH_PLACEHOLDER = "Search name or amount, like 450 or >5000";

/**
 * The search box for lists and sheets: names and amounts (utils/amount-search.ts).
 * `size="lg"` is the 44px screen-level box; the default 40px one sits inside sheets and sections.
 */
export function SearchField({
  value,
  onChangeText,
  placeholder = AMOUNT_SEARCH_PLACEHOLDER,
  className = "",
  size = "md",
  right,
  autoFocus,
  onSubmitEditing,
  accessibilityLabel = "Search this list",
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  className?: string;
  size?: "md" | "lg";
  /** Extra controls inside the box on the right, e.g. a microphone. */
  right?: ReactNode;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const S = COMPONENTS.search;
  const lg = size === "lg";
  return (
    <View className={`${S.base} ${className}`} style={{ minHeight: lg ? S.minHeightLg : S.minHeight }}>
      <Ionicons name="search-outline" size={lg ? 18 : 16} color={theme.mutedForeground} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.mutedForeground}
        maxLength={60}
        autoCorrect={false}
        autoFocus={autoFocus}
        returnKeyType="search"
        onSubmitEditing={onSubmitEditing}
        accessibilityLabel={accessibilityLabel}
        className={`${S.input} ${lg ? S.inputSizeLg : S.inputSize}`}
        style={{ paddingVertical: 8 }}
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChangeText("")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={lg ? 18 : 16} color={theme.mutedForeground} />
        </Pressable>
      )}
      {right}
    </View>
  );
}
