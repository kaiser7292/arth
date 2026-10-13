import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Text } from "@/components/ui";
import { PatternEditSheet } from "@/components/analytics/PatternEditSheet";
import { PatternLibraryView } from "@/components/analytics/PatternLibraryView";
import type { ExpenseClassificationRow } from "@/services/analytics/classifier";

/**
 * Preview of Insights → Patterns with sample data (no database).
 * Open /patterns in the preview harness (npm run preview).
 */

const PHONE = 390;

const row = (id: string, merchant: string, over: Partial<ExpenseClassificationRow>) =>
  ({
    id,
    user_id: "u",
    merchant_normalized: merchant,
    category_id: "bills",
    amount_range_low: 649,
    amount_range_high: 649,
    classification: "fixed",
    frequency: "monthly",
    expected_day_of_month: 5,
    confidence: 0.85,
    source: "auto_detected",
    occurrence_count: 4,
    last_seen_date: "2026-10-05",
    is_active: 1,
    ...over,
  }) as ExpenseClassificationRow;

const sample = [
  row("1", "netflix", {}),
  row("2", "tata power", { amount_range_low: 1840, amount_range_high: 3120, classification: "semi_fixed", expected_day_of_month: 12 }),
  row("3", "rent sharma", { source: "user_confirmed", amount_range_low: 42000, amount_range_high: 42000, expected_day_of_month: 31, occurrence_count: 6 }),
  row("4", "lic premium", { source: "user_corrected", frequency: "quarterly", amount_range_low: 18250, amount_range_high: 18250, occurrence_count: 2, last_seen_date: "2026-08-14" }),
  row("5", "cult fit", { source: "user_confirmed", is_active: 0, amount_range_low: 1499, amount_range_high: 1499, last_seen_date: "2026-06-02" }),
  row("6", "swiggy", { source: "user_corrected", classification: "variable" }),
];

const noop = () => {};

function Phone({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="mr-6 mb-6">
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{label}</Text>
      <View className="bg-background rounded-2xl border border-border overflow-hidden" style={{ width: PHONE, height: 780 }}>
        {children}
      </View>
    </View>
  );
}

export default function PatternsPreview() {
  const [editing, setEditing] = useState<ExpenseClassificationRow | null>(null);
  return (
    <ScrollView className="flex-1 bg-card" contentContainerStyle={{ padding: 24 }}>
      <View className="flex-row flex-wrap">
        <Phone label="Patterns">
          <PatternLibraryView
            patterns={sample}
            rescanning={false}
            onRescan={noop}
            onConfirm={noop}
            onNotBill={noop}
            onEdit={setEditing}
            onForget={noop}
          />
        </Phone>
        <Phone label="Patterns (empty)">
          <PatternLibraryView
            patterns={[]}
            rescanning={false}
            onRescan={noop}
            onConfirm={noop}
            onNotBill={noop}
            onEdit={noop}
            onForget={noop}
          />
        </Phone>
      </View>
      {editing && (
        <PatternEditSheet visible pattern={editing} onSave={noop} onNotBill={noop} onClose={() => setEditing(null)} />
      )}
    </ScrollView>
  );
}
