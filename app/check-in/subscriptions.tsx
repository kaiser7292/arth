import { useCallback } from "react";
import { View } from "react-native";
import { CheckInDeck, DeckHeadline, DeckRow } from "@/components/check-in/CheckInDeck";
import { Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import type { SubscriptionItem } from "@/services/subscription-check";
import {
  getSubscriptionCheckItems,
  keepSubscription,
  notASubscription,
  requestCancelSubscription,
} from "@/services/subscription-check";
import { formatDateForDisplay } from "@/utils/expense-validation";
import { formatAmount } from "@/utils/format";

const FREQUENCY_LABEL: Record<string, string> = {
  weekly: "Every week",
  monthly: "Every month",
  last_day_of_month: "Every month (last day)",
  nth_weekday: "Every month",
  quarterly: "Every 3 months",
  yearly: "Every year",
};

const REASON_KICKER = {
  new: "New subscription spotted",
  still_charging: "Still charging you",
  periodic: "Still worth it?",
} as const;

/** Subscription check: keep, or mark to cancel, each detected recurring payment. */
export default function SubscriptionCheckScreen() {
  const theme = useTheme();
  const load = useCallback(() => getSubscriptionCheckItems(DEFAULT_USER_ID), []);

  return (
    <CheckInDeck<SubscriptionItem>
      title="Subscriptions"
      loadItems={load}
      keyOf={(i) => i.sub.id}
      renderCard={({ sub, reason, yearlyCost }) => (
        <View className="flex-1">
          <DeckHeadline
            kicker={REASON_KICKER[reason]}
            title={sub.merchant_normalized}
            subtitle={`${formatAmount(sub.amount)} · ${FREQUENCY_LABEL[sub.frequency] ?? sub.frequency}`}
          />
          <View className="items-center mb-4">
            <Text className="text-3xl font-bold text-foreground">{formatAmount(yearlyCost)}</Text>
            <Text className="text-xs text-muted-foreground mt-0.5">roughly per year</Text>
          </View>
          <DeckRow label="Last charged" value={formatDateForDisplay(sub.last_seen_date)} />
          {sub.next_expected_date ? (
            <DeckRow label="Next expected" value={formatDateForDisplay(sub.next_expected_date)} />
          ) : null}
          <DeckRow label="Times seen" value={String(sub.occurrence_count)} />
          {reason === "still_charging" && sub.cancel_requested_at ? (
            <Text className="text-sm text-center mt-4" style={{ color: theme.danger }}>
              You marked this to cancel on {formatDateForDisplay(sub.cancel_requested_at.slice(0, 10))}, but it charged
              again. Check it's really cancelled with the provider.
            </Text>
          ) : null}
        </View>
      )}
      primary={{
        label: "Keep",
        icon: "checkmark",
        onPress: (i) => ({
          run: () => keepSubscription(i.sub.id),
          message: `Keeping ${i.sub.merchant_normalized}`,
          outcome: "Kept",
        }),
      }}
      secondary={[
        {
          label: "Cancel this",
          icon: "close-circle-outline",
          role: "danger",
          onPress: (i) => ({
            run: () => requestCancelSubscription(i.sub.id),
            message: `Marked ${i.sub.merchant_normalized} to cancel. Arth will flag it if it charges again.`,
            outcome: "To cancel",
            tone: "danger",
          }),
        },
        {
          label: "Not a subscription",
          icon: "remove-circle-outline",
          role: "mutedForeground",
          onPress: (i) => ({
            run: () => notASubscription(i.sub.id),
            message: "Removed from subscriptions",
            outcome: "Removed",
            tone: "neutral",
          }),
        },
      ]}
      doneTitle="Subscriptions reviewed"
      emptyTitle="Nothing to review"
      emptySubtitle="New subscriptions, ones you marked to cancel that are still charging, and anything not reviewed in 3 months show up here."
    />
  );
}
