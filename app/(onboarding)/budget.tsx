import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { OnboardingStep } from "@/components/onboarding/OnboardingStep";
import { Input, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useAlert } from "@/hooks/use-alert";
import { upsertBudget } from "@/services/budget";
import { getCategories, type Category } from "@/services/category";
import { getSalaryProfileByFY } from "@/services/salary-profile";
import { getFYStartMonth } from "@/services/settings";
import { getErrorMessage } from "@/utils/error-message";
import { formatAmount } from "@/utils/format";
import { getCurrentFY, monthsToFYEnd } from "@/utils/fiscal-year";

/** The everyday categories worth a budget on day one, if the user kept them. */
const SUGGESTED = ["Food", "Grocery & Supplies", "Travel & Going Out", "Shopping & Gifts", "Rent & Utilities", "Subscriptions"];

/** Onboarding: quick monthly budgets for the main categories. Optional. */
export default function OnboardingBudget() {
  const router = useRouter();
  const alert = useAlert();
  const [categories, setCategories] = useState<Category[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [income, setIncome] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const cats = await getCategories(DEFAULT_USER_ID);
      setCategories(SUGGESTED.map((n) => cats.find((c) => c.name === n)).filter((c): c is Category => c != null));
      const profile = await getSalaryProfileByFY(DEFAULT_USER_ID, String(getCurrentFY(getFYStartMonth())));
      setIncome(profile?.computed_monthly_in_hand ?? 0);
    })().catch(() => {});
  }, []);

  const parse = (v: string | undefined) => Number((v ?? "").replace(/[,\s₹]/g, "")) || 0;
  const total = useMemo(() => categories.reduce((s, c) => s + parse(amounts[c.id]), 0), [categories, amounts]);
  const next = () => router.push("/(onboarding)/protect");

  const save = async () => {
    setSaving(true);
    try {
      const months = monthsToFYEnd(new Date(), getFYStartMonth());
      for (const c of categories) {
        const amount = parse(amounts[c.id]);
        if (amount <= 0) continue;
        for (const month of months) {
          await upsertBudget({ user_id: DEFAULT_USER_ID, category_id: c.id, month, amount });
        }
      }
      next();
    } catch (e) {
      alert("Couldn't save", getErrorMessage(e, "Please try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <OnboardingStep
      icon="pie-chart-outline"
      title="A monthly budget"
      subtitle="Set rough limits for where most of your money goes. Arth tracks them every month and warns you before you go over. Leave any blank, and fine-tune later in Settings → Budget Configuration."
      onPrimary={save}
      primaryLoading={saving}
      primaryDisabled={total <= 0}
      primaryLabel="Save budgets"
      onSkipStep={next}
    >
      {categories.map((c) => (
        <View key={c.id} className="flex-row items-center mb-3" style={{ gap: 12 }}>
          <Text className="flex-1 text-sm text-foreground">{c.name}</Text>
          <View style={{ width: 140 }}>
            <Input
              placeholder="₹ per month"
              value={amounts[c.id] ?? ""}
              onChangeText={(v) => setAmounts((prev) => ({ ...prev, [c.id]: v }))}
              keyboardType="numeric"
            />
          </View>
        </View>
      ))}
      {total > 0 ? (
        <Text className="text-sm text-muted-foreground mt-2">
          Total {formatAmount(total)} a month
          {income > 0 ? ` · ${Math.round((total / income) * 100)}% of your take-home pay` : ""}
        </Text>
      ) : null}
    </OnboardingStep>
  );
}
