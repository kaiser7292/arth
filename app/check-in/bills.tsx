import { useCallback } from "react";
import { View } from "react-native";
import { CheckInDeck, DeckHeadline, DeckRow } from "@/components/check-in/CheckInDeck";
import { Money, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import type { ExpenseClassificationRow } from "@/services/analytics/classifier";
import { confirmPattern, correctPattern, getPatternsToConfirm } from "@/services/analytics/pattern-learner";
import { EVERY, amountText, dayText } from "@/utils/analytics/pattern-display";
import { formatDateForDisplay } from "@/utils/expense-validation";

/**
 * "Is this a monthly bill?" — payments Arth sees at a steady rhythm. Yes counts it as an
 * expected bill in the month-end projection; No treats it as everyday spending from now on.
 */
export default function BillsCheckScreen() {
  const load = useCallback(() => getPatternsToConfirm(DEFAULT_USER_ID), []);

  return (
    <CheckInDeck<ExpenseClassificationRow>
      id="bills"
      title="Monthly bills"
      loadItems={load}
      keyOf={(c) => c.id}
      renderCard={(c) => (
        <View>
          <DeckHeadline
            kicker="Is this a regular bill?"
            title={c.merchant_normalized}
            subtitle={`${amountText(c)} · ${EVERY[c.frequency ?? "monthly"] ?? c.frequency}`}
          />
          <View className="items-center mt-3 mb-3">
            <Money value={(c.amount_range_low + c.amount_range_high) / 2} className="text-title font-bold text-foreground" />
            <Text className="text-xs text-muted-foreground mt-0.5">{EVERY[c.frequency ?? "monthly"] ?? ""}</Text>
          </View>
          <DeckRow label="Usually" value={dayText(c.expected_day_of_month)} />
          <DeckRow label="Last paid" value={formatDateForDisplay(c.last_seen_date)} />
          <DeckRow label="Times seen" value={`${c.occurrence_count} in the last 6 months`} />
          <Text className="text-xs text-muted-foreground mt-4">
            Bills you confirm are counted in the month-end projection until they&apos;re paid.
          </Text>
        </View>
      )}
      primary={{
        label: "Yes, it's a bill",
        icon: "checkmark",
        onPress: (c) => ({
          run: () => confirmPattern(c.id),
          message: `${c.merchant_normalized} counted as a bill`,
          outcome: "Confirmed",
        }),
      }}
      secondary={[
        {
          label: "No, it varies",
          icon: "shuffle-outline",
          role: "mutedForeground",
          onPress: (c) => ({
            run: () => correctPattern(c.id, "variable"),
            message: `${c.merchant_normalized} treated as everyday spending`,
            outcome: "Varies",
            tone: "neutral",
          }),
        },
      ]}
      emptyIcon="calendar-number-outline"
      emptyTitle="Nothing to confirm"
      emptySubtitle="When Arth spots a payment at a steady rhythm — rent, a subscription, a school fee — it asks here whether it's a regular bill."
    />
  );
}
