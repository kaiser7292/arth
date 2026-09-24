import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useColorScheme as useNativeWindColorScheme } from "nativewind";
import { Card, Money, Text } from "@/components/ui";
import { DeckCardActions, DeckFooter, DeckHeadline, DeckProgress, DeckRow } from "@/components/check-in/CheckInDeck";
import { CatchUpCardView } from "@/components/expense/catch-up/CatchUpCardView";
import { SwipeDeck } from "@/components/expense/catch-up/SwipeDeck";
import type { CatchUpCard } from "@/services/catch-up";
import type { Expense } from "@/services/expense";

/**
 * Preview of the Catch Up / check-in deck layout with sample data (no database).
 * Open /check-in in the preview harness (npm run preview).
 */

const PHONE = 390;

const credit = {
  id: "x1",
  amount: 50,
  merchant_name: "ACH*IPL FNLDIV 2022 2026*109",
  description: null,
  date: "2026-09-23",
  nature: "credit",
  account_id: null,
  category_id: null,
  raw_source_text:
    "ICICI Bank Account XX322 credited:Rs. 50.00 on 23-Sep-26. Info ACH*IPL FNLDIV 2022 2026*109. Available Balance is Rs. 6,717.29.",
} as unknown as Expense;

const debit = { ...credit, id: "x2", amount: 1240, merchant_name: "Swiggy", nature: "realized" } as unknown as Expense;

const noop = () => {};

function Phone({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="mr-6 mb-6">
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{label}</Text>
      <View className="bg-background border border-border rounded-2xl overflow-hidden" style={{ width: PHONE, height: 760 }}>
        {/* Stand-in for the Stack header the real screen gets from useStackScreenOptions. */}
        <View className="h-14 items-center justify-center">
          <Text style={{ fontWeight: "600", fontSize: 17 }} className="text-foreground">
            {label}
          </Text>
        </View>
        {children}
      </View>
    </View>
  );
}

function Deck({ title, position, total, card, primaryLabel }: { title: string; position: number; total: number; card: React.ReactNode; primaryLabel: string }) {
  const [key, setKey] = useState(0);
  return (
    <Phone label={title}>
      <DeckProgress position={((position - 1 + key) % total) + 1} total={total} />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}>
        <SwipeDeck cardKey={String(key)} onSwipeLeft={() => setKey((k) => k + 1)} onSwipeRight={() => setKey((k) => k + 1)} rightLabel={primaryLabel}>
          {card}
        </SwipeDeck>
        <Text className="text-xs text-faint-foreground text-center mt-3">
          Swipe right to {primaryLabel.toLowerCase()} · left to skip
        </Text>
      </ScrollView>
      <DeckFooter onSkip={() => setKey((k) => k + 1)} primaryLabel={primaryLabel} onPrimary={() => setKey((k) => k + 1)} />
    </Phone>
  );
}

export default function CheckInPreview() {
  const { colorScheme, setColorScheme } = useNativeWindColorScheme();
  const catchUpCard = (e: Expense): CatchUpCard => ({ kind: "pending", key: e.id, expense: e });

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 24 }}>
      <Pressable onPress={() => setColorScheme(colorScheme === "dark" ? "light" : "dark")} className="mb-4">
        <Text className="text-sm font-semibold text-primary">Toggle {colorScheme === "dark" ? "light" : "dark"}</Text>
      </Pressable>
      <View className="flex-row flex-wrap">
        <Deck
          title="Settle up"
          position={1}
          total={2}
          primaryLabel="Remind"
          card={
            <Card>
              <DeckHeadline kicker="Owes you" title="Manoj Kumar Jain" />
              <Money value={169787.37} className="text-title font-bold text-center text-success mt-1" />
              <View className="mt-4">
                <DeckRow label="Last entry" value="Yesterday" />
                <DeckRow label="Entries" value="132" />
                <DeckRow label="Last reminded" value="Never" />
              </View>
              <DeckCardActions
                actions={[
                  { label: "Mark settled", icon: "checkmark-done-outline", onPress: noop },
                  { label: "Open ledger", icon: "list-outline", role: "mutedForeground", onPress: noop },
                ]}
              />
            </Card>
          }
        />
        <Deck
          title="Catch up"
          position={1}
          total={1}
          primaryLabel="Approve"
          card={
            <CatchUpCardView
              card={catchUpCard(credit)}
              categoryMap={new Map()}
              accountMap={new Map()}
              categoryId={null}
              onPickCategory={noop}
              onOpen={noop}
              actions={[
                { label: "Edit, split or add a note", icon: "create-outline", onPress: noop },
                { label: "Reject", icon: "close-circle-outline", role: "danger", onPress: noop },
              ]}
            />
          }
        />
        <Deck
          title="Catch up (debit)"
          position={3}
          total={12}
          primaryLabel="Approve"
          card={
            <CatchUpCardView
              card={catchUpCard(debit)}
              categoryMap={new Map([["food", { id: "food", name: "Food & Dining", icon: "fast-food-outline", color: "#F97316" } as never]])}
              accountMap={new Map()}
              categoryId="food"
              onPickCategory={noop}
              onOpen={noop}
              actions={[
                { label: "Edit, split or add a note", icon: "create-outline", onPress: noop },
                { label: "Reject", icon: "close-circle-outline", role: "danger", onPress: noop },
              ]}
            />
          }
        />
      </View>
    </ScrollView>
  );
}
