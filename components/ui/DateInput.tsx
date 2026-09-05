import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CalendarModal } from "./CalendarModal";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import { formatDate } from "@/utils/date";

interface DateInputProps {
  label?: string;
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  placeholder?: string;
  error?: string;
  /** Max selectable date. Defaults to today. Pass null to allow any future date. */
  maximumDate?: Date | null;
  /** Min selectable date. */
  minimumDate?: Date;
  containerClassName?: string;
}

/**
 * v17.5.10 — tap-to-open date picker only (no raw text entry).
 *
 * Previous versions exposed a TextInput with "YYYY-MM-DD" placeholder + a
 * "Use format YYYY-MM-DD" blur error. Users typed 04/2025 and saw cryptic
 * failures. The calendar picker is the canonical input; the text entry was
 * redundant and leaked an internal format into the UI.
 */
export function DateInput({
  label,
  value,
  onChange,
  placeholder = "Pick a date",
  error,
  maximumDate,
  minimumDate,
  containerClassName = "",
}: DateInputProps) {
  const { colors, accent, colorScheme } = useColorScheme();
  const [showPicker, setShowPicker] = useState(false);

  const maxDate = maximumDate === null ? null : (maximumDate ?? new Date());
  const displayValue = value ? formatDate(value) : "";

  return (
    <View className={containerClassName}>
      {label && (
        <Text className="text-xs font-semibold text-muted-foreground mb-1.5">
          {label}
        </Text>
      )}
      <Pressable
        onPress={() => setShowPicker(true)}
        accessibilityLabel={label || "Pick a date"}
        accessibilityRole="button"
        className={`flex-row items-center rounded-lg border px-3 py-3 bg-white dark:bg-surface-dark-alt ${
          error ? "border-danger" : "border-border"
        }`}
      >
        <Text
          className="flex-1 text-base"
          style={{ color: displayValue ? colors.text : colors.tabIconDefault }}
        >
          {displayValue || placeholder}
        </Text>
        <View
          className="w-8 h-8 rounded-lg items-center justify-center"
          style={{ backgroundColor: ac(accent, colorScheme, 50, 900) }}
        >
          <Ionicons name="calendar-outline" size={18} color={colors.blue} />
        </View>
      </Pressable>
      {error && <Text className="text-xs text-danger mt-1">{error}</Text>}

      <CalendarModal
        visible={showPicker}
        onClose={() => setShowPicker(false)}
        value={value}
        onChange={(d) => onChange(d)}
        maximumDate={maxDate}
        minimumDate={minimumDate}
      />
    </View>
  );
}
