import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, Sheet, Text, useToast } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount } from "@/utils/format";
import { formatDisplayDate as formatDateShort } from "@/utils/date";
import { formatError } from "@/utils/error-message";
import {
  getActiveAccounts,
  type FinancialAccount,
} from "@/services/financial-account";
import {
  candidatesFor,
  fileToAccount,
  fileWithExpense,
  getUnfiledPaidBills,
  skipPaidBill,
  type PaidBill,
  type PaidBillCandidate,
} from "@/services/household/paid-bills";
import { requestSync } from "@/services/household/sync";
import type { Household } from "@/services/household/types";

const accountName = (a: FinancialAccount) =>
  a.account_label ||
  `${a.bank_name} ${a.account_identifier ? `••${a.account_identifier.slice(-4)}` : ""}`.trim();

/**
 * "You paid these": bills others in the household recorded as paid by me that Arth couldn't match
 * to one of my transactions by itself. Each asks where the money came from: one of my transactions,
 * an account (Arth adds the transaction), or nowhere I track (Hisaab only). Hidden when there are none.
 */
export function PaidBillsCard({
  household,
  reloadKey,
}: {
  household: Household;
  reloadKey?: unknown;
}) {
  const theme = useTheme();
  const toast = useToast();
  const [bills, setBills] = useState<PaidBill[]>([]);
  const [open, setOpen] = useState<PaidBill | null>(null);
  const [candidates, setCandidates] = useState<PaidBillCandidate[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [showAccounts, setShowAccounts] = useState(false);

  const load = useCallback(async () => {
    setBills(await getUnfiledPaidBills(household).catch(() => []));
  }, [household]);
  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const openBill = async (b: PaidBill) => {
    setOpen(b);
    setShowAccounts(false);
    setCandidates(await candidatesFor(b).catch(() => []));
    setAccounts(await getActiveAccounts(DEFAULT_USER_ID).catch(() => []));
  };

  const done = async (what: () => Promise<unknown> | void, message: string) => {
    try {
      await what();
      setOpen(null);
      toast(message);
      requestSync(1000);
      await load();
    } catch (e) {
      toast(formatError("Bill", e), { tone: "danger" });
    }
  };

  if (bills.length === 0) return null;

  const Row = ({
    icon,
    title,
    sub,
    onPress,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    sub?: string | null;
    onPress: () => void;
  }) => (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-5 py-3"
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={18} color={theme.primary} />
      <View className="flex-1 ml-3">
        <Text className="text-sm text-foreground">{title}</Text>
        {sub ? (
          <Text className="text-xs text-muted-foreground mt-0.5">{sub}</Text>
        ) : null}
      </View>
      <Ionicons
        name="chevron-forward"
        size={14}
        color={theme.mutedForeground}
      />
    </Pressable>
  );

  return (
    <>
      <Card className="mb-3">
        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          You paid these
        </Text>
        <Text className="text-xs text-muted-foreground mb-1 leading-4">
          Bills others recorded as paid by you. Say where the money came from,
          so your account and budget match.
        </Text>
        {bills.map((b) => (
          <Pressable
            key={b.ref}
            onPress={() => void openBill(b)}
            className="flex-row items-center py-2.5 border-b border-border"
            accessibilityRole="button"
          >
            <View className="flex-1 mr-2">
              <Text className="text-sm text-foreground" numberOfLines={1}>
                {b.merchant || b.category || "Bill"}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {formatDateShort(b.date)} · {b.from} owes you{" "}
                {formatAmount(b.owed)}
              </Text>
            </View>
            <Text className="text-sm font-semibold text-foreground mr-1">
              {formatAmount(b.bill)}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={14}
              color={theme.mutedForeground}
            />
          </Pressable>
        ))}
      </Card>

      <Sheet visible={!!open} onClose={() => setOpen(null)}>
        {open && (
          <>
            <View className="flex-row items-start justify-between px-5 pb-2">
              <View className="flex-1 mr-3">
                <Text className="text-heading font-bold text-foreground">
                  Where did it come from?
                </Text>
                <Text className="text-xs text-muted-foreground mt-1">
                  {open.merchant || "Bill"} · {formatAmount(open.bill)} ·{" "}
                  {formatDateShort(open.date)}. {open.from} owes you{" "}
                  {formatAmount(open.owed)}.
                </Text>
              </View>
              <Pressable
                onPress={() => setOpen(null)}
                hitSlop={8}
                accessibilityLabel="Close"
              >
                <Ionicons
                  name="close"
                  size={20}
                  color={theme.mutedForeground}
                />
              </Pressable>
            </View>
            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              {!showAccounts ? (
                <>
                  <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-5 pt-3 pb-1">
                    Your transactions for {formatAmount(open.bill)}
                  </Text>
                  {candidates.length === 0 && (
                    <Text className="text-sm text-muted-foreground px-5 py-2">
                      None within 10 days of {formatDateShort(open.date)}.
                    </Text>
                  )}
                  {candidates.map((c) => (
                    <Row
                      key={c.id}
                      icon="receipt-outline"
                      title={c.merchant || c.description || "Transaction"}
                      sub={[formatDateShort(c.date), c.account]
                        .filter(Boolean)
                        .join(" · ")}
                      onPress={() =>
                        void done(
                          () => fileWithExpense(open, c.id),
                          `Split with ${open.from}`,
                        )
                      }
                    />
                  ))}
                  <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-5 pt-4 pb-1">
                    Not there?
                  </Text>
                  <Row
                    icon="wallet-outline"
                    title="Pick the account it was paid from"
                    sub="Arth adds the transaction"
                    onPress={() => setShowAccounts(true)}
                  />
                  <Row
                    icon="book-outline"
                    title="Keep it in Hisaab only"
                    sub="Paid in a way you don't track"
                    onPress={() =>
                      void done(() => skipPaidBill(open), "Kept in Hisaab only")
                    }
                  />
                </>
              ) : (
                <>
                  <Pressable
                    onPress={() => setShowAccounts(false)}
                    className="flex-row items-center px-5 py-2"
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name="chevron-back"
                      size={16}
                      color={theme.primary}
                    />
                    <Text
                      className="text-sm ml-1"
                      style={{ color: theme.primary }}
                    >
                      Transactions
                    </Text>
                  </Pressable>
                  {accounts.length === 0 && (
                    <Text className="text-sm text-muted-foreground px-5 py-2">
                      No accounts yet.
                    </Text>
                  )}
                  {accounts.map((a) => (
                    <Row
                      key={a.id}
                      icon={
                        a.account_type === "credit_card"
                          ? "card-outline"
                          : a.account_type === "wallet"
                            ? "wallet-outline"
                            : "business-outline"
                      }
                      title={accountName(a)}
                      sub={a.account_type.replace("_", " ")}
                      onPress={() =>
                        void done(
                          () => fileToAccount(open, a.id),
                          `Added to ${accountName(a)}`,
                        )
                      }
                    />
                  ))}
                </>
              )}
            </ScrollView>
          </>
        )}
      </Sheet>
    </>
  );
}
