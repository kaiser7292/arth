import { memo } from "react";
import { View, Text, Pressable } from "react-native";

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
}

/**
 * Simple donut chart using nested Views with rounded borders.
 * Uses a stacked-ring approach: background ring + colored arcs via
 * overlapping half-circles (conic gradient simulation).
 *
 * For simplicity and RN compatibility, uses a segmented bar approach
 * rendered as a horizontal split bar (works everywhere, no SVG needed).
 */
function DonutChartBase({
  segments,
  size = 160,
  centerLabel,
  centerValue,
  onSegmentPress,
}: DonutChartProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return (
      <View className="items-center py-4">
        <Text className="text-xs text-faint-foreground">No data</Text>
      </View>
    );
  }

  return (
    <View className="items-center">
      {/* Segmented ring using stacked half-circle technique */}
      <View
        style={{ width: size, height: size }}
        className="items-center justify-center"
      >
        {/* Background ring */}
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: size * 0.15,
            borderColor: "#E5E5E320",
          }}
          className="absolute"
        />

        {/* Colored segments as stacked arcs */}
        {(() => {
          let cumulativeRotation = 0;
          return segments.map((segment, index) => {
            const pct = segment.value / total;
            const degrees = pct * 360;
            const rotation = cumulativeRotation;
            cumulativeRotation += degrees;

            if (pct === 0) return null;

            return (
              <View
                key={index}
                style={{
                  position: "absolute",
                  width: size,
                  height: size,
                }}
              >
                {/* Use two half-circles to draw the arc */}
                <View
                  style={{
                    position: "absolute",
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    borderWidth: size * 0.15,
                    borderColor: "transparent",
                    borderTopColor: segment.color,
                    borderRightColor:
                      degrees > 90 ? segment.color : "transparent",
                    borderBottomColor:
                      degrees > 180 ? segment.color : "transparent",
                    borderLeftColor:
                      degrees > 270 ? segment.color : "transparent",
                    transform: [{ rotate: `${rotation - 90}deg` }],
                  }}
                />
              </View>
            );
          });
        })()}

        {/* Center content */}
        <View
          style={{
            width: size * 0.6,
            height: size * 0.6,
            borderRadius: (size * 0.6) / 2,
          }}
          className="bg-background items-center justify-center"
        >
          {centerValue && (
            <Text className="text-lg font-bold text-foreground">
              {centerValue}
            </Text>
          )}
          {centerLabel && (
            <Text className="text-label text-faint-foreground">{centerLabel}</Text>
          )}
        </View>
      </View>

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
