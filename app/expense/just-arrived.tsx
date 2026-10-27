import { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, LoadingState, ScreenContainer, Text, useToast } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import { getCategories } from "@/services/category";
import type { Category } from "@/services/category";
import { needsSourceAccount } from "@/services/catch-up";
import { approveWithCategory } from "@/services/catch-up-actions";
import { getExpensesByIds, rejectExpense } from "@/services/expense";
import type { Expense } from "@/services/expense";
import { getActiveAccounts } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import { getLastArrival, importHandedMessages, markArrivalSeen } from "@/services/message-inbox";
import type { Arrival } from "@/services/message-inbox";
import { categorizeByMerchant } from "@/services/smart-categorizer";
import { formatError } from "@/utils/error-message";
import { formatAmount } from "@/utils/format";
import { logger } from "@/utils/logger";

/**
 * iPhone: what Arth just read from bank messages the Shortcut handed over (or one pasted in), with
 * Approve / Edit / Reject on each and "Teach Arth" for a message it couldn't read. Opened from the
 * bank-message notification, the "Review bank message in Arth" action and the Home card.
 *
 * Shows the last batch (services/message-inbox.ts: getLastArrival); reads anything still waiting
 * first, so a notification tapped before Arth opened still finds its message.
 */
export default function JustArrivedScreen() {
  const router = useRouter();
  const theme = useTheme();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [items, setItems] = useState<Expense[]>([]);
  const [suggested, setSuggested] = useState<Record<string, string | null>>({});
  const [categories, setCategories] = useState<Map<string, Category>>(new Map());
  const [accounts, setAccounts] = useState<Map<string, FinancialAccount>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      await importHandedMessages();
      const a = getLastArrival();
      markArrivalSeen();
      setArrival(a);
      const [rows, cats, accts] = await Promise.all([
        a?.addedIds.length ? getExpensesByIds(a.addedIds) : Promise.resolve([] as Expense[]),
        getCategories(DEFAULT_USER_ID),
        getActiveAccounts(DEFAULT_USER_ID),
      ]);
      const live = rows.filter((e) => !e.deleted_at).sort((x, y) => (y.date ?? "").localeCompare(x.date ?? ""));
      setItems(live);
      setCategories(new Map(cats.map((c) => [c.id, c])));
      setAccounts(new Map(accts.map((x) => [x.id, x])));
      // Spending without a category gets the merchant suggestion Catch Up would show.
      const next: Record<string, string | null> = {};
      for (const e of live) {
        if (e.category_id || e.nature !== "realized") continue;
        next[e.id] = await categorizeByMerchant(DEFAULT_USER_ID, e.merchant_name)
          .then((r) => r.categoryId)
          .catch(() => null);
      }
      setSuggested(next);
    } catch (e) {
      logger.error("Just arrived: load failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // On focus, so coming back from Edit shows what was changed there.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const act = async (e: Expense, what: "approve" | "reject") => {
    setBusy(e.id);
    try {
      if (what === "approve") await approveWithCategory(e, e.category_id ?? suggested[e.id] ?? null, false);
      else await rejectExpense(e.id);
      toast(what === "approve" ? "Approved" : "Rejected", { tone: what === "approve" ? "success" : "danger" });
      await load();
    } catch (err) {
      toast(formatError(what === "approve" ? "Approve" : "Reject", err), { tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Reading bank messages…" icon="chatbubble-ellipses-outline" />
      </ScreenContainer>
    );
  }

  const pending = items.filter((e) => e.status === "pending_review");
  const handled = items.filter((e) => e.status !== "pending_review");
  const unreadable = arrival?.unreadable ?? [];
  const nothing = pending.length === 0 && unreadable.length === 0;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {nothing ? (
          <View className="items-center py-10 px-6">
            <Ionicons name="checkmark-done-outline" size={44} color={theme.success} />
            <Text className="text-lg font-semibold text-foreground mt-3">
              {items.length > 0 ? "All done" : "Nothing new"}
            </Text>
            <Text className="text-sm text-muted-foreground text-center mt-1 leading-5">
              {items.length > 0
                ? "Everything that came in has been reviewed."
                : "Bank messages appear here as the Shortcut hands them to Arth."}
            </Text>
            <Button title="Go to Home" variant="outline" onPress={() => router.replace("/(tabs)")} className="mt-5" />
          </View>
        ) : (
          <Text className="text-sm text-muted-foreground mb-3 leading-5">
            {arrival && arrival.read > 1 ? `${arrival.read} bank messages came in. ` : ""}
            Check what Arth read, then approve it. Nothing counts until you do.
          </Text>
        )}

        {pending.map((e) => {
          const credit = e.nature === "credit";
          const acct = e.account_id ? accounts.get(e.account_id) : undefined;
          const catId = e.category_id ?? suggested[e.id] ?? null;
          const cat = catId ? categories.get(catId) : undefined;
          const needsMore = needsSourceAccount(e);
          return (
            <Card key={e.id} className="mb-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-2xl font-bold" style={{ color: credit ? theme.success : theme.foreground }}>
                  {credit ? "+" : ""}
                  {formatAmount(e.amount)}
                </Text>
                <View className="rounded-full px-2.5 py-0.5" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                  <Text className="text-xs font-medium" style={{ color: theme.primary }}>From your bank</Text>
                </View>
              </View>
              <Text className="text-xs text-muted-foreground mt-0.5">
                {credit ? "Received" : "Paid"} · {e.date}
                {e.transaction_time ? ` ${e.transaction_time}` : ""}
              </Text>
              <Row label={credit ? "From" : "To"} value={e.merchant_name ?? e.description ?? "Not read"} />
              <Row label={credit ? "Into" : "From"} value={acct ? `${acct.bank_name} ••${acct.account_identifier}` : "Account not matched"} />
              {!credit && <Row label="Category" value={cat?.name ?? "Pick on Edit"} last />}
              <View className="flex-row mt-3" style={{ gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button title="Reject" variant="outline" onPress={() => void act(e, "reject")} disabled={busy != null} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Edit" variant="outline" onPress={() => router.push(`/expense/${e.id}`)} disabled={busy != null} />
                </View>
                <View style={{ flex: 1.3 }}>
                  {needsMore ? (
                    // A card repayment needs the account it was paid from: the detail screen asks.
                    <Button title="Review" onPress={() => router.push(`/expense/${e.id}`)} disabled={busy != null} />
                  ) : (
                    <Button title="Approve" onPress={() => void act(e, "approve")} loading={busy === e.id} disabled={busy != null} />
                  )}
                </View>
              </View>
            </Card>
          );
        })}

        {unreadable.map((m, i) => (
          <Card key={`${m.date}-${i}`} className="mb-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-semibold text-foreground">{"Couldn't read this one"}</Text>
              <View className="rounded-full px-2.5 py-0.5" style={{ backgroundColor: theme.alpha("warning", 0.15) }}>
                <Text className="text-xs font-medium" style={{ color: theme.warning }}>New format</Text>
              </View>
            </View>
            <Text className="text-xs text-muted-foreground mt-2 rounded-md p-2" style={{ backgroundColor: theme.alpha("foreground", 0.04) }} numberOfLines={5}>
              {m.body}
            </Text>
            <Text className="text-sm text-foreground mt-2 leading-5">
              Show Arth where the amount and shop are, once. Messages like it are read by themselves after that.
            </Text>
            <Button
              title="Teach Arth"
              onPress={() =>
                router.push({
                  pathname: "/settings/sms-templates/new",
                  params: { prefilledBody: m.body, senderAddress: m.sender || undefined },
                })
              }
              className="mt-3"
            />
            <Button title="Add by hand" variant="ghost" onPress={() => router.push("/expense/add")} className="mt-1" />
          </Card>
        ))}

        {handled.length > 0 && !nothing && (
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-2 mb-1">Already done</Text>
        )}
        {!nothing &&
          handled.map((e) => (
            <Pressable key={e.id} onPress={() => router.push(`/expense/${e.id}`)} className="flex-row justify-between py-2">
              <Text className="text-sm text-foreground flex-1" numberOfLines={1}>
                {e.merchant_name ?? e.description ?? "Transaction"}
              </Text>
              <Text className="text-sm text-muted-foreground ml-2">
                {formatAmount(e.amount)} · {e.status === "approved" ? "Approved" : "Rejected"}
              </Text>
            </Pressable>
          ))}
      </ScrollView>
    </ScreenContainer>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View className={`flex-row justify-between py-2 ${last ? "" : "border-b border-border"}`}>
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="text-sm text-foreground ml-3 flex-1 text-right" numberOfLines={1}>{value}</Text>
    </View>
  );
}
