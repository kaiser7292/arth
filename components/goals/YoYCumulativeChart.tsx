import { useRef, useState } from "react";
import { View, LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { formatCompact } from "@/utils/format";

const HEIGHT = 140;
const PAD_TOP = 22;
const PAD_BOTTOM = 6;
const PAD_H = 8;

interface Props {
  /** One label per month of the financial year ("Apr" … "Mar"). */
  monthLabels: string[];
  current: number[];
  base: number[];
  currentLabel: string;
  baseLabel: string;
}

/**
 * Spending added up through the year: this year (solid) against the other (dashed), on the same
 * months. Drag along it to read any month - the label above follows the finger.
 */
export function YoYCumulativeChart({ monthLabels, current, base, currentLabel, baseLabel }: Props) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubRef = useRef<number | null>(null);

  const n = Math.max(monthLabels.length, 1);
  const max = Math.max(1, ...current, ...base);
  const x = (i: number) => (n <= 1 ? width / 2 : PAD_H + (i / (n - 1)) * (width - 2 * PAD_H));
  const y = (v: number) => PAD_TOP + (1 - v / max) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
  const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
  const lastIdx = Math.max(current.length, base.length) - 1;

  const scrubTo = (px: number) => {
    if (width <= 0 || lastIdx < 0) return;
    const i = Math.max(0, Math.min(lastIdx, Math.round(((px - PAD_H) / (width - 2 * PAD_H)) * (n - 1))));
    if (i === scrubRef.current) return;
    scrubRef.current = i;
    setScrub(i);
    Haptics.selectionAsync().catch(() => {});
  };
  const endScrub = () => {
    scrubRef.current = null;
    setScrub(null);
  };
  const gesture = Gesture.Race(
    Gesture.Pan().runOnJS(true).activeOffsetX([-6, 6]).failOffsetY([-12, 12]).onStart((e) => scrubTo(e.x)).onUpdate((e) => scrubTo(e.x)).onFinalize(endScrub),
    Gesture.LongPress().runOnJS(true).minDuration(120).onStart((e) => scrubTo(e.x)).onFinalize(endScrub),
  );

  const at = scrub;
  const readout =
    at == null
      ? null
      : `${monthLabels[at] ?? ""}: ${current[at] != null ? formatCompact(current[at]) : "—"} vs ${base[at] != null ? formatCompact(base[at]) : "—"}`;

  return (
    <View>
      <GestureDetector gesture={gesture}>
        <View
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
          style={{ height: HEIGHT }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`Spending through the year. ${currentLabel} ${formatCompact(current[current.length - 1] ?? 0)} so far, ${baseLabel} ${formatCompact(base[base.length - 1] ?? 0)}. Drag across for each month.`}
        >
          {width > 0 && (
            <Svg width={width} height={HEIGHT}>
              <Line x1={0} x2={width} y1={HEIGHT - PAD_BOTTOM} y2={HEIGHT - PAD_BOTTOM} stroke={theme.border} strokeWidth={1} />
              {base.length > 0 && (
                <Path d={path(base)} stroke={theme.mutedForeground} strokeWidth={2} strokeDasharray="5,5" fill="none" strokeLinejoin="round" />
              )}
              {current.length > 0 && (
                <Path d={path(current)} stroke={theme.primary} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              )}
              {at != null && (
                <>
                  <Line x1={x(at)} x2={x(at)} y1={16} y2={HEIGHT - PAD_BOTTOM} stroke={theme.foreground} strokeWidth={1} />
                  {current[at] != null && <Circle cx={x(at)} cy={y(current[at])} r={4.5} fill={theme.primary} stroke={theme.card} strokeWidth={2} />}
                  {base[at] != null && <Circle cx={x(at)} cy={y(base[at])} r={3.5} fill={theme.card} stroke={theme.mutedForeground} strokeWidth={1.5} />}
                </>
              )}
            </Svg>
          )}
          {readout && width > 0 && (
            <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, alignItems: "center" }}>
              <Text className="text-label font-semibold text-foreground">{readout}</Text>
            </View>
          )}
        </View>
      </GestureDetector>
      <View className="flex-row justify-between mt-1">
        <Text className="text-label text-faint-foreground">{monthLabels[0]}</Text>
        <Text className="text-label text-faint-foreground">{monthLabels[monthLabels.length - 1]}</Text>
      </View>
      <View className="flex-row items-center mt-2">
        <View style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: theme.primary }} />
        <Text className="text-label text-muted-foreground ml-1.5 mr-4">{currentLabel}</Text>
        <View style={{ width: 14, height: 0, borderTopWidth: 2, borderStyle: "dashed", borderColor: theme.mutedForeground }} />
        <Text className="text-label text-muted-foreground ml-1.5 flex-1">{baseLabel}</Text>
        <Text className="text-label text-faint-foreground">Drag to read any month</Text>
      </View>
    </View>
  );
}
