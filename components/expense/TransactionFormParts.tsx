import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { Button, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { CREDIT_KIND_LABELS, CREDIT_KINDS, type CreditKind } from "@/services/expense-types";
import { formatDateForStorage } from "@/utils/expense-validation";

/** What the add/edit form is recording. Maps to nature 'realized' / 'credit', or an account transfer. */
export type TransactionType = "spent" | "received" | "transfer";

export const TYPE_LABEL: Record<TransactionType, { noun: string; amountHint: string }> = {
  spent: { noun: "expense", amountHint: "Money out" },
  received: { noun: "credit", amountHint: "Money in" },
  transfer: { noun: "transfer", amountHint: "Between your accounts" },
};

/** Tone per type: red-ish for money out, green for money in, primary for transfers. */
export function useTypeColor(type: TransactionType): string {
  const theme = useTheme();
  return type === "spent" ? theme.danger : type === "received" ? theme.success : theme.primary;
}

/** Spent · Received · Transfer. */
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
    { t: "spent", label: "Spent" },
    { t: "received", label: "Received" },
    { t: "transfer", label: "Transfer" },
  ];
  return (
    <View className="flex-row rounded-xl p-1 mb-4" style={{ backgroundColor: theme.alpha("foreground", 0.06) }}>
      {options
        .filter((o) => !hidden.includes(o.t))
        .map((o) => {
          const selected = o.t === value;
          const tone = o.t === "spent" ? theme.danger : o.t === "received" ? theme.success : theme.primary;
          return (
            <Pressable
              key={o.t}
              onPress={() => onChange(o.t)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              className="flex-1 items-center py-2 rounded-lg"
              style={selected ? { backgroundColor: theme.card } : undefined}
            >
              <Text
                className={`text-sm ${selected ? "font-semibold" : "font-medium"}`}
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

/** Salary · Interest · Refund · Cashback · Reimbursement · Gift · Other. */
export function CreditKindChips({
  value,
  onChange,
}: {
  value: CreditKind | null;
  onChange: (k: CreditKind | null) => void;
}) {
  const theme = useTheme();
  return (
    <View className="mb-4">
      <Text className="text-sm font-medium text-muted-foreground mb-2">Type</Text>
      <View className="flex-row flex-wrap gap-2">
        {CREDIT_KINDS.map((k) => {
          const selected = k === value;
          return (
            <Pressable
              key={k}
              onPress={() => onChange(selected ? null : k)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              className="px-3 py-1.5 rounded-full border"
              style={
                selected
                  ? { borderColor: theme.success, backgroundColor: theme.alpha("success", 0.12) }
                  : { borderColor: theme.border }
              }
            >
              <Text className="text-sm" style={{ color: selected ? theme.success : theme.mutedForeground }}>
                {CREDIT_KIND_LABELS[k]}
              </Text>
            </Pressable>
          );
        })}
      </View>
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
            <Text className="text-sm" style={{ color: selected ? theme.primary : theme.mutedForeground }}>
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
        className="flex-row items-center justify-between rounded-lg border border-border px-4 py-3"
        style={{ backgroundColor: theme.alpha("foreground", 0.03) }}
      >
        <Text className="text-sm text-muted-foreground flex-1" numberOfLines={1}>
          More options{open ? "" : ` · ${summary}`}
        </Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={theme.mutedForeground} />
      </Pressable>
      {open && <View className="mt-4">{children}</View>}
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
