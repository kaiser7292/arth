import { View } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";

interface MiniTrendSparkProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export function MiniTrendSpark({
  data,
  width = 60,
  height = 20,
  color,
}: MiniTrendSparkProps) {
  
  const theme = useTheme();
  const strokeColor = color ?? theme.primary;

  if (data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const padding = 2;
  const drawWidth = width - padding * 2;
  const drawHeight = height - padding * 2;

  const points = data
    .map((val, i) => {
      const x = padding + (i / (data.length - 1)) * drawWidth;
      const y = padding + drawHeight - ((val - min) / range) * drawHeight;
      return `${x},${y}`;
    })
    .join(" ");

  const trend = data[data.length - 1] > data[0] ? "rising" : data[data.length - 1] < data[0] ? "falling" : "flat";

  return (
    <View
      style={{ width, height }}
      accessibilityLabel={`Trend: ${trend} over ${data.length} months`}
    >
      <Svg width={width} height={height}>
        <Polyline
          points={points}
          fill="none"
          stroke={strokeColor}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}
