import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, EmptyState, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getHealthItems, type HealthCheckId, type HealthItems, type HealthTxn } from "@/services/corrections/health";
import { formatDisplayDate } from "@/utils/date";
import { formatAmount } from "@/utils/format";

/**
 * Settings → Fix my data → one health check: exactly what it found. Transactions open to be fixed
 * and drop off this list once they are; groups (duplicates, merchant spellings, merchants in more
 * than one category) show the odd ones out; accounts open their own screen.
 */

const TITLES: Record<HealthCheckId, string> = {
  uncategorised: "Uncategorised",
  no_account: "No account",
  duplicates: "Possible duplicates",
  transfers: "Transfers as spending",
  refunds: "Refunds not linked",
  redemptions: "Money back, unsorted",
  sips: "SIPs not linked",
  balance_gaps: "Bank balance gaps",
  account_types: "Account types",
  merchant_spellings: "Merchant spellings",
  merchant_categories: "Merchant categories",
  overdue_dues: "Overdue dues",
};

/** One line under the title saying what to do with the items. */
const HOW: Record<HealthCheckId, string> = {
  uncategorised: "Tap one to give it a category. A Smart Rule or merchant category stops it happening again.",
  no_account: "Tap one and set which account it came from, so it shows in that account's ledger.",
  duplicates: "Each group is one payment recorded more than once. Open the copy and delete it.",
  transfers: "These look like money moving between your own accounts. Turn them into transfers so they leave your spending.",
  refunds: "Open a refund and link it to the purchase it refunds.",
  redemptions: "Open one and choose the investment it came from, or say it's regular income.",
  sips: "Open one and link it to its investment bucket.",
  balance_gaps: "Open the account's ledger to find what's missing, or match it to the bank from Fix my data.",
  account_types: "Open the account and set the right type.",
  merchant_spellings: "Under each name, the entries spelled differently. Open the merchant to merge the names.",
  merchant_categories: "Under each merchant, the entries filed outside its usual category.",
  overdue_dues: "Mark each paid, or remove it if it's not owed.",
};

export default function DataHealthIssueScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { check } = useLocalSearchParams<{ check: HealthCheckId }>();
  const [items, setItems] = useState<HealthItems | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!check) return;
    try {
      setItems(await getHealthItems(DEFAULT_USER_ID, check));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [check]);
  useDataRefresh(load);

  const openTxn = (id: string) => router.push({ pathname: "/expense/[id]", params: { id } });

  const Row = ({ r }: { r: HealthTxn }) => (
    <Pressable onPress={() => openTxn(r.id)} className="flex-row items-center py-2.5" accessibilityRole="button">
      <View className="flex-1 mr-2">
        <Text className="text-sm text-foreground" numberOfLines={1}>
          {r.merchant || (r.nature === "credit" ? "Money in" : "Payment")}
        </Text>
        <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
          {[formatDisplayDate(r.date.slice(0, 10)), r.category, r.account].filter(Boolean).join(" · ")}
        </Text>
        {r.hint ? (
          <Text className="text-xs mt-0.5" style={{ color: theme.warning }} numberOfLines={1}>
            {r.hint}
          </Text>
        ) : null}
      </View>
      <Text className="text-sm font-semibold" style={{ color: r.nature === "credit" ? theme.success : theme.foreground }}>
        {r.nature === "credit" ? "+" : ""}
        {formatAmount(r.amount)}
      </Text>
      <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} style={{ marginLeft: 4 }} />
    </Pressable>
  );

  const count =
    !items ? 0 : items.kind === "transactions" ? items.rows.length : items.kind === "groups" ? items.groups.length : items.accounts.length;

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen options={{ title: check ? TITLES[check] : "Data health" }} />
      {failed ? (
        <EmptyState icon="alert-circle-outline" title="Couldn't load these" subtitle="Go back and try again." />
      ) : !items ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : count === 0 ? (
        <EmptyState icon="checkmark-circle-outline" title="All fixed" subtitle="Nothing left here." />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
          <Text className="text-sm text-muted-foreground mb-3 leading-5">{check ? HOW[check] : ""}</Text>

          {check === "transfers" && (
            <Button title="Turn them into transfers" onPress={() => router.push("/settings/transfer-review")} className="mb-3" />
          )}

          {items.kind === "transactions" && (
            <Card>
              {items.rows.map((r, i) => (
                <View key={r.id} className={i > 0 ? "border-t border-border" : ""}>
                  <Row r={r} />
                </View>
              ))}
              {items.rows.length >= 500 && <Text className="text-xs text-muted-foreground mt-2">Showing the latest 500.</Text>}
            </Card>
          )}

          {items.kind === "groups" &&
            items.groups.map((g, gi) => (
              <Card key={`${g.title}-${gi}`} className="mb-3">
                <View className="flex-row items-start">
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">{g.title}</Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">{g.subtitle}</Text>
                  </View>
                  {check !== "duplicates" && (
                    <Pressable
                      onPress={() => router.push({ pathname: "/settings/merchant-detail", params: { name: check === "merchant_categories" ? g.title : g.title.replace(/ \(\d+\)$/, "") } })}
                      hitSlop={8}
                      accessibilityRole="button"
                      className="ml-2"
                    >
                      <Text className="text-xs font-semibold" style={{ color: theme.primary }}>Merchant</Text>
                    </Pressable>
                  )}
                </View>
                {g.rows.map((r) => (
                  <View key={r.id} className="border-t border-border mt-2">
                    <Row r={r} />
                  </View>
                ))}
                {g.more > 0 && <Text className="text-xs text-muted-foreground mt-2">and {g.more} more</Text>}
              </Card>
            ))}

          {items.kind === "accounts" && (
            <Card>
              {items.accounts.map((a, i) => (
                <Pressable
                  key={a.id}
                  onPress={() =>
                    check === "balance_gaps"
                      ? router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: a.id } })
                      : router.push({ pathname: "/settings/account-detail", params: { accountId: a.id } })
                  }
                  className={`flex-row items-center py-3 ${i > 0 ? "border-t border-border" : ""}`}
                  accessibilityRole="button"
                >
                  <View className="flex-1 mr-2">
                    <Text className="text-sm text-foreground">{a.name}</Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">{a.detail}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
                </Pressable>
              ))}
            </Card>
          )}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}
