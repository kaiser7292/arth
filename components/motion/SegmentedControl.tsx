import { useEffect, useState } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Text } from "@/components/ui/Text";
import { useTheme } from "@/hooks/use-theme";
import { timing } from "./motion";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Layout only (margins). */
  className?: string;
  accessibilityLabel?: string;
}

/** Inner padding of the track (p-1), which the highlight sits inside. */
const PAD = 4;

/**
 * One choice out of a few, with a highlight that glides to the selected option (MOTION.base).
 * Options share the width equally, so one measurement of the track places the highlight; the first
 * placement doesn't animate - it's simply there when the screen opens.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = "",
  accessibilityLabel,
}: SegmentedControlProps<T>) {
  const theme = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const left = useSharedValue(0);
  const placed = useSharedValue(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const segment = trackWidth > 0 ? (trackWidth - PAD * 2) / options.length : 0;

  useEffect(() => {
    if (segment <= 0) return;
    const x = PAD + index * segment;
    if (!placed.value) {
      left.value = x;
      placed.value = 1;
    } else {
      left.value = withTiming(x, timing());
    }
  }, [index, segment, left, placed]);

  const highlight = useAnimatedStyle(() => ({ left: left.value, opacity: placed.value }));

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (Math.abs(w - trackWidth) > 0.5) setTrackWidth(w);
  };

  return (
    <View
      onLayout={onLayout}
      className={`flex-row rounded-full border border-border bg-card p-1 ${className}`}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          { position: "absolute", top: PAD, bottom: PAD, width: segment, borderRadius: 9999, backgroundColor: theme.primary },
          highlight,
        ]}
      />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => !on && onChange(o.value)}
            className="flex-1 items-center justify-center rounded-full py-2"
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
          >
            <Text className="text-sm font-semibold" style={{ color: on ? theme.primaryForeground : theme.mutedForeground }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
