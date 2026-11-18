import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";
import { Card, GroupHeading, Money, Text } from "@/components/ui";
import { Statement } from "@/components/ui/LinkRow";
import { tint } from "@/constants/brand";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount } from "@/utils/format";
import { Frame } from "../preview-kit/Frame";

/** Website screenshot: an account ledger with the balance after each row. Invented data. */
export default function ShotLedger() {
  const theme = useTheme();
  const rows: { t: string; meta: string; amt: number; bal: number; kind: "out" | "in" | "transfer"; day: string }[] = [
    { t: "BigBasket", meta: "Groceries", amt: -1284, bal: 142380, kind: "out", day: "Today · 18 Nov" },
    { t: "To ICICI card", meta: "Transfer", amt: -10000, bal: 143664, kind: "transfer", day: "12 Nov" },
    { t: "Salary", meta: "Credit", amt: 96400, bal: 153664, kind: "in", day: "1 Nov" },
    { t: "Rent", meta: "Rent", amt: -28000, bal: 57264, kind: "out", day: "1 Nov" },
  ];
  return (
    <Frame title="HDFC ****4821" back icons={["settings-outline"]}>
      <View className="flex-row items-center justify-center py-1" style={{ gap: 16 }}>
        <Ionicons name="chevron-back" size={18} color={theme.mutedForeground} />
        <Text className="text-body font-semibold text-foreground">Nov 2026</Text>
        <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
      </View>
      <Card className="mx-4 mt-2 mb-2">
        <Text className="text-meta text-muted-foreground">Closing balance</Text>
        <Money value={142380} className="text-hero font-bold text-foreground" />
        <Statement
          lines={[
            { label: "Opening balance · 1 Nov", amount: formatAmount(85264) },
            { label: "Money in · 1 credit", sign: "+", amount: formatAmount(96400) },
            { label: "Money out · 14 expenses", sign: "−", amount: formatAmount(29284) },
            { label: "Transfers out · 1", sign: "−", amount: formatAmount(10000) },
          ]}
          total={{ label: "Closing balance · today", amount: formatAmount(142380) }}
        />
      </Card>
      {["Today · 18 Nov", "12 Nov", "1 Nov"].map((day) => {
        const list = rows.filter((r) => r.day === day);
        return (
          <View key={day}>
            <GroupHeading label={day} count={list.length} total={list.reduce((s, r) => s + r.amt, 0)} open onToggle={() => {}} noun={{ one: "transaction", many: "transactions" }} />
            <View className="mx-4 bg-card border-x border-b border-border overflow-hidden" style={{ borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }}>
              {list.map((r, i) => {
                const c = r.kind === "transfer" ? theme.data.transfer : r.kind === "in" ? theme.success : theme.mutedForeground;
                return (
                  <View key={r.t} className={`flex-row items-start px-4 py-3 ${i > 0 ? "border-t border-border" : ""}`}>
                    <View className="w-10 h-10 rounded-control items-center justify-center mr-3" style={{ backgroundColor: tint(c, 0.12) }}>
                      <Ionicons name={r.kind === "transfer" ? "swap-horizontal" : r.kind === "in" ? "arrow-down-outline" : "arrow-up-outline"} size={20} color={c} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-body font-semibold text-foreground">{r.t}</Text>
                      <Text className="text-meta text-muted-foreground mt-0.5">{r.meta}</Text>
                    </View>
                    <View className="items-end">
                      <Money value={r.amt} showPlus={r.amt > 0} className="text-body font-bold" style={{ color: r.kind === "transfer" ? theme.data.transfer : r.kind === "in" ? theme.success : theme.foreground }} />
                      <Text className="text-label text-muted-foreground mt-0.5">{formatAmount(r.bal)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </Frame>
  );
}
