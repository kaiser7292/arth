import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";

import { Button, Sheet, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import type { BacklogMatch } from "@/services/sms/template-backlog";
import { formatAmount } from "@/utils/format";
import { formatDateForDisplay } from "@/utils/expense-validation";

interface TemplatePreviewSheetProps {
  visible: boolean;
  loading: boolean;
  /** Unread messages from this sender in the look-back window. */
  total: number;
  days: number;
  sender: string;
  matches: BacklogMatch[];
  excluded: ReadonlySet<string>;
  onToggle: (smsId: string) => void;
  saving: boolean;
  saveTitle: string;
  onSave: () => void;
  onClose: () => void;
}

const DIRECTION: Record<string, string> = {
  credit: "Money in",
  upi_credit: "Money in",
  refund: "Refund",
};

/**
 * Before saving a template: every unread message it would read, as Arth would read it, with a
 * tick box each. Unticked ones are left in Unrecognised when the backlog is read.
 */
export function TemplatePreviewSheet({
  visible,
  loading,
  total,
  days,
  sender,
  matches,
  excluded,
  onToggle,
  saving,
  saveTitle,
  onSave,
  onClose,
}: TemplatePreviewSheetProps) {
  const theme = useTheme();
  const anyUnticked = matches.some((m) => excluded.has(m.id));

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="px-4 pb-6">
        <Text className="text-lg font-semibold text-foreground mb-1">
          {loading ? "Checking your messages…" : `This template reads ${matches.length} message${matches.length === 1 ? "" : "s"}`}
        </Text>
        <Text className="text-sm text-muted-foreground mb-3">
          {total} unread from {sender || "this sender"} in the last {days} days. Untick any it reads wrongly.
        </Text>
        {loading ? (
          <View className="py-8 items-center">
            <ActivityIndicator color={theme.primary} />
          </View>
        ) : (
          <ScrollView style={{ maxHeight: 360 }}>
            {matches.length === 0 && (
              <Text className="text-sm text-muted-foreground py-4">
                None of the unread messages match yet. It will still read new ones.
              </Text>
            )}
            {matches.map((m) => {
              const ticked = !excluded.has(m.id);
              const who = m.parsed.counterpartyName || m.parsed.merchant || "—";
              const when = m.parsed.date ?? new Date(m.smsDate).toISOString().slice(0, 10);
              return (
                <Pressable
                  key={m.id}
                  onPress={() => onToggle(m.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: ticked }}
                  className="flex-row items-start py-2.5 border-b border-border"
                >
                  <Ionicons
                    name={ticked ? "checkbox" : "square-outline"}
                    size={20}
                    color={ticked ? theme.primary : theme.mutedForeground}
                  />
                  <View className="flex-1 ml-2.5">
                    <Text className="text-sm text-foreground" numberOfLines={1}>
                      {formatAmount(m.parsed.amount)} · {who} · {formatDateForDisplay(when)}
                    </Text>
                    <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                      {DIRECTION[m.parsed.type] ?? "Money out"} · {m.body}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        {anyUnticked && (
          <View className="mt-3 p-2.5 rounded-lg flex-row" style={{ backgroundColor: theme.alpha("warning", 0.12) }}>
            <Ionicons name="information-circle-outline" size={16} color={theme.warning} />
            <Text className="text-xs ml-2 flex-1 text-foreground">
              Unticked messages stay unread. If future messages like them shouldn't be read either, close this and tap a
              word that only the right messages have, to make it required.
            </Text>
          </View>
        )}
        <View className="mt-4">
          <Button title={saveTitle} onPress={onSave} loading={saving} disabled={loading} />
        </View>
      </View>
    </Sheet>
  );
}
