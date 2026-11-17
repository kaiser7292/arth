import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./Text";
import { SectionTitle } from "./SectionTitle";
import { useTheme } from "@/hooks/use-theme";

/**
 * The one form pattern (canvas note "forms"): grouped cards, each headed by a SectionTitle;
 * optional groups folded into a row that says what they hold; a light pinned footer with Cancel
 * and one verb.
 */

/** A group of fields in a card, headed by its SectionTitle. */
export function FormGroup({
  icon,
  title,
  hint,
  right,
  children,
  className = "",
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <View className={`rounded-card bg-card border border-border p-4 ${className}`} style={{ gap: 12 }}>
      <SectionTitle icon={icon} title={title} hint={hint} right={right} />
      {children}
    </View>
  );
}

/**
 * An optional group, folded: one row that says what it holds ("Optional · 3 fields"). Tapping it
 * opens the fields in place. Never used to hide a required field.
 */
export function FoldGroup({
  title,
  sub,
  children,
  defaultOpen = false,
  icon,
}: {
  title: string;
  sub: string;
  children: ReactNode;
  defaultOpen?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View className="rounded-card bg-card border border-border overflow-hidden">
      <Pressable
        onPress={() => setOpen((o) => !o)}
        className="flex-row items-center px-4"
        style={{ minHeight: 60, gap: 12 }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}, ${sub}`}
      >
        {icon ? (
          <View className="w-8 h-8 rounded-control items-center justify-center" style={{ backgroundColor: theme.alpha("foreground", 0.06) }}>
            <Ionicons name={icon} size={17} color={theme.mutedForeground} />
          </View>
        ) : null}
        <View className="flex-1">
          <Text className="text-body font-semibold text-foreground" numberOfLines={1}>
            {title}
          </Text>
          <Text className="text-meta text-muted-foreground" numberOfLines={1}>
            {sub}
          </Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={theme.mutedForeground} />
      </Pressable>
      {open ? (
        <View className="px-4 pb-4 pt-1 border-t border-border" style={{ gap: 12 }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The pinned footer: light (card colour, top border), never dark. Cancel on the left, the one
 * verb on the right ("Save loan", "Record ₹6,500"). Put it after the ScrollView, not inside it.
 */
export function FormFooter({
  primary,
  onPrimary,
  onCancel,
  cancelLabel = "Cancel",
  disabled = false,
  danger = false,
  extra,
}: {
  primary: string;
  onPrimary: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
  disabled?: boolean;
  /** The verb destroys something (Delete forever): the button turns red. */
  danger?: boolean;
  /** Something above the buttons, e.g. a total. */
  extra?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const fill = danger ? theme.danger : theme.primary;
  return (
    <View
      className="bg-card border-t border-border px-4 pt-3"
      style={{ paddingBottom: Math.max(insets.bottom, 12), gap: 10 }}
    >
      {extra}
      <View className="flex-row" style={{ gap: 10 }}>
        {onCancel ? (
          <Pressable
            onPress={onCancel}
            className="flex-1 rounded-pill border border-border bg-card items-center justify-center"
            style={{ height: 48 }}
            accessibilityRole="button"
            accessibilityLabel={cancelLabel}
          >
            <Text className="text-body font-semibold text-foreground" numberOfLines={1}>
              {cancelLabel}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onPrimary}
          disabled={disabled}
          className="rounded-pill items-center justify-center px-4"
          style={{ height: 48, flex: onCancel ? 2 : 1, backgroundColor: fill, opacity: disabled ? 0.5 : 1 }}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          accessibilityLabel={primary}
        >
          <Text className="text-body font-bold" style={{ color: danger ? "#FFFFFF" : theme.primaryForeground }} numberOfLines={1}>
            {primary}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
