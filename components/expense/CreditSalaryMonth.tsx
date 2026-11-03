import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Card, PeriodNavigator, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import { getCreditSalaryMonth, setCreditSalaryMonth, shiftMonth } from "@/services/salary-periods";
import { formatMonthLabel } from "@/utils/date";

/** On a salary credit: which month it counts for, for the odd one that lands either side of a month end. */
export function CreditSalaryMonth({ expenseId, date, override }: { expenseId: string; date: string; override: string | null | undefined }) {
  const theme = useTheme();
  const [selected, setSelected] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async (value: string | null | undefined) => {
    const r = await getCreditSalaryMonth(DEFAULT_USER_ID, date, value).catch(() => null);
    if (r) {
      setSelected(r.month);
      setFallback(r.fallback);
    }
  }, [date]);

  useEffect(() => {
    void load(override);
  }, [load, override]);

  if (!selected) return null;
  const own = date.slice(0, 7);
  const options = [shiftMonth(own, -1), own, shiftMonth(own, 1)];
  const choose = async (m: string) => {
    setSelected(m);
    await setCreditSalaryMonth(expenseId, m === fallback ? null : m);
  };
  // Any other month and year, as a fallback for a salary paid well outside its period.
  const elsewhere = !options.includes(selected);

  return (
    <Card className="mt-3">
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Income counts for</Text>
      <View className="flex-row" style={{ gap: 8 }}>
        {options.map((m) => {
          const on = m === selected;
          return (
            <Pressable
              key={m}
              onPress={() => {
                setPicking(false);
                void choose(m);
              }}
              className="flex-1 py-2 rounded-lg items-center border"
              style={{ borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.alpha("primary", 0.1) : "transparent" }}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
            >
              <Text className="text-xs font-medium" style={{ color: on ? theme.primary : theme.mutedForeground }}>{formatMonthLabel(m)}</Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable onPress={() => setPicking((v) => !v)} hitSlop={8} className="mt-2.5" accessibilityRole="button">
        <Text className="text-xs font-medium" style={{ color: theme.primary }}>
          {elsewhere ? `Counts for ${formatMonthLabel(selected, "long")} · change` : "Another month"}
        </Text>
      </Pressable>
      {picking && (
        <View className="mt-2">
          <PeriodNavigator mode="month" value={selected} onChange={(m) => void choose(m)} variant="inline" />
        </View>
      )}
    </Card>
  );
}
