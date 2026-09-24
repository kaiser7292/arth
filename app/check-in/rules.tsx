import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { CheckInDeck, DeckHeadline } from "@/components/check-in/CheckInDeck";
import { Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import type { Category } from "@/services/category";
import { getCategories } from "@/services/category";
import type { RuleSuggestion } from "@/services/rule-suggestions";
import { createRuleFromSuggestion, dismissRuleSuggestion, getRuleSuggestions } from "@/services/rule-suggestions";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount } from "@/utils/format";

/** Rule suggestions: "You've filed Swiggy as Food 7 times. Make it automatic?" */
export default function RuleSuggestionsScreen() {
  const theme = useTheme();
  const [categories, setCategories] = useState<Map<string, Category>>(new Map());

  useEffect(() => {
    getCategories(DEFAULT_USER_ID)
      .then((cats) => setCategories(new Map(cats.map((c) => [c.id, c]))))
      .catch(() => {});
  }, []);

  const load = useCallback(() => getRuleSuggestions(DEFAULT_USER_ID), []);

  return (
    <CheckInDeck<RuleSuggestion>
      title="Rule suggestions"
      loadItems={load}
      keyOf={(s) => s.key}
      renderCard={(s) => {
        const cat = categories.get(s.categoryId);
        const color = cat?.color ?? theme.mutedForeground;
        const tint = cat ? cat.color + "14" : theme.alpha("mutedForeground", 0.08);
        return (
          <View>
            <DeckHeadline
              kicker="Make it automatic?"
              title={s.merchant}
              subtitle={`You've filed it the same way ${s.count} times (${formatAmount(s.total)})`}
            />
            <View className="items-center mt-4">
              <Ionicons name="arrow-down" size={20} color={color} />
              <View
                className="flex-row items-center mt-2 px-4 py-2 rounded-full"
                style={{ backgroundColor: tint }}
              >
                <Ionicons
                  name={(cat?.icon as keyof typeof Ionicons.glyphMap) ?? "pricetag-outline"}
                  size={16}
                  color={color}
                />
                <Text className="text-base font-semibold ml-1.5" style={{ color }}>
                  {cat?.name ?? "Category"}
                </Text>
              </View>
            </View>
            <Text className="text-xs text-muted-foreground text-center mt-4">
              Creates a Smart Rule: new transactions from a merchant containing "{s.merchant}" go straight
              into {cat?.name ?? "this category"}. You can edit or delete it in Settings → Smart Rules.
            </Text>
          </View>
        );
      }}
      primary={{
        label: "Create rule",
        icon: "flash-outline",
        onPress: (s) => ({
          run: async () => {
            await createRuleFromSuggestion(s, categories.get(s.categoryId)?.name ?? "Category");
          },
          message: `Rule created for ${s.merchant}`,
          outcome: "Created",
        }),
      }}
      secondary={[
        {
          label: "Don't suggest again",
          icon: "eye-off-outline",
          role: "mutedForeground",
          onPress: (s) => ({
            run: async () => dismissRuleSuggestion(s.key),
            message: `Won't suggest ${s.merchant} again`,
            outcome: "Dismissed",
            tone: "neutral",
          }),
        },
      ]}
      doneTitle="All suggestions reviewed"
      emptyIcon="flash-outline"
      emptyTitle="No suggestions right now"
      emptySubtitle="When you file the same merchant under the same category a few times, it shows up here."
    />
  );
}
