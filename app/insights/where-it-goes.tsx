import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ScreenContainer, Segmented } from "@/components/ui";
import { BillsSummaryCard } from "@/components/insights/BillsSummaryCard";
import MerchantAnalyticsScreen from "./merchants";
import PatternLibraryScreen from "./patterns";

type Tab = "merchants" | "regulars";

/**
 * Insights → Where it goes (docs/INSIGHTS_STREAMLINE_PROPOSAL.md §2.1): Merchants and Patterns
 * on one screen, as two tabs. Merchants is where money goes by place; Regulars is by habit, with
 * bills and subscriptions on top. Each tab is the screen it always was.
 */
export default function WhereItGoesScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === "regulars" ? "regulars" : "merchants");
  return (
    <ScreenContainer padTop={false}>
      <Segmented
        className="mx-4 mt-2"
        value={tab}
        onChange={setTab}
        options={[
          { value: "merchants", label: "Merchants" },
          { value: "regulars", label: "Regulars" },
        ]}
      />
      <View style={{ flex: 1 }}>
        {tab === "merchants" ? (
          <MerchantAnalyticsScreen />
        ) : (
          <>
            <BillsSummaryCard />
            <View style={{ flex: 1 }}>
              <PatternLibraryScreen />
            </View>
          </>
        )}
      </View>
    </ScreenContainer>
  );
}
