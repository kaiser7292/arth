import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { Card, Text } from "@/components/ui";
import { Avatar } from "@/components/household/HouseholdBits";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount } from "@/utils/format";
import type { StatementRow } from "@/services/household/statement";

const SPLIT_LABEL: Record<string, string> = { equal: "split equally", payer_all: "shared, paid in full", custom: "custom split" };

export function dayLabel(date: string): string {
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (date === iso(today)) return "Today";
  if (date === iso(y)) return "Yesterday";
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/**
 * The household's statement rows, grouped by day: who paid, what, and what it means between you
 * ("you owe ₹1,150"). Your own rows open their transaction.
 */
export function StatementList({ rows, empty }: { rows: StatementRow[]; empty: string }) {
  const router = useRouter();
  const theme = useTheme();
  const groups: { date: string; rows: StatementRow[] }[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === r.date) last.rows.push(r);
    else groups.push({ date: r.date, rows: [r] });
  }

  if (groups.length === 0) {
    return (
      <Card>
        <Text className="text-sm text-muted-foreground">{empty}</Text>
      </Card>
    );
  }

  return (
    <>
      {groups.map((g) => (
        <View key={g.date} className="mb-2">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-2 mb-1">{dayLabel(g.date)}</Text>
          <Card>
            {g.rows.map((r, idx) => (
              <Pressable
                key={r.id}
                disabled={!r.expenseId}
                onPress={() => r.expenseId && router.push(`/expense/${r.expenseId}`)}
                className={`flex-row items-center py-2.5 ${idx < g.rows.length - 1 ? "border-b border-border" : ""}`}
              >
                <Avatar member={r.member} size={28} />
                <View className="flex-1 ml-3 mr-2">
                  <Text className="text-sm text-foreground" numberOfLines={1}>{r.merchant || r.category || "Shared"}</Text>
                  <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                    {r.relation.kind === "settle"
                      ? "Settle-up"
                      : [r.category, r.relation.kind === "personal" ? "personal" : SPLIT_LABEL[r.split ?? "equal"]].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="text-sm text-foreground">{formatAmount(r.paid)}</Text>
                  {r.relation.kind === "you_owe" && <Text className="text-xs" style={{ color: theme.danger }}>you owe {formatAmount(r.relation.amount)}</Text>}
                  {r.relation.kind === "owes_you" && (
                    <Text className="text-xs" style={{ color: theme.primary }}>
                      {r.relation.with} owes {formatAmount(r.relation.amount)}
                    </Text>
                  )}
                </View>
              </Pressable>
            ))}
          </Card>
        </View>
      ))}
    </>
  );
}
