import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Text } from "./Text";
import { useTheme } from "@/hooks/use-theme";
import { tint } from "@/constants/brand";
import { COMPONENTS, type SemanticRole } from "@/constants/design-tokens";

export type ChipVariant = "choice" | "removable" | "category" | "add" | "status";
export type ChipTone = "neutral" | "primary" | "success" | "warning" | "danger" | "accent" | "transfer";

export interface ChipProps {
  label: string;
  /**
   * - `choice`    a filter or option that turns on and off (36px)
   * - `removable` an applied filter, shown on, with a ✕ that removes it (36px)
   * - `category`  a category inside a row, in the category's own colour (24px)
   * - `add`       the dashed "+ Add category" prompt (24px)
   * - `status`    one status word in a row: "Needs review", "Refunded" (24px, sentence case)
   */
  variant?: ChipVariant;
  /** choice only: is it on. */
  on?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  /** A small colour dot before the label (tags). */
  dot?: string;
  /** category: the category's own colour (hex or channels). */
  color?: string;
  /** status: which semantic colour. */
  tone?: ChipTone;
  accessibilityLabel?: string;
  className?: string;
}

const ROLE: Record<Exclude<ChipTone, "transfer">, SemanticRole> = {
  neutral: "mutedForeground",
  primary: "primary",
  success: "success",
  warning: "warning",
  danger: "danger",
  accent: "accent",
};

/**
 * The one chip. Replaces the filter sheet's private Chip, the hand-made row badges and the
 * inline "rounded-full px-2" pills. Shape comes from COMPONENTS.chip; colour from the theme.
 */
export function Chip({
  label,
  variant = "choice",
  on = false,
  onPress,
  onLongPress,
  icon,
  dot,
  color,
  tone = "neutral",
  accessibilityLabel,
  className = "",
}: ChipProps) {
  const theme = useTheme();
  const big = variant === "choice" || variant === "removable";
  const S = big ? COMPONENTS.chip.choice : COMPONENTS.chip.inline;

  let fg: string;
  let bg: string;
  let border: string | undefined;
  if (variant === "choice") {
    fg = on ? theme.primary : theme.foreground;
    bg = on ? theme.alpha("primary", 0.1) : theme.card;
    border = on ? theme.primary : theme.border;
  } else if (variant === "removable") {
    fg = theme.primary;
    bg = theme.alpha("primary", 0.1);
    border = theme.primary;
  } else if (variant === "category") {
    const c = color ?? theme.mutedForeground;
    fg = c;
    bg = tint(c, COMPONENTS.badge.tintAlpha);
  } else if (variant === "add") {
    fg = theme.primary;
    bg = "transparent";
    border = theme.primary;
  } else {
    const c = tone === "transfer" ? theme.data.transfer : theme[ROLE[tone]];
    fg = c;
    bg = tone === "transfer" ? tint(c, COMPONENTS.badge.tintAlpha) : theme.alpha(ROLE[tone], COMPONENTS.badge.tintAlpha);
  }

  const leading: ReactNode = dot ? (
    <View className="rounded-pill mr-1.5" style={{ width: 8, height: 8, backgroundColor: dot }} />
  ) : icon || variant === "add" ? (
    <Ionicons name={icon ?? "add"} size={S.icon} color={fg} style={{ marginRight: 4 }} />
  ) : null;

  const body = (
    <>
      {leading}
      <Text className={S.label} style={{ color: fg }} numberOfLines={1}>
        {label}
      </Text>
      {variant === "removable" ? <Ionicons name="close" size={14} color={fg} style={{ marginLeft: 4 }} /> : null}
    </>
  );

  const cls = `${S.base} ${border ? (variant === "add" ? COMPONENTS.chip.add : "border") : ""} ${className}`;
  const style = { backgroundColor: bg, borderColor: border };

  if (!onPress && !onLongPress) {
    return (
      <View className={cls} style={style} accessibilityLabel={accessibilityLabel}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={big ? 0 : 8}
      className={cls}
      style={style}
      accessibilityRole="button"
      accessibilityState={variant === "choice" ? { selected: on } : undefined}
      accessibilityLabel={accessibilityLabel ?? (variant === "removable" ? `Remove ${label}` : label)}
    >
      {body}
    </Pressable>
  );
}

/** Lays chips out in wrapping rows with the standard gap. */
export function ChipWrap({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <View className={`flex-row flex-wrap ${className}`} style={{ gap: 8 }}>
      {children}
    </View>
  );
}
