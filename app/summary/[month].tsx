import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { PeriodNavigator, ScreenContainer } from "@/components/ui";
import { MonthlySummaryPage } from "@/components/budget/MonthlySummaryPage";
import { getCurrentMonth } from "@/services/budget";

/**
 * Monthly summary route.
 *
 * The summary lives in MonthlySummaryPage, which the Budget tab's swipe-pager also renders. This
 * file was a ~330-line near-copy. It now owns only the month, which arrives as a URL param and is
 * then steppable here - the pager instead inherits the Budget tab's month.
 */
export default function MonthlySummaryScreen() {
  const { month: monthParam } = useLocalSearchParams<{ month: string }>();
  const [month, setMonth] = useState(monthParam ?? getCurrentMonth());

  return (
    <ScreenContainer padTop={false}>
      <PeriodNavigator mode="month" value={month} onChange={setMonth} />
      <MonthlySummaryPage month={month} />
    </ScreenContainer>
  );
}
