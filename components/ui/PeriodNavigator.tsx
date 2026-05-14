import { useState, useCallback, useMemo } from "react";
import { View, Text, Pressable, Modal, FlatList } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import { getCurrentFY, getFYLabel } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

interface MonthModeProps {
  mode: "month";
  /** Current value in "YYYY-MM" format */
  value: string;
  /** Called with new "YYYY-MM" value */
  onChange: (value: string) => void;
  /** Earliest selectable month "YYYY-MM" */
  minMonth?: string;
  /** Latest selectable month "YYYY-MM" */
  maxMonth?: string;
}

interface FYModeProps {
  mode: "fy";
  /** Current FY year number (e.g., 2025) */
  value: number;
  /** Called with new FY year number */
  onChange: (value: number) => void;
}

type PeriodNavigatorProps = (MonthModeProps | FYModeProps) & {
  /** Additional content to the right of the forward chevron (e.g., widget toggle) */
  trailing?: React.ReactNode;
  /** Style variant: "bar" renders with border-b, "inline" renders plain */
  variant?: "bar" | "inline";
};

// ═══════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════

const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// ═══════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════

export function PeriodNavigator(props: PeriodNavigatorProps) {
  const { colors, accent, colorScheme } = useColorScheme();
  const [showPicker, setShowPicker] = useState(false);

  const isMonth = props.mode === "month";

  // ─── Derive display label ───

  const label = useMemo(() => {
    if (isMonth) {
      const [year, m] = (props as MonthModeProps).value.split("-").map(Number);
      return `${MONTH_NAMES_SHORT[m - 1]} ${year}`;
    }
    const fyStartMonth = getFYStartMonth();
    return getFYLabel((props as FYModeProps).value, fyStartMonth);
  }, [isMonth, props.value]);

  // ─── Month bounds ───

  const mp = isMonth ? (props as MonthModeProps) : null;
  const canGoBack = useMemo(() => {
    if (!isMonth || !mp?.minMonth) return true;
    return mp.value > mp.minMonth;
  }, [isMonth, mp?.value, mp?.minMonth]);
  const canGoForward = useMemo(() => {
    if (!isMonth || !mp?.maxMonth) return true;
    return mp.value < mp.maxMonth;
  }, [isMonth, mp?.value, mp?.maxMonth]);

  // ─── Chevron shift ───

  const handleShift = useCallback(
    (direction: -1 | 1) => {
      if (isMonth) {
        if (direction === -1 && !canGoBack) return;
        if (direction === 1 && !canGoForward) return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (isMonth) {
        const mProps = props as MonthModeProps;
        const [year, m] = mProps.value.split("-").map(Number);
        const date = new Date(year, m - 1 + direction, 1);
        mProps.onChange(
          `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
        );
      } else {
        const fp = props as FYModeProps;
        fp.onChange(fp.value + direction);
      }
    },
    [isMonth, props.value, props.onChange, canGoBack, canGoForward],
  );

  const isBar = props.variant !== "inline";

  return (
    <>
      <View
        className={`flex-row items-center justify-between px-4 py-2 ${
          isBar ? "border-b border-border-light dark:border-border-dark" : ""
        }`}
      >
        <Pressable
          onPress={() => handleShift(-1)}
          disabled={isMonth && !canGoBack}
          accessibilityLabel={isMonth ? "Previous month" : "Previous year"}
          accessibilityRole="button"
          className="p-2"
          style={isMonth && !canGoBack ? { opacity: 0.25 } : undefined}
        >
          <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
        </Pressable>

        {/* Tappable label — opens picker */}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowPicker(true);
          }}
          accessibilityLabel={`Select ${isMonth ? "month" : "financial year"}`}
          accessibilityRole="button"
          className="flex-row items-center px-3 py-1.5 rounded-lg"
          style={{ backgroundColor: ac(accent, colorScheme, 50, 800) }}
        >
          <Text
            className="text-base font-semibold"
            style={{ color: ac(accent, colorScheme, 600, 200) }}
          >
            {label}
          </Text>
          <Ionicons
            name="caret-down"
            size={14}
            color={ac(accent, colorScheme, 400, 400)}
            style={{ marginLeft: 4 }}
          />
        </Pressable>

        <View className="flex-row items-center">
          <Pressable
            onPress={() => handleShift(1)}
            disabled={isMonth && !canGoForward}
            accessibilityLabel={isMonth ? "Next month" : "Next year"}
            accessibilityRole="button"
            className="p-2"
            style={isMonth && !canGoForward ? { opacity: 0.25 } : undefined}
          >
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          </Pressable>
          {props.trailing}
        </View>
      </View>

      {/* Picker Modal — bottom sheet */}
      <Modal
        visible={showPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPicker(false)}
      >
        <Pressable
          className="flex-1 bg-black/40 justify-end"
          onPress={() => setShowPicker(false)}
        >
          <Pressable
            className="bg-surface-light dark:bg-surface-dark-alt rounded-t-2xl max-h-[70%]"
            onPress={() => {}} // Prevent dismiss when tapping inside
          >
            {/* Handle bar */}
            <View className="items-center pt-3 pb-2">
              <View className="w-10 h-1 rounded-full bg-border-light dark:bg-border-dark" />
            </View>

            {isMonth ? (
              <MonthPickerContent
                value={(props as MonthModeProps).value}
                minMonth={(props as MonthModeProps).minMonth}
                maxMonth={(props as MonthModeProps).maxMonth}
                onChange={(v) => {
                  (props as MonthModeProps).onChange(v);
                  setShowPicker(false);
                }}
              />
            ) : (
              <FYPickerContent
                value={(props as FYModeProps).value}
                onChange={(v) => {
                  (props as FYModeProps).onChange(v);
                  setShowPicker(false);
                }}
              />
            )}

            {/* Cancel */}
            <Pressable
              onPress={() => setShowPicker(false)}
              className="mx-4 mb-6 py-3 rounded-xl bg-surface-light-alt dark:bg-surface-dark items-center"
            >
              <Text className="text-sm font-semibold text-text-secondary dark:text-text-dark-secondary">
                Cancel
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// ═══════════════════════════════════════════════
// Month Picker (Year header + 3×4 grid)
// ═══════════════════════════════════════════════

function MonthPickerContent({
  value,
  minMonth,
  maxMonth,
  onChange,
}: {
  value: string;
  minMonth?: string;
  maxMonth?: string;
  onChange: (v: string) => void;
}) {
  const { colors, accent, colorScheme } = useColorScheme();
  const [y, m] = value.split("-").map(Number);
  const [pickerYear, setPickerYear] = useState(y);

  const currentMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const minYear = minMonth ? parseInt(minMonth.split("-")[0], 10) : undefined;
  const maxYear = maxMonth ? parseInt(maxMonth.split("-")[0], 10) : undefined;

  return (
    <View className="px-4 pt-2 pb-3">
      <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary mb-3">
        Select Month
      </Text>
      {/* Year header with arrows */}
      <View className="flex-row items-center justify-between mb-4">
        <Pressable
          onPress={() => setPickerYear((v) => v - 1)}
          disabled={minYear !== undefined && pickerYear <= minYear}
          accessibilityLabel="Previous year"
          className="p-2"
          style={minYear !== undefined && pickerYear <= minYear ? { opacity: 0.25 } : undefined}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </Pressable>
        <Text className="text-lg font-bold text-text-primary dark:text-text-dark-primary">
          {pickerYear}
        </Text>
        <Pressable
          onPress={() => setPickerYear((v) => v + 1)}
          disabled={maxYear !== undefined && pickerYear >= maxYear}
          accessibilityLabel="Next year"
          className="p-2"
          style={maxYear !== undefined && pickerYear >= maxYear ? { opacity: 0.25 } : undefined}
        >
          <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* 3×4 month grid */}
      <View className="flex-row flex-wrap">
        {MONTH_NAMES_SHORT.map((name, idx) => {
          const monthNum = idx + 1;
          const monthVal = `${pickerYear}-${String(monthNum).padStart(2, "0")}`;
          const isSelected = pickerYear === y && monthNum === m;
          const isCurrent = monthVal === currentMonth;
          const isDisabled = (minMonth && monthVal < minMonth) || (maxMonth && monthVal > maxMonth);

          return (
            <Pressable
              key={name}
              onPress={() => !isDisabled && onChange(monthVal)}
              disabled={!!isDisabled}
              className="w-1/3 items-center py-3"
              style={isDisabled ? { opacity: 0.25 } : undefined}
            >
              <View
                className={`w-16 py-2 rounded-xl items-center ${
                  isSelected ? "" : isCurrent ? "border" : ""
                }`}
                style={
                  isSelected
                    ? { backgroundColor: accent[500] }
                    : isCurrent
                      ? { borderColor: accent[300] }
                      : undefined
                }
              >
                <Text
                  className={`text-sm ${
                    isSelected
                      ? "font-bold text-white"
                      : "font-medium text-text-primary dark:text-text-dark-primary"
                  }`}
                >
                  {name}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════
// FY Picker (scrollable list)
// ═══════════════════════════════════════════════

function FYPickerContent({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const { accent, colorScheme } = useColorScheme();
  const fyStartMonth = getFYStartMonth();
  const currentFY = getCurrentFY(fyStartMonth);

  // Show current FY + 2 forward + 6 back = 9 options
  const fyList = useMemo(() => {
    const list: number[] = [];
    for (let i = currentFY + 2; i >= currentFY - 6; i--) {
      list.push(i);
    }
    return list;
  }, [currentFY]);

  return (
    <View className="pt-2 pb-3">
      <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary px-4 mb-3">
        Select Financial Year
      </Text>
      <FlatList
        data={fyList}
        keyExtractor={(item) => String(item)}
        renderItem={({ item }) => {
          const isSelected = item === value;
          const isCurrent = item === currentFY;
          return (
            <Pressable
              onPress={() => onChange(item)}
              className={`mx-4 mb-2 py-3 px-4 rounded-xl flex-row items-center justify-between ${
                isSelected ? "" : "bg-surface-light-alt dark:bg-surface-dark-alt"
              }`}
              style={isSelected ? { backgroundColor: accent[500] } : undefined}
            >
              <Text
                className={`text-base ${
                  isSelected ? "font-bold text-white" : "font-medium text-text-primary dark:text-text-dark-primary"
                }`}
              >
                {getFYLabel(item, fyStartMonth)}
              </Text>
              {isCurrent && !isSelected && (
                <Text className="text-xs font-medium" style={{ color: accent[500] }}>
                  Current
                </Text>
              )}
              {isSelected && (
                <Ionicons name="checkmark" size={20} color="#FFFFFF" />
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}
