import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, Text } from "@/components/ui";
import { AccountTypeIcon } from "@/components/ui/AccountTypeIcon";
import { enterUp } from "@/components/motion/motion";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount } from "@/utils/format";

export interface HomeTileProps {
  icon: keyof typeof Ionicons.glyphMap;
  /** An account tile: draw the boards' account-type icon instead of `icon`. */
  accountType?: string;
  label: string;
  /** The one figure the tile is about. */
  value: number;
  /** "danger" for money owed, etc. Default: plain. */
  tone?: "default" | "success" | "danger" | "warning";
  /** One short line under the figure. */
  sub?: string;
  subTone?: "muted" | "success" | "danger" | "warning";
  /** 0–1, drawn as a thin bar (card utilisation, loan paid off…). */
  progress?: number;
  progressTone?: "primary" | "success" | "warning" | "danger";
  /** Place among the tiles arriving together, for the stagger. */
  index?: number;
  onPress: () => void;
  accessibilityLabel?: string;
}

const COUNT_MS = 700;

/**
 * Counts up from 0 to the figure the first time it's shown, then follows changes directly. Skipped
 * when the phone asks for reduced motion.
 */
function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const played = useRef(false);
  useEffect(() => {
    if (played.current) {
      setShown(target);
      return;
    }
    played.current = true;
    let raf = 0;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled || reduce || target === 0) {
          setShown(target);
          return;
        }
        const start = Date.now();
        const step = () => {
          const p = Math.min(1, (Date.now() - start) / COUNT_MS);
          setShown(target * (1 - Math.pow(1 - p, 3)));
          if (p < 1) raf = requestAnimationFrame(step);
        };
        setShown(0);
        raf = requestAnimationFrame(step);
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [target]);
  return shown;
}

/**
 * One account or people-and-money summary on Home, two to a row: an icon and name, one big figure,
 * one line of context and an optional bar. Tapping opens the full screen the old card opened.
 */
export function HomeTile({
  icon,
  accountType,
  label,
  value,
  tone = "default",
  sub,
  subTone = "muted",
  progress,
  progressTone = "primary",
  index = 0,
  onPress,
  accessibilityLabel,
}: HomeTileProps) {
  const theme = useTheme();
  const shown = useCountUp(value);
  const toneColor = { default: theme.foreground, success: theme.success, danger: theme.danger, warning: theme.warning }[tone];
  const subColor = { muted: theme.mutedForeground, success: theme.success, danger: theme.danger, warning: theme.warning }[subTone];
  const barColor = { primary: theme.primary, success: theme.success, warning: theme.warning, danger: theme.danger }[progressTone];

  return (
    <Animated.View entering={enterUp(index)} style={{ flexBasis: "46%", flexGrow: 1 }}>
      <Pressable
        onPress={onPress}
        style={{ flex: 1 }}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? `${label}, ${formatAmount(value)}${sub ? `, ${sub}` : ""}`}
      >
        <Card className="py-3 px-3 flex-1">
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <View className="w-8 h-8 rounded-control items-center justify-center" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
              {accountType ? (
                <AccountTypeIcon type={accountType} size={17} color={theme.primary} />
              ) : (
                <Ionicons name={icon} size={17} color={theme.primary} />
              )}
            </View>
            <Text className="text-meta font-semibold text-muted-foreground flex-1" numberOfLines={1}>
              {label}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
          </View>
          <Text className="text-heading font-bold mt-2.5" style={{ color: toneColor }} numberOfLines={1} adjustsFontSizeToFit>
            {formatAmount(Math.round(shown))}
          </Text>
          {sub ? (
            <Text className="text-label mt-0.5" style={{ color: subColor }} numberOfLines={2}>
              {sub}
            </Text>
          ) : null}
          {progress != null && (
            <View className="h-1 rounded-full overflow-hidden mt-2.5" style={{ backgroundColor: theme.alpha("foreground", 0.08) }}>
              <View className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%`, backgroundColor: barColor }} />
            </View>
          )}
        </Card>
      </Pressable>
    </Animated.View>
  );
}
