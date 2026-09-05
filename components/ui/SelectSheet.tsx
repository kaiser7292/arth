import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { Sheet } from "./Sheet";
import { Text } from "./Text";
import { useTheme } from "@/hooks/use-theme";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Optional second line, for choices that need a word of explanation. */
  description?: string;
}

interface SelectSheetProps<T extends string> {
  visible: boolean;
  title: string;
  options: SelectOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  onClose: () => void;
  /**
   * Keep the sheet open after a choice. Off by default: picking one of a set of
   * mutually exclusive options is the end of the interaction.
   */
  keepOpenOnSelect?: boolean;
}

/**
 * Single-choice picker in a bottom sheet.
 *
 * This is the `Select` the design plan asked for, and it arrived by deletion rather than
 * invention: three screens - budget transactions, a budget category drill-down and the insights
 * filtered list - each carried a byte-identical "Sort by" sheet AND a byte-identical options
 * array. Extracting the shape they already shared is what makes it a primitive; building one
 * speculatively is how the codebase ended up with ConfirmSheet and TimePickerModal, both of which
 * had zero call sites and have now been deleted.
 *
 * Options are data, so anything single-choice can use it, not just sorting.
 */
export function SelectSheet<T extends string>({
  visible,
  title,
  options,
  value,
  onChange,
  onClose,
  keepOpenOnSelect = false,
}: SelectSheetProps<T>) {
  const theme = useTheme();

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="flex-row items-center justify-between px-5 pb-3">
        <Text className="text-heading font-bold text-foreground">{title}</Text>
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
          <Ionicons name="close" size={20} color={theme.mutedForeground} />
        </Pressable>
      </View>

      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => {
              onChange(opt.value);
              if (!keepOpenOnSelect) onClose();
            }}
            className="flex-row items-center px-5 py-3.5"
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
          >
            {opt.icon ? (
              <Ionicons
                name={opt.icon}
                size={18}
                color={active ? theme.primary : theme.mutedForeground}
              />
            ) : null}
            <View className={opt.icon ? "flex-1 ml-3" : "flex-1"}>
              <Text
                className="text-body"
                style={{
                  color: active ? theme.primary : theme.foreground,
                  fontWeight: active ? "600" : "400",
                }}
              >
                {opt.label}
              </Text>
              {opt.description ? (
                <Text className="text-meta text-muted-foreground mt-0.5">{opt.description}</Text>
              ) : null}
            </View>
            {active && <Ionicons name="checkmark" size={18} color={theme.primary} />}
          </Pressable>
        );
      })}
    </Sheet>
  );
}
