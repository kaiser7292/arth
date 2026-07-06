import Svg, { Circle, Line, Rect } from "react-native-svg";

interface VaultIconProps {
  size?: number;
  color?: string;
}

export function VaultIcon({ size = 16, color = "#000" }: VaultIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Safe door body */}
      <Rect
        x="2" y="2" width="20" height="20" rx="3"
        stroke={color} strokeWidth="1.75"
        strokeLinecap="round" strokeLinejoin="round"
      />
      {/* Combination dial */}
      <Circle cx="11" cy="12" r="5" stroke={color} strokeWidth="1.6" />
      {/* Dial indicator line — pointing up-right like a clock at ~11:30 */}
      <Line
        x1="11" y1="12" x2="13.5" y2="8.2"
        stroke={color} strokeWidth="1.5" strokeLinecap="round"
      />
      {/* Center dot */}
      <Circle cx="11" cy="12" r="1.2" fill={color} />
      {/* Door handle — vertical bar on right side */}
      <Line
        x1="19.5" y1="9.5" x2="19.5" y2="14.5"
        stroke={color} strokeWidth="2.2" strokeLinecap="round"
      />
    </Svg>
  );
}
