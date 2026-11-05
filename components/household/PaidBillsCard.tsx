import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
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
 * Together's nudge for bills others in the household recorded as paid by me that Arth couldn't match
 * to one of my transactions by itself. The bills themselves are on Shared Transactions (as "owes
 * you" rows), so this is one line that opens that list filtered to them. Hidden when there are none.
 */
export function PaidBillsNudge({
  household,
  reloadKey,
}: {
  household: Household;
  reloadKey?: unknown;
}) {
  const router = useRouter();
  const theme = useTheme();
  const [bills, setBills] = useState<PaidBill[]>([]);

  useEffect(() => {
    getUnfiledPaidBills(household).then(setBills).catch(() => setBills([]));
  }, [household, reloadKey]);

  if (bills.length === 0) return null;
  const n = bills.length;
  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/together/transactions",
          // Newest first, so this opens on the month of the latest one.
          params: { month: bills[0].date.slice(0, 7), needsAccount: "1" },
        })
      }
      accessibilityRole="button"
      accessibilityLabel={`${n} ${n === 1 ? "bill" : "bills"} you paid need an account`}
    >
      <Card className="mb-3">
        <View className="flex-row items-center">
          <Ionicons name="wallet-outline" size={18} color={theme.warning} />
          <View className="flex-1 ml-2 mr-2">
            <Text className="text-sm text-foreground">
              {n} {n === 1 ? "bill" : "bills"} you paid {n === 1 ? "needs" : "need"} an account
            </Text>
            <Text className="text-xs text-muted-foreground mt-0.5">
              Say where the money came from, so your account and budget match.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
        </View>
      </Card>
    </Pressable>
  );
}

/**
 * "Where did it come from?" for one bill someone else recorded as paid by me: one of my
 * transactions, an account (Arth adds the transaction), or nowhere I track (Hisaab only).
 */
export function PaidBillSheet({
  bill,
  onClose,
  onDone,
}: {
  bill: PaidBill | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const theme = useTheme();
  const toast = useToast();
  const [candidates, setCandidates] = useState<PaidBillCandidate[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [showAccounts, setShowAccounts] = useState(false);

  useEffect(() => {
    if (!bill) return;
    setShowAccounts(false);
    setCandidates([]);
    candidatesFor(bill).then(setCandidates).catch(() => setCandidates([]));
    getActiveAccounts(DEFAULT_USER_ID).then(setAccounts).catch(() => setAccounts([]));
  }, [bill]);

  const done = async (what: () => Promise<unknown> | void, message: string) => {
    try {
      await what();
      onClose();
      toast(message);
      requestSync(1000);
      onDone?.();
    } catch (e) {
      toast(formatError("Bill", e), { tone: "danger" });
    }
  };

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
    <Sheet visible={!!bill} onClose={onClose}>
      {bill && (
        <>
          <View className="flex-row items-start justify-between px-5 pb-2">
            <View className="flex-1 mr-3">
              <Text className="text-heading font-bold text-foreground">
                Where did it come from?
              </Text>
              <Text className="text-xs text-muted-foreground mt-1">
                {bill.merchant || "Bill"} · {formatAmount(bill.bill)} ·{" "}
                {formatDateShort(bill.date)}. {bill.from} owes you{" "}
                {formatAmount(bill.owed)}.
              </Text>
            </View>
            <Pressable
              onPress={onClose}
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
                  Your transactions for {formatAmount(bill.bill)}
                </Text>
                {candidates.length === 0 && (
                  <Text className="text-sm text-muted-foreground px-5 py-2">
                    None within 10 days of {formatDateShort(bill.date)}.
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
                        () => fileWithExpense(bill, c.id),
                        `Split with ${bill.from}`,
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
                    void done(() => skipPaidBill(bill), "Kept in Hisaab only")
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
                        () => fileToAccount(bill, a.id),
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
);
}
