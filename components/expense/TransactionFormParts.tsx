import { useEffect, useState, type ReactNode } from "react";
import { PickerSheet } from "./PickerSheet";
import { FieldButton } from "./ExpenseFormFields";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Chevron } from "@/components/motion/Chevron";
import { Collapse } from "@/components/motion/Collapse";
import { timing } from "@/components/motion/motion";

import { Button, Text, moneyTone } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { RADIUS } from "@/constants/design-tokens";
import { CREDIT_KIND_LABELS, CREDIT_KIND_LOOKS, PICKABLE_CREDIT_KINDS, type CreditKind } from "@/services/expense-types";
import { formatDateForStorage } from "@/utils/expense-validation";

/** The sliding pill sits 4px inside a rounded-control track, so its corner is a little tighter. */
const INNER_RADIUS = parseInt(RADIUS.control, 10) - 2;

/** What the add/edit form is recording. Maps to nature 'realized' / 'credit', or an account transfer. */
export type TransactionType = "spent" | "received" | "transfer";

export const TYPE_LABEL: Record<TransactionType, { noun: string; amountHint: string }> = {
  spent: { noun: "expense", amountHint: "Money out" },
  received: { noun: "credit", amountHint: "Money in" },
  transfer: { noun: "transfer", amountHint: "Between your accounts" },
};

/** Money tone per type: ink for money out (spending is normal, not an alarm), green for in, purple for moved. */
export function useTypeColor(type: TransactionType): string {
  const theme = useTheme();
  return moneyTone(theme, type === "spent" ? "out" : type === "received" ? "in" : "moved").fg;
}

/** Debit · Credit · Transfer. */
export function TransactionTypeSwitch({
  value,
  onChange,
  hidden = [],
}: {
  value: TransactionType;
  onChange: (t: TransactionType) => void;
  /** Types not offered here (e.g. Transfer on a split purchase). */
  hidden?: TransactionType[];
}) {
  const theme = useTheme();
  const options: { t: TransactionType; label: string }[] = [
    { t: "spent", label: "Debit" },
    { t: "received", label: "Credit" },
    { t: "transfer", label: "Transfer" },
  ];
  const shown = options.filter((o) => !hidden.includes(o.t));
  // The selected pill glides between options (equal widths, so one measurement places it).
  const [trackWidth, setTrackWidth] = useState(0);
  const segment = trackWidth > 0 ? (trackWidth - 8) / shown.length : 0;
  const index = Math.max(0, shown.findIndex((o) => o.t === value));
  const left = useSharedValue(0);
  const placed = useSharedValue(0);
  useEffect(() => {
    if (segment <= 0) return;
    const x = 4 + index * segment;
    if (!placed.value) {
      left.value = x;
      placed.value = 1;
    } else left.value = withTiming(x, timing());
  }, [index, segment, left, placed]);
  const pill = useAnimatedStyle(() => ({ left: left.value, opacity: placed.value }));
  return (
    <View
      className="flex-row rounded-control p-1 mb-4"
      style={{ backgroundColor: theme.alpha("foreground", 0.06) }}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (Math.abs(w - trackWidth) > 0.5) setTrackWidth(w);
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[{ position: "absolute", top: 4, bottom: 4, width: segment, borderRadius: INNER_RADIUS, backgroundColor: theme.card }, pill]}
      />
      {shown
        .map((o) => {
          const selected = o.t === value;
          const tone = moneyTone(theme, o.t === "spent" ? "out" : o.t === "received" ? "in" : "moved").fg;
          return (
            <Pressable
              key={o.t}
              onPress={() => onChange(o.t)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              className="flex-1 items-center py-2 rounded-control"
            >
              <Text
                className={`text-body ${selected ? "font-semibold" : "font-medium"}`}
                style={{ color: selected ? tone : theme.mutedForeground }}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
    </View>
  );
}

/** What a credit is: it takes the place of a category, so credits don't have one. */
export function CreditKindChips({
  value,
  onChange,
  row,
  divider,
}: {
  value: CreditKind | null;
  onChange: (k: CreditKind | null) => void;
  /** Show as a row of the form's card. */
  row?: boolean;
  divider?: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const look = value ? CREDIT_KIND_LOOKS[value] : null;
  return (
    <View className={row ? "" : "mb-4"}>
      {row ? (
        <FieldButton
          row={{ label: "Kind of money in", color: theme.success, divider }}
          icon={(look?.icon ?? "arrow-down-outline") as keyof typeof Ionicons.glyphMap}
          on={!!value}
          text={value ? CREDIT_KIND_LABELS[value] : "Salary, refund, interest…"}
          onPress={() => setOpen(true)}
          accessibilityLabel={`Kind of money in${value ? `, ${CREDIT_KIND_LABELS[value]}` : ""}`}
        />
      ) : (
      <>
      <Text className="text-label font-semibold text-muted-foreground mb-1.5">Kind of money in</Text>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center rounded-control border px-4"
        style={{
          minHeight: 48,
          gap: 12,
          borderColor: value ? theme.success : theme.border,
          backgroundColor: value ? theme.alpha("success", 0.08) : theme.card,
        }}
        accessibilityRole="button"
        accessibilityLabel={`Kind of money in${value ? `, ${CREDIT_KIND_LABELS[value]}` : ""}`}
      >
        <Ionicons
          name={(look?.icon ?? "arrow-down-outline") as keyof typeof Ionicons.glyphMap}
          size={18}
          color={value ? theme.success : theme.mutedForeground}
        />
        <Text className={`flex-1 text-body ${value ? "text-foreground" : "text-faint-foreground"}`} numberOfLines={1}>
          {value ? CREDIT_KIND_LABELS[value] : "Salary, refund, interest…"}
        </Text>
        <Ionicons name="chevron-down" size={18} color={theme.mutedForeground} />
      </Pressable>
      </>
      )}
      <PickerSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Kind of money in"
        sections={[
          {
            key: "kinds",
            items: PICKABLE_CREDIT_KINDS.map((k) => ({
              id: k,
              label: CREDIT_KIND_LABELS[k],
              icon: CREDIT_KIND_LOOKS[k].icon as keyof typeof Ionicons.glyphMap,
              color: CREDIT_KIND_LOOKS[k].color,
            })),
          },
        ]}
        selectedId={value}
        onSelect={(id) => {
          setOpen(false);
          onChange((id as CreditKind | null) ?? null);
        }}
        allowNone
        noneLabel="Not set"
        searchPlaceholder="Search kinds"
        noun={{ one: "kind", many: "kinds" }}
      />
    </View>
  );
}

/** Today / Yesterday shortcuts above the full date selector. */
export function DateQuickChips({ date, onSetDate }: { date: string; onSetDate: (d: string) => void }) {
  const theme = useTheme();
  const today = formatDateForStorage(new Date());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = formatDateForStorage(y);
  const chips: [string, string][] = [
    ["Today", today],
    ["Yesterday", yesterday],
  ];
  return (
    <View className="flex-row gap-2 mb-2">
      {chips.map(([label, d]) => {
        const selected = date === d;
        return (
          <Pressable
            key={label}
            onPress={() => onSetDate(d)}
            className="px-3 py-1.5 rounded-full border"
            style={
              selected
                ? { borderColor: theme.primary, backgroundColor: theme.alpha("primary", 0.1) }
                : { borderColor: theme.border }
            }
          >
            <Text className="text-meta" style={{ color: selected ? theme.primary : theme.mutedForeground }}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Folded section for the less-used fields. Shows what's inside while closed. */
export function MoreOptions({
  open,
  onToggle,
  summary,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  summary: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View className="mb-4">
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="flex-row items-center justify-between rounded-control border border-border px-4 py-3"
        style={{ backgroundColor: theme.alpha("foreground", 0.03) }}
      >
        <Text className="text-meta text-muted-foreground flex-1" numberOfLines={1}>
          More options{open ? "" : ` · ${summary}`}
        </Text>
        <Chevron open={open} size={18} color={theme.mutedForeground} />
      </Pressable>
      <Collapse open={open}>
        <View className="pt-4">{children}</View>
      </Collapse>
    </View>
  );
}

/** Save button pinned under the scroll area, so it stays visible above the keyboard. */
export function StickySaveBar({
  title,
  onPress,
  loading,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
}) {
  return (
    <View className="px-4 pt-2 pb-4 border-t border-border bg-background">
      <Button title={title} onPress={onPress} loading={loading} />
    </View>
  );
}
