import { View, Text, Pressable, LayoutChangeEvent } from "react-native";
import { memo, useState, useCallback } from "react";
import Svg, { Path, Circle, Defs, LinearGradient, Stop, G, Line } from "react-native-svg";
import type { MonthlyTotal } from "@/services/expense";
import { formatAmount } from "@/utils/format";
import { CHART_COLORS } from "@/constants/semantic-colors";

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export interface TrendSeries {
  label: string;
  data: MonthlyTotal[];
  color: string;
}

interface TrendLineChartProps {
  data?: MonthlyTotal[];
  color?: string;
  series?: TrendSeries[];
  showLegend?: boolean;
}

const CHART_HEIGHT = 130;
const PAD_TOP = 8;
const PAD_BOTTOM = 8;

function formatXLabel(key: string): string {
  const parts = key.split("-").map(Number);
  if (parts.length === 3) {
    return `${SHORT_MONTHS[parts[1] - 1]} ${parts[2]}`;
  }
  return SHORT_MONTHS[parts[1] - 1];
}

function TrendLineChartBase({ data, color, series, showLegend }: TrendLineChartProps) {
  const [width, setWidth] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const allSeries: TrendSeries[] = series && series.length > 0
    ? series
    : data && color
      ? [{ label: "", data, color }]
      : [];

  if (allSeries.length === 0) return null;

  const months = allSeries[0].data.map((d) => d.month);
  const allValues = allSeries.flatMap((s) => s.data.map((d) => d.total));
  const maxValue = Math.max(...allValues);

  if (maxValue === 0) {
    return (
      <View className="items-center py-4">
        <Text className="text-xs text-text-tertiary">No portfolio data yet</Text>
      </View>
    );
  }

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const usableHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const padH = 20;

  const getX = (i: number) => {
    if (months.length === 1) return width / 2;
    return padH + (i / (months.length - 1)) * (width - 2 * padH);
  };

  const getY = (value: number) => {
    const ratio = value / maxValue;
    return CHART_HEIGHT - PAD_BOTTOM - ratio * usableHeight;
  };

  const isMulti = allSeries.length > 1;

  const handlePress = useCallback((index: number) => {
    setSelectedIndex((prev) => (prev === index ? null : index));
  }, []);

  // Determine which x-axis labels to show: first, last, and evenly-spaced middle ones
  const getVisibleLabels = (): number[] => {
    if (months.length <= 5) return months.map((_, i) => i);
    const maxLabels = 5;
    const indices: number[] = [0];
    const step = (months.length - 1) / (maxLabels - 1);
    for (let k = 1; k < maxLabels - 1; k++) {
      indices.push(Math.round(k * step));
    }
    indices.push(months.length - 1);
    return [...new Set(indices)];
  };

  const visibleLabelIndices = width > 0 ? getVisibleLabels() : [];

  return (
    <View>
      {/* Tooltip for selected point */}
      {selectedIndex !== null && width > 0 && (
        <View
          style={{
            position: "absolute",
            top: -4,
            left: Math.max(4, Math.min(getX(selectedIndex) - 52, width - 108)),
            zIndex: 10,
            backgroundColor: "#1F2937",
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 6,
            minWidth: 104,
          }}
        >
          <Text style={{ fontSize: 10, color: "#9CA3AF", textAlign: "center" }}>
            {formatXLabel(months[selectedIndex])}
          </Text>
          {allSeries.map((s, si) => {
            const val = s.data[selectedIndex]?.total ?? 0;
            if (val === 0 && isMulti) return null;
            return (
              <View key={si} style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
                {isMulti && (
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color, marginRight: 4 }} />
                )}
                <Text style={{ fontSize: 11, color: "#FFFFFF", fontWeight: "600" }}>
                  {formatAmount(val)}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {/* SVG chart */}
      <View onLayout={onLayout} style={{ height: CHART_HEIGHT, marginTop: selectedIndex !== null ? 36 : 0 }}>
        {width > 0 && (
          <Svg width={width} height={CHART_HEIGHT}>
            <Defs>
              {allSeries.map((s, si) => (
                <LinearGradient key={`grad-${si}`} id={`areaGrad-${si}`} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={s.color} stopOpacity={isMulti ? 0.08 : 0.18} />
                  <Stop offset="1" stopColor={s.color} stopOpacity={0.02} />
                </LinearGradient>
              ))}
            </Defs>

            {/* Vertical indicator line for selected point */}
            {selectedIndex !== null && (
              <Line
                x1={getX(selectedIndex)}
                y1={PAD_TOP}
                x2={getX(selectedIndex)}
                y2={CHART_HEIGHT - PAD_BOTTOM}
                stroke="#6B7280"
                strokeWidth={1}
                strokeDasharray="3,3"
                opacity={0.5}
              />
            )}

            {allSeries.map((s, si) => {
              const points = s.data.map((d, i) => ({ x: getX(i), y: getY(d.total) }));
              const hasData = s.data.some((d) => d.total > 0);
              if (!hasData) return null;

              const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
              const areaPath = `${linePath} L ${points[points.length - 1].x} ${CHART_HEIGHT} L ${points[0].x} ${CHART_HEIGHT} Z`;

              return (
                <G key={si}>
                  {(!isMulti || si === 0) && (
                    <Path d={areaPath} fill={`url(#areaGrad-${si})`} />
                  )}

                  <Path
                    d={linePath}
                    stroke={s.color}
                    strokeWidth={si === 0 && isMulti ? 2.5 : 2}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={si === 0 || !isMulti ? 1 : 0.8}
                  />

                  {points.map((p, i) => {
                    if (s.data[i].total === 0) return null;
                    const isSelected = selectedIndex === i;
                    const isLast = i === s.data.length - 1;
                    const baseR = isLast ? (si === 0 ? 4 : 3) : 2.5;
                    return (
                      <Circle
                        key={`${si}-${i}`}
                        cx={p.x}
                        cy={p.y}
                        r={isSelected ? baseR + 2 : baseR}
                        fill={isSelected || isLast ? s.color : s.color + "80"}
                        stroke={isSelected ? s.color : CHART_COLORS.pointStroke}
                        strokeWidth={isSelected ? 3 : isLast ? 2 : 1}
                        opacity={isSelected ? 1 : undefined}
                      />
                    );
                  })}
                </G>
              );
            })}
          </Svg>
        )}

        {/* Invisible touch targets overlaid on chart */}
        {width > 0 && (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row" }}>
            {months.map((_, i) => {
              const segW = width / months.length;
              return (
                <Pressable
                  key={i}
                  onPress={() => handlePress(i)}
                  style={{ width: segW, height: CHART_HEIGHT }}
                  accessibilityLabel={`Data point ${i + 1}`}
                />
              );
            })}
          </View>
        )}
      </View>

      {/* X-axis labels */}
      {width > 0 && (
        <View style={{ height: 18, position: "relative", marginTop: 2 }}>
          {visibleLabelIndices.map((i) => {
            const isLast = i === months.length - 1;
            const isSelected = selectedIndex === i;
            return (
              <Text
                key={months[i]}
                style={{
                  position: "absolute",
                  left: getX(i) - 24,
                  width: 48,
                  textAlign: "center",
                  fontSize: 10,
                  fontWeight: isLast || isSelected ? "600" : "400",
                  color: isSelected ? "#1F2937" : isLast ? CHART_COLORS.axisEmphasis : CHART_COLORS.axisMuted,
                }}
              >
                {formatXLabel(months[i])}
              </Text>
            );
          })}
        </View>
      )}

      {/* Legend — shows latest value per series */}
      {showLegend && isMulti && (
        <View className="flex-row flex-wrap mt-3 pt-2 border-t border-border-light dark:border-border-dark">
          {allSeries.map((s, si) => {
            const latestVal = s.data[s.data.length - 1]?.total ?? 0;
            return (
              <View key={si} className="flex-row items-center mr-4 mb-1">
                <View
                  style={{
                    width: si === 0 ? 14 : 10,
                    height: 3,
                    borderRadius: 1.5,
                    backgroundColor: s.color,
                    marginRight: 6,
                    opacity: si === 0 ? 1 : 0.8,
                  }}
                />
                <Text
                  className="text-xs"
                  style={{
                    color: s.color,
                    fontWeight: si === 0 ? "600" : "400",
                  }}
                  numberOfLines={1}
                >
                  {s.label} · {formatAmount(latestVal)}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

export const TrendLineChart = memo(TrendLineChartBase);
