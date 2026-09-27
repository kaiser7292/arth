import { useEffect } from "react";
import { ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme as useNativeWindColorScheme } from "nativewind";
import { Card, Text } from "@/components/ui";
import { DueRow } from "@/components/home/DueRow";
import { useTheme } from "@/hooks/use-theme";
import type { Expense } from "@/services/expense";
import { todayIso } from "@/utils/date";

/**
 * Preview of Home's Upcoming Dues card with sample data (no database).
 * Open /dues in the preview harness.
 */

const PHONE = 390;

function inDays(n: number): string {
  const d = new Date(`${todayIso()}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const dues = [
  { id: "d1", amount: 79903.94, description: "ICICI credit card bill", due_date: inDays(4), forecast_type: "repayment", raw_source_text: "ICICI Bank Credit Card XX4410 total due Rs 79,903.94" },
  { id: "d2", amount: 9148.2, description: "Axis credit card bill", due_date: inDays(9), forecast_type: "repayment", raw_source_text: "Axis Bank Card ending 8812: total due Rs 9,148.20" },
  { id: "d3", amount: 20003, description: "Axis credit card bill", due_date: inDays(9), forecast_type: "repayment", raw_source_text: "Axis Bank Card ending 1937: total due Rs 20,003" },
  { id: "d4", amount: 649, description: "Netflix via ICICI Bank", due_date: inDays(-2), forecast_type: "expense", raw_source_text: null },
].map((d) => ({ merchant_name: null, ...d }) as unknown as Expense);

const noop = () => {};

export default function DuesPreview() {
  const { setColorScheme } = useNativeWindColorScheme();
  const theme = useTheme();
  useEffect(() => setColorScheme("dark"), [setColorScheme]);

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="py-6" style={{ width: PHONE }}>
        <Card className="mx-4 mt-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-1">
              <Ionicons name="time-outline" size={18} color={theme.warning} />
              <Text className="text-sm font-semibold text-foreground ml-2">Upcoming Dues</Text>
              <View className="ml-2 px-1.5 py-0.5 rounded-full bg-warning/8">
                <Text className="text-xs font-bold" style={{ color: theme.warning }}>
                  {dues.length}
                </Text>
              </View>
            </View>
            <Text className="text-sm font-semibold" style={{ color: theme.warning }}>
              ₹1,09,704.14
            </Text>
          </View>
          <View className="mt-3">
            {dues.map((f) => (
              <View key={f.id} className="border-t border-border">
                <DueRow
                  due={f}
                  onOpen={noop}
                  onMarkAsPaid={noop}
                  onRealiseNow={noop}
                  onDelete={noop}
                  onRepaymentPaid={noop}
                  onPaidExternally={noop}
                />
              </View>
            ))}
          </View>
        </Card>
      </View>
    </ScrollView>
  );
}
