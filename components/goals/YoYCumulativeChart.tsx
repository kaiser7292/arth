import { useRef, useState } from "react";
import { View, LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount, formatCompact } from "@/utils/format";

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
 * months. Reads like the Investments chart: drag along it (or press and hold) and a line and dot
 * follow the finger with a light tick per month, the month rides on top of the line, and the rows
 * underneath show both years' figures for that month. Let go and they're back to the latest month.
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
    if (scrubRef.current == null) return;
    scrubRef.current = null;
    setScrub(null);
  };
  // Sideways drag reads the chart; a vertical move fails it so the page still scrolls.
  const gesture = Gesture.Race(
    Gesture.Pan().runOnJS(true).activeOffsetX([-6, 6]).failOffsetY([-12, 12]).onStart((e) => scrubTo(e.x)).onUpdate((e) => scrubTo(e.x)).onFinalize(endScrub),
    Gesture.LongPress().runOnJS(true).minDuration(120).onStart((e) => scrubTo(e.x)).onFinalize(endScrub),
  );

  const scrubbing = scrub != null;
  // The month the rows show: under the finger, else the latest month of this year.
  const at = scrubbing ? scrub! : Math.max(0, current.length - 1);
  const cur = current[at];
  const prev = base[at];
  const diff = cur != null && prev != null ? cur - prev : null;
  const diffPct = diff != null && prev != null && prev > 0 ? Math.round((diff / prev) * 100) : null;

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
              {scrubbing && (
                <>
                  <Line x1={x(at)} x2={x(at)} y1={16} y2={HEIGHT - PAD_BOTTOM} stroke={theme.foreground} strokeWidth={1} />
                  {prev != null && <Circle cx={x(at)} cy={y(prev)} r={3.5} fill={theme.card} stroke={theme.mutedForeground} strokeWidth={1.5} />}
                  {cur != null && <Circle cx={x(at)} cy={y(cur)} r={5} fill={theme.primary} stroke={theme.card} strokeWidth={2} />}
                </>
              )}
            </Svg>
          )}
          {/* While dragging: the month, riding on top of the line (kept inside the chart's edges). */}
          {scrubbing && width > 0 && (
            <View
              pointerEvents="none"
              style={{ position: "absolute", top: 0, left: Math.max(0, Math.min(x(at) - 30, width - 60)), width: 60, alignItems: "center" }}
            >
              <Text className="text-label font-semibold text-foreground">{monthLabels[at]}</Text>
            </View>
          )}
        </View>
      </GestureDetector>
      <View className="flex-row justify-between mt-1">
        <Text className="text-label text-faint-foreground">{monthLabels[0]}</Text>
        <Text className="text-label text-faint-foreground">{monthLabels[monthLabels.length - 1]}</Text>
      </View>

      {/* Both years at that month - follows the finger, like the rows under the Investments chart. */}
      <View className="mt-2">
        <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
          Spent by end of {monthLabels[at]}
        </Text>
        <YearRow swatch={<View style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: theme.primary }} />} label={currentLabel} value={cur} />
        <YearRow
          swatch={<View style={{ width: 14, height: 0, borderTopWidth: 2, borderStyle: "dashed", borderColor: theme.mutedForeground }} />}
          label={baseLabel}
          value={prev}
        />
        {diff != null && (
          <View className="flex-row items-center pt-1.5 mt-0.5 border-t border-border">
            <Text className="text-sm text-foreground flex-1">Difference</Text>
            <Text className="text-sm font-semibold" style={{ color: diff <= 0 ? theme.success : theme.danger }}>
              {diff > 0 ? "+" : diff < 0 ? "−" : ""}{formatAmount(Math.abs(diff))}
              {diffPct != null ? ` (${diffPct > 0 ? "+" : ""}${diffPct}%)` : ""}
            </Text>
          </View>
        )}
        {!scrubbing && <Text className="text-label text-faint-foreground mt-1.5">Drag along the chart to see any month.</Text>}
      </View>
    </View>
  );
}

function YearRow({ swatch, label, value }: { swatch: React.ReactNode; label: string; value: number | undefined }) {
  return (
    <View className="flex-row items-center py-1">
      {swatch}
      <Text className="text-sm text-foreground ml-2 flex-1">{label}</Text>
      <Text className="text-sm text-foreground">{value != null ? formatAmount(value) : "—"}</Text>
    </View>
  );
}
