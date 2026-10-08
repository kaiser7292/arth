import { memo, useState } from "react";
import { Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import Svg, { G, Line, Path } from "react-native-svg";
import { Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount, formatCompact } from "@/utils/format";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface StackedLayer {
  key: string;
  label: string;
  color: string;
  /** Fill opacity of the band (lines are drawn solid). Used to shade accounts within a category. */
  opacity?: number;
  /** One value per month, same order as `months`. */
  values: number[];
}

interface StackedAreaChartProps {
  /** "YYYY-MM", oldest first. */
  months: string[];
  /** Bottom band first. */
  layers: StackedLayer[];
  /** Tapping a band calls this (drill-down). Without it, a tap shows that month's values. */
  onLayerPress?: (key: string) => void;
  height?: number;
}

const PAD_TOP = 10;
const PAD_BOTTOM = 4;
const PAD_H = 4;

function monthLabel(m: string): string {
  const [y, mm] = m.split("-").map(Number);
  return `${SHORT_MONTHS[mm - 1]} ${String(y).slice(2)}`;
}

/**
 * Which month a tap at (px, py) falls on, and which band it's inside (null above the stack or on an
 * empty band). Null when the tap position or chart size isn't usable. Same geometry as the drawing.
 */
export function chartHit(
  months: string[],
  layers: StackedLayer[],
  width: number,
  height: number,
  px: number,
  py: number,
): { index: number; layerKey: string | null } | null {
  const n = months.length;
  if (n === 0 || !(width > 0) || !Number.isFinite(px) || !Number.isFinite(py)) return null;
  const index = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - PAD_H) / Math.max(width - 2 * PAD_H, 1)) * (n - 1))));
  const totals = months.map((_, i) => layers.reduce((s, l) => s + Math.max(l.values[i] ?? 0, 0), 0));
  const max = Math.max(...totals, 0);
  if (max <= 0) return { index, layerKey: null };
  const y = (v: number) => height - PAD_BOTTOM - (v / max) * (height - PAD_TOP - PAD_BOTTOM);
  let base = 0;
  for (const layer of layers) {
    const v = Math.max(layer.values[index] ?? 0, 0);
    const top = base + v;
    if (v > 0 && py <= y(base) && py >= y(top)) return { index, layerKey: layer.key };
    base = top;
  }
  return { index, layerKey: null };
}

/**
 * Stacked area chart: bands sit on top of each other, so the top edge is the total and each band's
 * thickness is its share. Tap a band to drill in (onLayerPress), or tap anywhere for that month's
 * numbers when there's nothing to drill into.
 */
function StackedAreaChartBase({ months, layers, onLayerPress, height = 150 }: StackedAreaChartProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  const n = months.length;
  const totals = months.map((_, i) => layers.reduce((s, l) => s + Math.max(l.values[i] ?? 0, 0), 0));
  const max = Math.max(...totals, 0);

  const x = (i: number) => (n <= 1 ? width / 2 : PAD_H + (i / (n - 1)) * (width - 2 * PAD_H));
  const y = (v: number) => height - PAD_BOTTOM - (max > 0 ? (v / max) * (height - PAD_TOP - PAD_BOTTOM) : 0);

  // Running bottoms/tops per layer, bottom first.
  const bands: { layer: StackedLayer; base: number[]; top: number[] }[] = [];
  let base = months.map(() => 0);
  for (const layer of layers) {
    const top = base.map((b, i) => b + Math.max(layer.values[i] ?? 0, 0));
    bands.push({ layer, base, top });
    base = top;
  }

  const onPress = (e: GestureResponderEvent) => {
    const hit = chartHit(months, layers, width, height, e.nativeEvent.locationX, e.nativeEvent.locationY);
    if (!hit) return;
    if (onLayerPress && hit.layerKey) {
      setSelected(null);
      onLayerPress(hit.layerKey);
      return;
    }
    setSelected((prev) => (prev === hit.index ? null : hit.index));
  };

  if (n === 0 || max <= 0) {
    return (
      <View className="items-center justify-center" style={{ height }}>
        <Text className="text-xs text-faint-foreground">No history yet</Text>
      </View>
    );
  }

  const labelIdx = n <= 2 ? months.map((_, i) => i) : [0, Math.round((n - 1) / 2), n - 1];

  return (
    <View>
      <View
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        style={{ height }}
      >
        {width > 0 && (
          <Svg width={width} height={height}>
            {[0.5, 1].map((f) => (
              <Line
                key={f}
                x1={0}
                x2={width}
                y1={y(max * f)}
                y2={y(max * f)}
                stroke={theme.border}
                strokeWidth={0.5}
                strokeDasharray="3,4"
              />
            ))}
            {bands.map(({ layer, base: b, top: t }) => {
              if (t.every((v, i) => v === b[i])) return null;
              const topPts = t.map((v, i) => `${x(i)} ${y(v)}`);
              const basePts = b.map((v, i) => `${x(i)} ${y(v)}`).reverse();
              const area = `M ${topPts.join(" L ")} L ${basePts.join(" L ")} Z`;
              const edge = `M ${topPts.join(" L ")}`;
              return (
                <G key={layer.key}>
                  <Path d={area} fill={layer.color} fillOpacity={(layer.opacity ?? 1) * 0.75} />
                  <Path d={edge} stroke={layer.color} strokeOpacity={layer.opacity ?? 1} strokeWidth={1.25} fill="none" />
                </G>
              );
            })}
            <Line x1={0} x2={width} y1={height - PAD_BOTTOM} y2={height - PAD_BOTTOM} stroke={theme.border} strokeWidth={1} />
            {selected != null && (
              <Line
                x1={x(selected)}
                x2={x(selected)}
                y1={PAD_TOP}
                y2={height - PAD_BOTTOM}
                stroke={theme.mutedForeground}
                strokeWidth={1}
                strokeDasharray="3,3"
              />
            )}
          </Svg>
        )}
        <Pressable
          onPress={onPress}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          accessibilityRole="button"
          accessibilityLabel={onLayerPress ? "Chart. Tap a band to see its accounts" : "Chart. Tap for a month's values"}
        />
        {/* Gridline values, top-left so they don't fight the bands. */}
        <Text className="text-label text-faint-foreground" style={{ position: "absolute", left: 2, top: y(max) - 14 }} pointerEvents="none">
          {formatCompact(max)}
        </Text>
      </View>

      <View className="flex-row justify-between mt-1">
        {labelIdx.map((i) => (
          <Text key={i} className="text-label text-faint-foreground">
            {monthLabel(months[i])}
          </Text>
        ))}
      </View>

      {selected != null && selected < n && (
        <View className="mt-2 rounded-lg px-3 py-2" style={{ backgroundColor: theme.alpha("foreground", 0.05) }}>
          <View className="flex-row justify-between mb-1">
            <Text className="text-xs font-semibold text-foreground">{monthLabel(months[selected])}</Text>
            <Text className="text-xs font-semibold text-foreground">{formatAmount(totals[selected])}</Text>
          </View>
          {[...bands].reverse().map(({ layer }) => {
            const v = layer.values[selected] ?? 0;
            if (v <= 0) return null;
            return (
              <View key={layer.key} className="flex-row items-center mt-0.5">
                <View
                  className="w-2 h-2 rounded-sm mr-2"
                  style={{ backgroundColor: layer.color, opacity: layer.opacity ?? 1 }}
                />
                <Text className="text-xs text-muted-foreground flex-1" numberOfLines={1}>{layer.label}</Text>
                <Text className="text-xs text-foreground">{formatAmount(v)}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

export const StackedAreaChart = memo(StackedAreaChartBase);
