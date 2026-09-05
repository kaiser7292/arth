/**
 * CalendarModal — Custom calendar picker matching the app design system.
 *
 * Bottom-sheet modal with three modes:
 *   - day   — 7×6 day grid with ◀ / ▶ month navigation.
 *             Tap month label → month mode, tap year label → year mode.
 *   - month — 3×4 grid of Jan–Dec. Tap a month → jumps to it in day mode.
 *   - year  — 3×4 grid of years (12 at a time, ◀◀ / ▶▶ pages by 12).
 *             Tap a year → jumps to it in day mode.
 *
 * Uses accent palette, NativeWind classes, and haptic feedback.
 */

import { useState, useMemo, useCallback } from "react";
import { Text } from "./Text";
import { View, Pressable, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { useTheme } from "@/hooks/use-theme";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

interface CalendarModalProps {
  visible: boolean;
  onClose: () => void;
  /** Currently selected date in YYYY-MM-DD format */
  value: string;
  /** Called with YYYY-MM-DD when user selects a date */
  onChange: (date: string) => void;
  /** Maximum selectable date. Defaults to today. Pass null for no limit. */
  maximumDate?: Date | null;
  /** Minimum selectable date. */
  minimumDate?: Date;
}

type ViewMode = "day" | "month" | "year";

/** Format a Date to YYYY-MM-DD. */
function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Get today's date string. */
function todayStr(): string {
  return formatYMD(new Date());
}

interface GridCell {
  day: number;
  current: boolean;
}

/** Build a fixed 6-row × 7-col grid. Fills leading/trailing cells with adjacent month dates. */
function buildGrid(year: number, month: number): GridCell[][] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const grid: GridCell[][] = [];
  let day = 1;
  let nextDay = 1;

  for (let row = 0; row < 6; row++) {
    const week: GridCell[] = [];
    for (let col = 0; col < 7; col++) {
      if (row === 0 && col < firstDay) {
        week.push({ day: prevMonthDays - firstDay + col + 1, current: false });
      } else if (day > daysInMonth) {
        week.push({ day: nextDay++, current: false });
      } else {
        week.push({ day, current: true });
        day++;
      }
    }
    grid.push(week);
  }

  return grid;
}

export function CalendarModal({
  visible,
  onClose,
  value,
  onChange,
  maximumDate,
  minimumDate,
}: CalendarModalProps) {
  const { colors, accent } = useColorScheme();
  const theme = useTheme();

  // Parse selected date
  const [selY, selM, selD] = useMemo(() => {
    const parts = value.split("-").map(Number);
    if (parts.length === 3 && !isNaN(parts[0])) return parts;
    const now = new Date();
    return [now.getFullYear(), now.getMonth() + 1, now.getDate()];
  }, [value]);

  // Calendar navigation state — the month being viewed
  const [viewYear, setViewYear] = useState(selY);
  const [viewMonth, setViewMonth] = useState(selM - 1); // 0-indexed
  const [mode, setMode] = useState<ViewMode>("day");
  // Year-grid page anchor — the top-left year of the 12-year page
  const [yearPageAnchor, setYearPageAnchor] = useState(
    Math.floor((selY - 1) / 12) * 12 + 1,
  );

  // Reset view when modal opens
  const handleOpen = useCallback(() => {
    setViewYear(selY);
    setViewMonth(selM - 1);
    setMode("day");
    setYearPageAnchor(Math.floor((selY - 1) / 12) * 12 + 1);
  }, [selY, selM]);

  // Max/min date boundaries
  const maxDate = maximumDate === null ? null : (maximumDate ?? new Date());
  const maxStr = maxDate ? formatYMD(maxDate) : null;
  const minStr = minimumDate ? formatYMD(minimumDate) : null;

  const today = todayStr();

  const grid = useMemo(() => buildGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  const handlePrevMonth = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }, [viewMonth]);

  const handleNextMonth = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }, [viewMonth]);

  const handleDayPress = useCallback(
    (day: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      onChange(dateStr);
      onClose();
    },
    [viewYear, viewMonth, onChange, onClose],
  );

  const handleTodayPress = useCallback(() => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setMode("day");
    handleDayPress(now.getDate());
  }, [handleDayPress]);

  // Next/prev month buttons disabled when out of range
  const nextMonthDisabled = maxDate
    ? viewYear > maxDate.getFullYear() ||
      (viewYear === maxDate.getFullYear() && viewMonth >= maxDate.getMonth())
    : false;
  const prevMonthDisabled = minimumDate
    ? viewYear < minimumDate.getFullYear() ||
      (viewYear === minimumDate.getFullYear() && viewMonth <= minimumDate.getMonth())
    : false;

  const handlePrevYearPage = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setYearPageAnchor((a) => a - 12);
  }, []);
  const handleNextYearPage = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setYearPageAnchor((a) => a + 12);
  }, []);

  const handlePickMonth = useCallback((monthIdx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setViewMonth(monthIdx);
    setMode("day");
  }, []);

  const handlePickYear = useCallback((year: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setViewYear(year);
    setMode("month");
  }, []);

  // Month is disabled if EVERY day in it is outside min/max.
  // Cheap check: compare month start/end against min/max strings.
  const isMonthDisabled = useCallback(
    (year: number, monthIdx: number): boolean => {
      const monthStart = `${year}-${String(monthIdx + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(year, monthIdx + 1, 0).getDate();
      const monthEnd = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      if (maxStr !== null && monthStart > maxStr) return true;
      if (minStr !== null && monthEnd < minStr) return true;
      return false;
    },
    [maxStr, minStr],
  );

  const isYearDisabled = useCallback(
    (year: number): boolean => {
      if (maxStr !== null && `${year}-01-01` > maxStr) return true;
      if (minStr !== null && `${year}-12-31` < minStr) return true;
      return false;
    },
    [maxStr, minStr],
  );

  const yearPageDisabledPrev = useMemo(() => {
    if (!minStr) return false;
    // Last year on the previous page is yearPageAnchor - 1
    return isYearDisabled(yearPageAnchor - 1);
  }, [yearPageAnchor, minStr, isYearDisabled]);
  const yearPageDisabledNext = useMemo(() => {
    if (!maxStr) return false;
    return isYearDisabled(yearPageAnchor + 12);
  }, [yearPageAnchor, maxStr, isYearDisabled]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onShow={handleOpen}
    >
      <Pressable
        className="flex-1 bg-black/40 justify-end"
        onPress={onClose}
      >
        <Pressable
          className="bg-background rounded-t-2xl"
          onPress={() => {}} // Prevent dismiss
        >
          {/* Handle bar */}
          <View className="items-center pt-3 pb-2">
            <View className="w-10 h-1 rounded-full bg-border" />
          </View>

          {/* Header */}
          {mode === "day" && (
            <View className="flex-row items-center justify-between px-4 mb-2">
              <Pressable
                onPress={handlePrevMonth}
                className="p-2"
                disabled={prevMonthDisabled}
                style={{ opacity: prevMonthDisabled ? 0.3 : 1 }}
                accessibilityLabel="Previous month"
                accessibilityRole="button"
              >
                <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
              </Pressable>
              <View className="flex-row items-center">
                <Pressable
                  onPress={() => setMode("month")}
                  className="px-2 py-1 rounded-lg"
                  accessibilityLabel="Pick month"
                  accessibilityRole="button"
                >
                  <Text className="text-lg font-bold text-foreground">
                    {MONTH_NAMES[viewMonth]}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setYearPageAnchor(Math.floor((viewYear - 1) / 12) * 12 + 1);
                    setMode("year");
                  }}
                  className="px-2 py-1 rounded-lg ml-1"
                  accessibilityLabel="Pick year"
                  accessibilityRole="button"
                >
                  <Text className="text-lg font-bold text-foreground">
                    {viewYear}
                  </Text>
                </Pressable>
              </View>
              <Pressable
                onPress={handleNextMonth}
                className="p-2"
                disabled={nextMonthDisabled}
                style={{ opacity: nextMonthDisabled ? 0.3 : 1 }}
                accessibilityLabel="Next month"
                accessibilityRole="button"
              >
                <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>
          )}

          {mode === "month" && (
            <View className="flex-row items-center justify-between px-4 mb-2">
              <Pressable
                onPress={() => setMode("day")}
                className="p-2"
                accessibilityLabel="Back to day view"
                accessibilityRole="button"
              >
                <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
              </Pressable>
              <Pressable
                onPress={() => {
                  setYearPageAnchor(Math.floor((viewYear - 1) / 12) * 12 + 1);
                  setMode("year");
                }}
                className="px-2 py-1 rounded-lg"
                accessibilityLabel="Pick year"
                accessibilityRole="button"
              >
                <Text className="text-lg font-bold text-foreground">
                  {viewYear}
                </Text>
              </Pressable>
              <View className="p-2 w-9" />
            </View>
          )}

          {mode === "year" && (
            <View className="flex-row items-center justify-between px-4 mb-2">
              <Pressable
                onPress={handlePrevYearPage}
                className="p-2"
                disabled={yearPageDisabledPrev}
                style={{ opacity: yearPageDisabledPrev ? 0.3 : 1 }}
                accessibilityLabel="Previous 12 years"
                accessibilityRole="button"
              >
                <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
              </Pressable>
              <Text className="text-lg font-bold text-foreground">
                {yearPageAnchor} – {yearPageAnchor + 11}
              </Text>
              <Pressable
                onPress={handleNextYearPage}
                className="p-2"
                disabled={yearPageDisabledNext}
                style={{ opacity: yearPageDisabledNext ? 0.3 : 1 }}
                accessibilityLabel="Next 12 years"
                accessibilityRole="button"
              >
                <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>
          )}

          {/* Day view */}
          {mode === "day" && (
            <>
              {/* Weekday headers */}
              <View className="flex-row px-4 mb-1">
                {WEEKDAYS.map((wd) => (
                  <View key={wd} className="flex-1 items-center">
                    <Text className="text-xs font-semibold text-faint-foreground uppercase">
                      {wd}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Day grid — always 6 rows for consistent height */}
              <View className="px-4 mb-2">
                {grid.map((week, rowIdx) => (
                  <View key={rowIdx} className="flex-row">
                    {week.map((cell, colIdx) => {
                      if (!cell.current) {
                        return (
                          <View key={colIdx} className="flex-1 h-11 items-center justify-center">
                            <Text className="text-sm text-faint-foreground/30">{cell.day}</Text>
                          </View>
                        );
                      }

                      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(cell.day).padStart(2, "0")}`;
                      const isSelected = viewYear === selY && viewMonth === selM - 1 && cell.day === selD;
                      const isToday = dateStr === today;
                      const isDisabled =
                        (maxStr !== null && dateStr > maxStr) ||
                        (minStr !== null && dateStr < minStr);

                      return (
                        <Pressable
                          key={colIdx}
                          onPress={() => !isDisabled && handleDayPress(cell.day)}
                          disabled={isDisabled}
                          className="flex-1 h-11 items-center justify-center"
                        >
                          <View
                            className={`w-9 h-9 rounded-full items-center justify-center ${
                              isSelected ? "" : isToday ? "border" : ""
                            }`}
                            style={
                              isSelected
                                ? { backgroundColor: theme.primary }
                                : isToday
                                  ? { borderColor: theme.alpha("primary", 0.25) }
                                  : undefined
                            }
                          >
                            <Text
                              className={`text-sm ${
                                isSelected
                                  ? "font-bold text-white"
                                  : isDisabled
                                    ? "text-faint-foreground/40"
                                    : isToday
                                      ? "font-bold text-foreground"
                                      : "font-medium text-foreground"
                              }`}
                            >
                              {cell.day}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Month grid — 3×4 */}
          {mode === "month" && (
            <View className="px-4 mb-2">
              {[0, 1, 2, 3].map((row) => (
                <View key={row} className="flex-row">
                  {[0, 1, 2].map((col) => {
                    const monthIdx = row * 3 + col;
                    const isSelected = viewYear === selY && monthIdx === selM - 1;
                    const isCurrentMonth =
                      viewYear === new Date().getFullYear() &&
                      monthIdx === new Date().getMonth();
                    const isDisabled = isMonthDisabled(viewYear, monthIdx);

                    return (
                      <Pressable
                        key={col}
                        onPress={() => !isDisabled && handlePickMonth(monthIdx)}
                        disabled={isDisabled}
                        className="flex-1 h-14 items-center justify-center"
                      >
                        <View
                          className={`px-4 py-2 rounded-full items-center justify-center ${
                            isSelected ? "" : isCurrentMonth ? "border" : ""
                          }`}
                          style={
                            isSelected
                              ? { backgroundColor: theme.primary }
                              : isCurrentMonth
                                ? { borderColor: theme.alpha("primary", 0.25) }
                                : undefined
                          }
                        >
                          <Text
                            className={`text-sm ${
                              isSelected
                                ? "font-bold text-white"
                                : isDisabled
                                  ? "text-faint-foreground/40"
                                  : isCurrentMonth
                                    ? "font-bold text-foreground"
                                    : "font-medium text-foreground"
                            }`}
                          >
                            {MONTH_NAMES_SHORT[monthIdx]}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          )}

          {/* Year grid — 3×4, 12 years per page */}
          {mode === "year" && (
            <View className="px-4 mb-2">
              {[0, 1, 2, 3].map((row) => (
                <View key={row} className="flex-row">
                  {[0, 1, 2].map((col) => {
                    const year = yearPageAnchor + row * 3 + col;
                    const isSelected = year === selY;
                    const isCurrentYear = year === new Date().getFullYear();
                    const isDisabled = isYearDisabled(year);

                    return (
                      <Pressable
                        key={col}
                        onPress={() => !isDisabled && handlePickYear(year)}
                        disabled={isDisabled}
                        className="flex-1 h-14 items-center justify-center"
                      >
                        <View
                          className={`px-4 py-2 rounded-full items-center justify-center ${
                            isSelected ? "" : isCurrentYear ? "border" : ""
                          }`}
                          style={
                            isSelected
                              ? { backgroundColor: theme.primary }
                              : isCurrentYear
                                ? { borderColor: theme.alpha("primary", 0.25) }
                                : undefined
                          }
                        >
                          <Text
                            className={`text-sm ${
                              isSelected
                                ? "font-bold text-white"
                                : isDisabled
                                  ? "text-faint-foreground/40"
                                  : isCurrentYear
                                    ? "font-bold text-foreground"
                                    : "font-medium text-foreground"
                            }`}
                          >
                            {year}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          )}

          {/* Footer: Today shortcut + Cancel */}
          <View className="flex-row px-4 mb-6 gap-3">
            <Pressable
              onPress={handleTodayPress}
              className="flex-1 py-3 rounded-xl items-center"
              style={{ backgroundColor: theme.alpha("primary", 0.1) }}
            >
              <Text
                className="text-sm font-semibold"
                style={{ color: theme.primary }}
              >
                Today
              </Text>
            </Pressable>
            <Pressable
              onPress={onClose}
              className="flex-1 py-3 rounded-xl bg-background items-center"
            >
              <Text className="text-sm font-semibold text-muted-foreground">
                Cancel
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
