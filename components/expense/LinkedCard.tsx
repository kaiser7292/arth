import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui";
import { COMPONENTS } from "@/constants/design-tokens";
import { tint } from "@/constants/brand";
import { useTheme } from "@/hooks/use-theme";

export interface LinkedCardAction {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  /** The main thing to do here: filled. Others are outlined. */
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * What a transaction is linked to (a transfer, an FD, a settlement, a refund, an investment, a
 * loan, a split purchase), drawn the same way as the What / Where / Source cards: the small
 * uppercase heading, a lead line with its icon, label-and-value rows, then pill actions.
 *
 *   <LinkedCard heading="Transfer" icon="swap-horizontal" title="Moved to Savings ··4821"
 *     actions={[{ label: "Undo transfer", onPress: undo }]}>
 *     <FieldRow divider={false} label="From" value="HDFC ··1093" />
 *   </LinkedCard>
 */
export function LinkedCard({
  heading,
  icon,
  color,
  title,
  subtitle,
  onPressTitle,
  right,
  children,
  actions = [],
  note,
}: {
  heading: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** The lead icon's colour; defaults to primary. */
  color?: string;
  title: string;
  subtitle?: string | null;
  /** Opens what it's linked to (the FD account, the loan, the person's ledger). */
  onPressTitle?: () => void;
  /** On the right of the lead line, e.g. a total. */
  right?: ReactNode;
  /** FieldRows (or anything) under the lead line. */
  children?: ReactNode;
  actions?: LinkedCardAction[];
  /** A quiet line at the bottom, e.g. why Undo isn't offered. */
  note?: string | null;
}) {
  const theme = useTheme();
  const c = color ?? theme.primary;
  const lead = (
    <View className="flex-row items-center py-2" style={{ minHeight: 56 }}>
      <View className="w-10 h-10 rounded-control items-center justify-center mr-3" style={{ backgroundColor: tint(c, 0.12) }}>
        <Ionicons name={icon} size={20} color={c} />
      </View>
      <View className="flex-1">
        <Text className="text-body font-semibold text-foreground" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? <Text className="text-meta text-muted-foreground mt-0.5">{subtitle}</Text> : null}
      </View>
      {right}
      {onPressTitle ? <Ionicons name="chevron-forward" size={16} color={theme.faintForeground} style={{ marginLeft: 6 }} /> : null}
    </View>
  );
  return (
    <View className="mx-4 mt-3 rounded-card bg-card border border-border px-4 pb-3">
      <Text className={COMPONENTS.cardHeading} accessibilityRole="header">
        {heading}
      </Text>
      {onPressTitle ? (
        <Pressable onPress={onPressTitle} accessibilityRole="button" accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}>
          {lead}
        </Pressable>
      ) : (
        lead
      )}
      {children}
      {actions.length > 0 && (
        <View className="flex-row flex-wrap pt-3" style={{ gap: 8 }}>
          {actions.map((a) => {
            const fg = a.primary ? theme.primaryForeground : a.danger ? theme.danger : theme.primary;
            return (
              <Pressable
                key={a.label}
                onPress={a.onPress}
                disabled={a.disabled}
                className={`flex-row items-center justify-center rounded-pill px-4 ${a.primary ? "" : "border"}`}
                style={{
                  minHeight: 40,
                  backgroundColor: a.primary ? theme.primary : theme.card,
                  borderColor: a.danger ? theme.danger : theme.border,
                  opacity: a.disabled ? 0.5 : 1,
                }}
                accessibilityRole="button"
                accessibilityLabel={a.label}
              >
                {a.icon ? <Ionicons name={a.icon} size={16} color={fg} style={{ marginRight: 6 }} /> : null}
                <Text className="text-meta font-semibold" style={{ color: fg }}>
                  {a.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {note ? <Text className="text-meta text-muted-foreground pt-3">{note}</Text> : null}
    </View>
  );
}
