import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { PeriodNavigator, ScreenContainer } from "@/components/ui";
import { SpendingSplitPage } from "@/components/budget/SpendingSplitPage";
import { getCurrentMonth } from "@/services/budget";

/**
 * Spending split route.
 *
 * The breakdown lives in SpendingSplitPage, which the Budget tab's swipe-pager also renders. This
 * file was a 366-line near-copy of it. All it owns now is the month: the pager inherits the Budget
 * tab's month, while this screen picks its own.
 */
export default function SpendingSplitScreen() {
  const { month: monthParam } = useLocalSearchParams<{ month?: string }>();
  const [month, setMonth] = useState(monthParam ?? getCurrentMonth());

  return (
    <ScreenContainer padTop={false}>
      <PeriodNavigator mode="month" value={month} onChange={setMonth} />
      <SpendingSplitPage month={month} />
    </ScreenContainer>
  );
}
