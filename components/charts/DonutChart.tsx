import { memo } from "react";
import { Text } from "@/components/ui";
import { View, Pressable } from "react-native";
import Svg, { Path } from "react-native-svg";

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
  /** Called when a legend item (segment) is tapped */
  onSegmentPress?: (index: number, segment: DonutSegment) => void;
  /** Called when the ring/center itself is tapped (e.g. to show exact per-segment amounts). */
  onPress?: () => void;
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

/**
 * SVG path for one donut wedge (an annular sector) from `startAngle` to
 * `endAngle` (radians, 0 = 3 o'clock, increasing clockwise) between outer
 * radius R and inner radius r.
 */
function describeDonutWedge(cx: number, cy: number, R: number, r: number, startAngle: number, endAngle: number): string {
  const startOuter = polarToCartesian(cx, cy, R, startAngle);
  const endOuter = polarToCartesian(cx, cy, R, endAngle);
  const startInner = polarToCartesian(cx, cy, r, endAngle);
  const endInner = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${R} ${R} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${r} ${r} 0 ${largeArc} 0 ${endInner.x} ${endInner.y}`,
    "Z",
  ].join(" ");
}

/**
 * Donut chart drawn with actual SVG arcs — each wedge is a proportional
 * annular sector, so segment size and z-order can never fight each other.
 *
 * The previous implementation drew each segment as a full-circle View with
 * only some border SIDES colored (a "quadrant" trick), sized in fixed 90°
 * chunks regardless of the segment's real percentage, then stacked later
 * segments on top of earlier ones. A small segment (e.g. an 8% slice) could
 * end up fully painted over by a larger, later segment whose 90°-quantized
 * colored region happened to overlap it — the slice's color was computed
 * correctly but never actually visible. SVG path wedges don't have this
 * failure mode: each wedge occupies exactly its own angular range.
 */
function DonutChartBase({
  segments,
  size = 160,
  centerLabel,
  centerValue,
  onSegmentPress,
  onPress,
}: DonutChartProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return (
      <View className="items-center py-4">
        <Text className="text-xs text-faint-foreground">No data</Text>
      </View>
    );
  }

  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 1; // slight inset so the stroke edge isn't clipped
  const r = size * 0.3; // inner radius — matches the center content circle below

  // Start at 12 o'clock (-90°) and sweep clockwise, same visual convention
  // the previous border-trick version used.
  let cumulativeAngle = -Math.PI / 2;
  const wedges = segments
    .map((segment) => {
      const sweep = (segment.value / total) * Math.PI * 2;
      const startAngle = cumulativeAngle;
      // A single 100% segment would produce a zero-length arc (start===end
      // mod 2π) — cap just short of a full circle so it still renders.
      const endAngle = startAngle + Math.min(sweep, Math.PI * 2 * 0.9999);
      cumulativeAngle += sweep;
      if (segment.value <= 0) return null;
      return { segment, path: describeDonutWedge(cx, cy, R, r, startAngle, endAngle) };
    })
    .filter((w): w is { segment: DonutSegment; path: string } => w !== null);

  return (
    <View className="items-center">
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? "button" : undefined}
        accessibilityLabel={onPress ? "Show exact amounts per category" : undefined}
        style={{ width: size, height: size }}
        className="items-center justify-center"
      >
        <Svg width={size} height={size} style={{ position: "absolute" }}>
          {wedges.map((w, i) => (
            <Path key={i} d={w.path} fill={w.segment.color} />
          ))}
        </Svg>

        {/* Center content */}
        <View
          style={{
            width: r * 2,
            height: r * 2,
            borderRadius: r,
            paddingHorizontal: 4,
          }}
          className="bg-background items-center justify-center"
        >
          {centerValue && (
            <Text
              className="text-lg font-bold text-foreground"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {centerValue}
            </Text>
          )}
          {centerLabel && (
            <Text className="text-label text-faint-foreground">{centerLabel}</Text>
          )}
        </View>
      </Pressable>

      {/* Legend — pressable when onSegmentPress provided */}
      <View className="flex-row flex-wrap justify-center mt-3 gap-x-4 gap-y-1">
        {segments.map(
          (segment, index) =>
            segment.value > 0 && (
              <Pressable
                key={index}
                onPress={() => onSegmentPress?.(index, segment)}
                style={({ pressed }) => ({ opacity: pressed && onSegmentPress ? 0.6 : 1 })}
                disabled={!onSegmentPress}
              >
                <View className="flex-row items-center">
                  <View
                    className="w-3 h-3 rounded-full mr-1"
                    style={{ backgroundColor: segment.color }}
                  />
                  <Text className="text-xs text-muted-foreground">
                    {segment.label} ({Math.round((segment.value / total) * 100)}%)
                    {onSegmentPress ? " ›" : ""}
                  </Text>
                </View>
              </Pressable>
            ),
        )}
      </View>
    </View>
  );
}

export const DonutChart = memo(DonutChartBase);
