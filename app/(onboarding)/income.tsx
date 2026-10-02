import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { OnboardingStep } from "@/components/onboarding/OnboardingStep";
import { Input, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useAlert } from "@/hooks/use-alert";
import { createSalaryProfile, getSalaryProfileByFY, updateSalaryProfile } from "@/services/salary-profile";
import { getFYStartMonth } from "@/services/settings";
import { getErrorMessage } from "@/utils/error-message";
import { getCurrentFY } from "@/utils/fiscal-year";

/**
 * Onboarding: monthly take-home pay and pay day. Saved as a "direct" salary profile for the
 * current financial year — the same thing Goals → Income Calculator saves — so the yearly plan,
 * savings rate and Goals work from day one. Optional.
 */
export default function OnboardingIncome() {
  const router = useRouter();
  const alert = useAlert();
  const [monthly, setMonthly] = useState("");
  const [payDay, setPayDay] = useState("1");
  const [saving, setSaving] = useState(false);

  const amount = Number(monthly.replace(/[,\s₹]/g, ""));
  const day = Number(payDay);
  const valid = amount > 0 && Number.isInteger(day) && day >= 1 && day <= 31;
  const next = () => router.push("/(onboarding)/sms-consent");

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const fy = String(getCurrentFY(getFYStartMonth()));
      const existing = await getSalaryProfileByFY(DEFAULT_USER_ID, fy);
      if (existing) {
        await updateSalaryProfile(existing.id, {
          input_mode: "direct", computed_monthly_in_hand: amount, salary_credit_day: day, status: "complete",
        });
      } else {
        await createSalaryProfile({
          user_id: DEFAULT_USER_ID, financial_year: fy, input_mode: "direct",
          computed_monthly_in_hand: amount, salary_credit_day: day, status: "complete",
        });
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
      icon="wallet-outline"
      title="Your monthly income"
      subtitle="Your take-home pay powers your savings rate, yearly plan and goals. It stays on your phone. For salary breakdowns and tax, use Goals → Income Calculator later."
      onPrimary={save}
      primaryLoading={saving}
      primaryDisabled={!valid}
      onSkipStep={next}
    >
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Take-home pay per month
      </Text>
      <Input placeholder="e.g. 85000" value={monthly} onChangeText={setMonthly} keyboardType="numeric" />
      <View className="h-4" />
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Day it usually arrives
      </Text>
      <Input placeholder="1 to 31" value={payDay} onChangeText={setPayDay} keyboardType="number-pad" />
      <Text className="text-xs text-muted-foreground mt-3 leading-4">
        Not salaried, or income varies? Skip this step.
      </Text>
    </OnboardingStep>
  );
}
