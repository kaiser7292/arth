/**
 * TimePickerModal — Custom time picker matching the app design system.
 *
 * Bottom-sheet modal with three scrollable columns: Hour, Minute, AM/PM.
 * Uses accent palette, NativeWind classes, and haptic feedback.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { Text } from "./Text";
import { View, Pressable, Modal, FlatList } from "react-native";
import * as Haptics from "expo-haptics";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const PERIODS = ["AM", "PM"] as const;

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;

interface TimePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (hour: number, minute: number) => void;
  initialHour?: number;
  initialMinute?: number;
}

interface ColumnProps {
  data: (string | number)[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  formatItem?: (item: string | number) => string;
}

function Column({ data, selectedIndex, onSelect, formatItem }: ColumnProps) {
  const { accent, colorScheme } = useColorScheme();
  const flatListRef = useRef<FlatList>(null);
  const scrollingRef = useRef(false);

  useEffect(() => {
    if (!scrollingRef.current) {
      flatListRef.current?.scrollToOffset({
        offset: selectedIndex * ITEM_HEIGHT,
        animated: false,
      });
    }
  }, [selectedIndex]);

  const handleMomentumEnd = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      scrollingRef.current = false;
      const y = event.nativeEvent.contentOffset.y;
      const index = Math.round(y / ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(index, data.length - 1));
      if (clamped !== selectedIndex) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onSelect(clamped);
      }
    },
    [data.length, selectedIndex, onSelect],
  );

  const handleScrollBegin = useCallback(() => {
    scrollingRef.current = true;
  }, []);

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: ITEM_HEIGHT,
      offset: ITEM_HEIGHT * index,
      index,
    }),
    [],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: string | number; index: number }) => {
      const isSelected = index === selectedIndex;
      const label = formatItem ? formatItem(item) : String(item);
      return (
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onSelect(index);
            flatListRef.current?.scrollToOffset({
              offset: index * ITEM_HEIGHT,
              animated: true,
            });
          }}
          style={{ height: ITEM_HEIGHT, justifyContent: "center", alignItems: "center" }}
        >
          <Text
            className={isSelected ? "text-xl font-bold" : "text-base text-faint-foreground"}
            style={isSelected ? { color: ac(accent, colorScheme, 500, 300) } : undefined}
          >
            {label}
          </Text>
        </Pressable>
      );
    },
    [selectedIndex, formatItem, accent, colorScheme, onSelect],
  );

  const paddingVertical = (VISIBLE_ITEMS - 1) / 2 * ITEM_HEIGHT;

  return (
    <View style={{ height: ITEM_HEIGHT * VISIBLE_ITEMS, flex: 1 }}>
      <FlatList
        ref={flatListRef}
        data={data as (string | number)[]}
        keyExtractor={(_, i) => String(i)}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical }}
        onMomentumScrollEnd={handleMomentumEnd}
        onScrollBeginDrag={handleScrollBegin}
      />
    </View>
  );
}

function to12Hour(h24: number): { hour12: number; period: "AM" | "PM" } {
  const period = h24 >= 12 ? "PM" : "AM";
  let hour12 = h24 % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, period };
}

function to24Hour(hour12: number, period: "AM" | "PM"): number {
  if (period === "AM") return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

export function TimePickerModal({
  visible,
  onClose,
  onConfirm,
  initialHour = 12,
  initialMinute = 0,
}: TimePickerModalProps) {
  const { colors, accent, colorScheme } = useColorScheme();

  const init12 = to12Hour(initialHour);
  const [hourIdx, setHourIdx] = useState(HOURS.indexOf(init12.hour12));
  const [minuteIdx, setMinuteIdx] = useState(initialMinute);
  const [periodIdx, setPeriodIdx] = useState(init12.period === "AM" ? 0 : 1);

  const handleOpen = useCallback(() => {
    const h12 = to12Hour(initialHour);
    setHourIdx(HOURS.indexOf(h12.hour12));
    setMinuteIdx(initialMinute);
    setPeriodIdx(h12.period === "AM" ? 0 : 1);
  }, [initialHour, initialMinute]);

  const handleConfirm = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const hour24 = to24Hour(HOURS[hourIdx], PERIODS[periodIdx]);
    onConfirm(hour24, minuteIdx);
    onClose();
  }, [hourIdx, minuteIdx, periodIdx, onConfirm, onClose]);

  const previewHour = HOURS[hourIdx];
  const previewMinute = String(minuteIdx).padStart(2, "0");
  const previewPeriod = PERIODS[periodIdx];

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
          onPress={() => {}}
        >
          {/* Handle bar */}
          <View className="items-center pt-3 pb-2">
            <View className="w-10 h-1 rounded-full bg-border" />
          </View>

          {/* Header */}
          <View className="flex-row items-center justify-between px-4 mb-3">
            <Pressable onPress={onClose} className="py-1">
              <Text className="text-sm text-muted-foreground">Cancel</Text>
            </Pressable>
            <Text className="text-base font-bold text-foreground">
              Pick Time
            </Text>
            <Pressable onPress={handleConfirm} className="py-1">
              <Text className="text-sm font-semibold" style={{ color: ac(accent, colorScheme, 500, 300) }}>
                Done
              </Text>
            </Pressable>
          </View>

          {/* Preview */}
          <View className="items-center mb-2">
            <Text
              className="text-3xl font-bold"
              style={{ color: ac(accent, colorScheme, 500, 300) }}
            >
              {previewHour}:{previewMinute} {previewPeriod}
            </Text>
          </View>

          {/* Column labels */}
          <View className="flex-row mb-1 px-2 mx-4">
            <View className="flex-1 items-center">
              <Text className="text-xs font-semibold text-faint-foreground uppercase">Hour</Text>
            </View>
            <View className="flex-1 items-center">
              <Text className="text-xs font-semibold text-faint-foreground uppercase">Min</Text>
            </View>
            <View style={{ width: 80 }} className="items-center">
              <Text className="text-xs font-semibold text-faint-foreground uppercase">{" "}</Text>
            </View>
          </View>

          {/* Selection highlight + scroll columns */}
          <View className="mx-4 mb-1" style={{ position: "relative" }}>
            {/* Center row highlight */}
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: (VISIBLE_ITEMS - 1) / 2 * ITEM_HEIGHT,
                left: 0,
                right: 0,
                height: ITEM_HEIGHT,
                borderRadius: 12,
                backgroundColor: ac(accent, colorScheme, 50, 800),
                borderWidth: 1,
                borderColor: ac(accent, colorScheme, 200, 700),
              }}
            />

            {/* Scroll columns */}
            <View className="flex-row">
              <Column
                data={HOURS}
                selectedIndex={hourIdx}
                onSelect={setHourIdx}
              />
              <Column
                data={MINUTES}
                selectedIndex={minuteIdx}
                onSelect={setMinuteIdx}
                formatItem={(m) => String(m).padStart(2, "0")}
              />
              <View style={{ width: 80 }}>
                <Column
                  data={[...PERIODS]}
                  selectedIndex={periodIdx}
                  onSelect={setPeriodIdx}
                />
              </View>
            </View>
          </View>

          {/* Bottom padding */}
          <View style={{ height: 24 }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
