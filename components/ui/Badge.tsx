import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { Text } from "./Text";
import { useTheme } from "@/hooks/use-theme";
import { withAlpha } from "@/constants/brand";
import type { SemanticRole } from "@/constants/design-tokens";

export type BadgeVariant =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "accent";

export type BadgeTone = "tint" | "solid" | "outline";

export interface BadgeProps {
  /** number is allowed because counts are a real badge - "3", "12 pending". */
  label: string | number;
  /** Semantic role. Resolves through the theme, so it is correct in both schemes. */
  variant?: BadgeVariant;
  tone?: BadgeTone;
  icon?: keyof typeof Ionicons.glyphMap;
  /** sm is the 11px row-level badge; md is the 13px standalone one. */
  size?: "sm" | "md";
  /**
   * Escape hatch for colour that carries DATA rather than status - a category's own colour, an
   * account's colour. Overrides `variant`. Anything semantic should use variant instead, so it
   * keeps working when the palette changes.
   */
  color?: string;
  /** Uppercase with tracking, for the short status words (FORECAST, REFUNDED, SMS). */
  uppercase?: boolean;
  className?: string;
}

const ROLE_FOR: Record<BadgeVariant, SemanticRole> = {
  neutral: "mutedForeground",
  primary: "primary",
  success: "success",
  warning: "warning",
  danger: "danger",
  accent: "accent",
};

/**
 * A small status or category pill.
 *
 * There were about a hundred of these written inline - `px-2 py-0.5 rounded-full` wrapped round a
 * Text - against eight uses of StatusPill, the primitive that already existed to do exactly this.
 * That gap is why the same idea shipped at four different paddings and three different text sizes.
 *
 * The difference from StatusPill is that colour comes from a semantic `variant` resolved through
 * the theme rather than a hex passed in by the caller, so a badge stays legible when the palette
 * changes and in both colour schemes. `color` remains available for colour that genuinely encodes
 * data, which is the one case a token cannot express.
 *
 * `tint` is the default because these sit inside dense rows, where a solid fill competes with the
 * content it is labelling.
 */
export function Badge({
  label,
  variant = "neutral",
  tone = "tint",
  icon,
  size = "sm",
  color,
  uppercase = false,
  className = "",
}: BadgeProps) {
  const theme = useTheme();
  const role = ROLE_FOR[variant];
  const c = color ?? theme[role];

  const bg =
    tone === "solid"
      ? c
      : tone === "outline"
        ? "transparent"
        : color
          ? withAlpha(color, 0.12)
          : theme.alpha(role, 0.12);
  const fg = tone === "solid" ? theme.primaryForeground : c;

  return (
    <View
      className={`flex-row items-center self-start rounded-full ${
        size === "sm" ? "px-2 py-0.5" : "px-2.5 py-1"
      } ${className}`}
      style={{
        backgroundColor: bg,
        borderWidth: tone === "outline" ? 1 : 0,
        borderColor: tone === "outline" ? c : undefined,
      }}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={size === "sm" ? 10 : 12}
          color={fg}
          style={{ marginRight: 4 }}
        />
      ) : null}
      <Text
        className={`${size === "sm" ? "text-label" : "text-meta"} font-semibold${
          uppercase ? " uppercase tracking-wider" : ""
        }`}
        style={{ color: fg }}
      >
        {label}
      </Text>
    </View>
  );
}
