import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Share, View } from "react-native";
import { CheckInDeck, DeckHeadline, DeckRow } from "@/components/check-in/CheckInDeck";
import { Money } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import type { HisaabPersonWithBalance } from "@/services/hisaab";
import {
  getLastReminded,
  getPeopleWhoOweYou,
  markReminded,
  markSettled,
  reminderMessage,
} from "@/services/settle-up-check";
import { formatDateForDisplay } from "@/utils/expense-validation";
import { formatAmount } from "@/utils/format";

function daysAgo(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

/** Hisaab settle-up: remind people who owe you, or mark them settled. */
export default function SettleUpScreen() {
  const router = useRouter();
  const load = useCallback(() => getPeopleWhoOweYou(DEFAULT_USER_ID), []);

  return (
    <CheckInDeck<HisaabPersonWithBalance>
      id="settleUp"
      title="Settle up"
      loadItems={load}
      keyOf={(p) => p.id}
      renderCard={(p) => {
        const reminded = getLastReminded(p.id);
        return (
          <View>
            <DeckHeadline kicker="Owes you" title={p.name} />
            <Money value={p.balance} className="text-title font-bold text-center text-success mt-1" />
            <View className="mt-4">
              {p.lastEntryDate ? <DeckRow label="Last entry" value={formatDateForDisplay(p.lastEntryDate)} /> : null}
              <DeckRow label="Entries" value={String(p.entryCount)} />
              <DeckRow label="Last reminded" value={reminded ? daysAgo(reminded) : "Never"} />
            </View>
          </View>
        );
      }}
      primary={{
        label: "Remind",
        icon: "chatbubble-ellipses-outline",
        onPress: (p) => ({
          // Opening the share sheet can't be taken back, so no Undo for this one.
          undoable: false,
          run: async () => {
            await Share.share({ message: reminderMessage(p.name, p.balance, p.lastEntryDate) });
            markReminded(p.id);
          },
          message: `Reminder ready for ${p.name}`,
          outcome: "Reminded",
        }),
      }}
      secondary={[
        {
          label: "Mark settled",
          icon: "checkmark-done-outline",
          role: "primary",
          onPress: (p) => ({
            run: () => markSettled(p),
            message: `${p.name} settled (${formatAmount(p.balance)})`,
            outcome: "Settled",
          }),
        },
        {
          label: "Open ledger",
          icon: "list-outline",
          role: "mutedForeground",
          onPress: (p) => {
            router.push({ pathname: "/hisaab/ledger", params: { personId: p.id, personName: p.name } });
            return null;
          },
        },
      ]}
      emptyIcon="people-outline"
      emptyTitle="Nobody owes you"
      emptySubtitle="People with a balance in your favour in Hisaab show up here."
    />
  );
}
