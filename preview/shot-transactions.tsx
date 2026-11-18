import { View } from "react-native";
import { ExpenseListItem } from "@/components/expense/ExpenseListItem";
import { DrawerBody, DrawerEnd, MonthDrawerHeader } from "@/components/expense/MonthDrawer";
import { Text } from "@/components/ui";
import { UnderlineTabs } from "@/components/ui/LinkRow";
import { useTheme } from "@/hooks/use-theme";
import { Frame } from "../preview-kit/Frame";

/** Website screenshot: Transactions with month headings and short amounts. Invented data. */
const cat = (id: string, name: string, icon: string, color: string) => ({ id, name, icon, color, parent_id: null }) as any;
const CATS = {
  food: cat("food", "Food", "restaurant-outline", "#F97316"),
  groc: cat("groc", "Groceries", "cart-outline", "#16A34A"),
  travel: cat("travel", "Transport", "car-outline", "#8B5CF6"),
  bills: cat("bills", "Bills", "flash-outline", "#2563EB"),
  shop: cat("shop", "Shopping", "bag-handle-outline", "#EC4899"),
};
const UPI = { id: "upi", name: "UPI" } as any;
const CARD = { id: "card", name: "Card" } as any;
const tx = (id: string, merchant: string, amount: number, date: string, nature = "realized") =>
  ({ id, merchant_name: merchant, description: "", amount, date, nature, status: "approved", is_right_spend: 0 }) as any;

const ROWS: { e: any; c?: any; p?: any }[] = [
  { e: tx("1", "Swiggy", 486, "2026-11-18"), c: CATS.food, p: UPI },
  { e: tx("2", "BigBasket", 2140, "2026-11-17"), c: CATS.groc, p: CARD },
  { e: tx("4", "Uber", 312, "2026-11-16"), c: CATS.travel, p: UPI },
  { e: tx("5", "Electricity bill", 1860, "2026-11-12"), c: CATS.bills, p: UPI },
  { e: tx("6", "Amazon", 1299, "2026-11-10"), c: CATS.shop, p: CARD },
  { e: { ...tx("3", "Salary", 92000, "2026-11-01", "credit"), credit_kind: "salary" } },
];

export default function ShotTransactions() {
  const theme = useTheme();
  return (
    <Frame title="Transactions" icons={["search-outline", "eye-outline"]} tab="transactions">
      <UnderlineTabs tabs={[{ value: "all", label: "All" }, { value: "exp", label: "Expenses" }, { value: "cr", label: "Credits" }, { value: "tr", label: "Transfers" }]} value="all" onChange={() => {}} />
      <View className="flex-row items-center justify-between px-4 py-3">
        <View className="rounded-pill border border-border bg-card px-3 justify-center" style={{ height: 34 }}>
          <Text className="text-meta font-semibold text-foreground">Last 12 months ▾</Text>
        </View>
        <Text className="text-meta text-muted-foreground">Dec 2025 – Nov 2026</Text>
      </View>
      <MonthDrawerHeader summary={{ month: "2026-11", spent: 41260, received: 96500, count: 142 }} open mode="all" onToggle={() => {}} />
      <DrawerBody>
        {ROWS.map((r) => (
          <ExpenseListItem key={r.e.id} expense={r.e} category={r.c} paymentMode={r.p} />
        ))}
      </DrawerBody>
      <DrawerEnd />
      <MonthDrawerHeader summary={{ month: "2026-10", spent: 52840, received: 94200, count: 168 }} open={false} mode="all" onToggle={() => {}} />
      <MonthDrawerHeader summary={{ month: "2026-09", spent: 48310, received: 92000, count: 151 }} open={false} mode="all" onToggle={() => {}} />
      <MonthDrawerHeader summary={{ month: "2026-08", spent: 61900, received: 1240000, count: 173 }} open={false} mode="all" onToggle={() => {}} />
      <View style={{ height: 8, backgroundColor: theme.background }} />
    </Frame>
  );
}
