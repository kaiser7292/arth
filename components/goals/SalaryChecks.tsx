import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { adoptCreditedSalary, dismissSalaryCheck, getSalaryChecks, type SalaryCheck } from "@/services/salary-periods";
import { formatMonthLabel } from "@/utils/date";
import { formatAmount } from "@/utils/expense-validation";
import { getCurrentFY } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";

/**
 * FYI when salary credited differs from the Income Calculator. It never changes the calculator by
 * itself: the person picks. Self-loading; shows nothing when there's nothing to say.
 */
export function SalaryChecks({
  month,
  financialYear,
  onAdopted,
}: {
  month?: string;
  financialYear?: string;
  /** The calculator screen holds its own copy of these values, so it needs to reload them. */
  onAdopted?: () => void;
}) {
  const router = useRouter();
  const theme = useTheme();
  const [checks, setChecks] = useState<SalaryCheck[]>([]);

  const load = useCallback(async () => {
    const scope = month ? { month } : { financialYear: financialYear ?? String(getCurrentFY(getFYStartMonth())) };
    setChecks(await getSalaryChecks(DEFAULT_USER_ID, scope).catch(() => []));
  }, [month, financialYear]);
  useDataRefresh(load);

  if (checks.length === 0) return null;

  const fyOf = (c: SalaryCheck) => financialYear ?? String(getCurrentFY(getFYStartMonth(), new Date(`${c.month}-15T12:00:00`)));
  const line = (c: SalaryCheck) =>
    c.status === "missing"
      ? `No income found for ${formatMonthLabel(c.month, "long")}. ${formatAmount(c.expected)} expected, so the plan keeps that figure for now.`
      : `${formatMonthLabel(c.month, "long")} income: ${formatAmount(c.credited)} credited, ${formatAmount(c.expected)} expected. ${formatAmount(Math.abs(c.credited - c.expected))} ${c.status === "more" ? "more" : "less"}.`;

  return (
    <Card className="mb-3">
      {checks.map((c, i) => (
        <View key={c.month} className={i > 0 ? "mt-3 pt-3 border-t border-border" : ""}>
          <View className="flex-row items-start">
            <Ionicons name="information-circle-outline" size={18} color={theme.warning} />
            <Text className="text-sm text-foreground ml-2 flex-1">{line(c)}</Text>
          </View>
          <View className="flex-row justify-end mt-2" style={{ gap: 16 }}>
            <Pressable
              onPress={() => {
                dismissSalaryCheck(c.month);
                void load();
              }}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text className="text-xs font-medium text-muted-foreground">Dismiss</Text>
            </Pressable>
            {c.status === "missing" ? (
              <Pressable onPress={() => router.push({ pathname: "/(tabs)/expenses", params: { preset: "credits" } })} hitSlop={8} accessibilityRole="button">
                <Text className="text-xs font-semibold" style={{ color: theme.primary }}>See credits</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={async () => {
                  await adoptCreditedSalary(DEFAULT_USER_ID, fyOf(c), c);
                  await load();
                  onAdopted?.();
                }}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text className="text-xs font-semibold" style={{ color: theme.primary }}>
                  {c.adopts === "month" ? "Update calculator" : "Use as my in-hand"}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}
    </Card>
  );
}
