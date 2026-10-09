import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { Button, Card, SelectSheet, Text } from "@/components/ui";
import { useAlert } from "@/hooks/use-alert";
import { useTheme } from "@/hooks/use-theme";
import type { Expense } from "@/services/expense-types";
import {
  clearMoneyEvent,
  closeFdWithCredit,
  findDepositDebitForClosure,
  getActiveFDs,
  type DepositDebit,
  type FdCandidate,
} from "@/services/money-events";
import { DEFAULT_USER_ID } from "@/constants/app";
import { parseBankSMS } from "@/services/sms/bank-patterns";
import { formatError } from "@/utils/error-message";
import { formatAmount, formatDateForDisplay } from "@/utils/expense-validation";
import { MarkAsFDSheet } from "./MarkAsFDSheet";
import { MONEY_EVENT_META } from "./money-event-meta";

interface MoneyEventPanelProps {
  expense: Expense;
  /** Bank of the expense's account, to pre-fill a new FD. */
  bankName: string | null;
  /** Debit: open "Mark as Fixed Deposit" for this row. */
  onSetUpFD: () => void;
  /** Debit → "Transfer to which account?"; credit → "Money came from which account?". */
  onPickTransferAccount: () => void;
  /** Open the investment bucket picker. */
  onLinkBucket: () => void;
  /** Credit: open "Money back from an investment". */
  onRecordWithdrawal: () => void;
  /** After an action that leaves this screen's data stale. */
  onChanged: () => void;
}

/**
 * The one-tap card for an SMS row that isn't ordinary spending or income
 * (expenses.money_event): an FD deposit, an FD closure, a transfer to/from the
 * user's own account, a SIP, or money back from an investment. Shown at the top of the transaction detail
 * screen; Catch Up and the review queue send people here.
 */
export function MoneyEventPanel({
  expense,
  bankName,
  onSetUpFD,
  onPickTransferAccount,
  onLinkBucket,
  onRecordWithdrawal,
  onChanged,
}: MoneyEventPanelProps) {
  const theme = useTheme();
  const alert = useAlert();
  const router = useRouter();
  const event = expense.money_event;

  const [fds, setFds] = useState<FdCandidate[]>([]);
  const [fdPickerOpen, setFdPickerOpen] = useState(false);
  const [deposit, setDeposit] = useState<DepositDebit | null>(null);
  const [recordFdOpen, setRecordFdOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (event !== "fd_closure") return;
    let live = true;
    (async () => {
      const [list, dep] = await Promise.all([
        getActiveFDs(DEFAULT_USER_ID, expense.date),
        findDepositDebitForClosure(expense.id),
      ]);
      if (!live) return;
      setFds(list);
      setDeposit(dep);
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [event, expense.id, expense.date]);

  const run = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      setBusy(true);
      try {
        await fn();
        onChanged();
      } catch (e) {
        alert("Couldn't do that", formatError(label, e));
      } finally {
        setBusy(false);
      }
    },
    [alert, onChanged],
  );

  if (!event || expense.reclassified_as_transfer === 1) return null;
  const meta = MONEY_EVENT_META[event];
  const tone = theme[meta.tone];

  // Short explanation under the amount, per event.
  let detail = "";
  let otherAcctLast4: string | null = null;
  if (event === "fd_open") {
    detail = "Set it up as an FD and it stops counting as spending. Your net worth will include it.";
  } else if (event === "fd_closure") {
    detail = deposit
      ? `${formatAmount(deposit.amount)} went out on ${formatDateForDisplay(deposit.date)}, so ${formatAmount(
          Math.max(expense.amount - deposit.amount, 0),
        )} looks like interest.`
      : "Money back from a fixed deposit, not income. Pick the FD it came from.";
  } else if (event === "self_transfer") {
    otherAcctLast4 = expense.raw_source_text ? parseBankSMS(expense.raw_source_text)?.counterpartyAcctLast4 ?? null : null;
    detail =
      expense.nature === "credit"
        ? "This came from your own name, so it's money moving between your accounts. Pick where it came from."
        : otherAcctLast4
          ? `Sent to account ending ${otherAcctLast4}. If that's yours, this is a transfer, not spending.`
          : "Sent to your own name, so it's money moving between your accounts. Pick where it went.";
  } else if (event === "sip") {
    detail = "Mutual fund auto-debit. Link it to a bucket and it counts as investing, not spending.";
  } else if (event === "investment_withdrawal") {
    detail = "Looks like a redemption or payout. Pick the investment it came from and it stops counting as income.";
  }

  const primary = () => {
    if (event === "fd_open") onSetUpFD();
    else if (event === "fd_closure") {
      if (fds.length === 0) {
        alert("No open FDs", "Arth doesn't have an open fixed deposit to close. Use \"Record this FD\" if the deposit is in your transactions, or keep it as a credit.");
      } else setFdPickerOpen(true);
    } else if (event === "self_transfer") onPickTransferAccount();
    else if (event === "sip") onLinkBucket();
    else if (event === "investment_withdrawal") onRecordWithdrawal();
  };

  const dismiss = () =>
    run("Update", async () => {
      await clearMoneyEvent(expense.id);
    });

  return (
    <Card className="mx-4 mt-3">
      <View className="flex-row items-center self-start px-2 py-1 rounded-full" style={{ backgroundColor: theme.alpha(meta.tone, 0.12) }}>
        <Ionicons name={meta.icon} size={13} color={tone} />
        <Text className="text-label font-semibold ml-1" style={{ color: tone }}>
          {meta.tag}
        </Text>
      </View>
      <Text className="text-sm text-muted-foreground mt-2">{detail}</Text>

      <View className="mt-3">
        <Button title={meta.primaryAction} onPress={primary} loading={busy} />
      </View>
      {event === "fd_closure" && deposit && (
        <View className="mt-2">
          <Button title="Record this FD" variant="outline" onPress={() => setRecordFdOpen(true)} />
        </View>
      )}
      {event === "self_transfer" && expense.nature === "realized" && otherAcctLast4 && (
        <View className="mt-2">
          <Button
            title={`Add account ··${otherAcctLast4}`}
            variant="outline"
            onPress={() => router.push({ pathname: "/settings/account-add", params: { presetType: "savings" } })}
          />
        </View>
      )}
      <View className="mt-2">
        <Button title={meta.dismissAction} variant="ghost" onPress={dismiss} />
      </View>

      <SelectSheet
        visible={fdPickerOpen}
        title="Which FD closed?"
        options={fds.map((f) => ({
          value: f.financialAccountId,
          label: f.label,
          icon: "business-outline" as const,
          description: `${formatAmount(f.principal)}${f.startDate ? ` · since ${formatDateForDisplay(f.startDate)}` : ""}`,
        }))}
        value={null}
        onChange={(fdAccountId) => {
          setFdPickerOpen(false);
          void run("Close FD", () => closeFdWithCredit(fdAccountId, expense.id));
        }}
        onClose={() => setFdPickerOpen(false)}
      />

      {deposit && (
        <MarkAsFDSheet
          visible={recordFdOpen}
          expenseId={deposit.id}
          expenseUpdatedAt={deposit.updated_at}
          sourceAccountId={deposit.account_id}
          amount={deposit.amount}
          date={deposit.date}
          suggestedBankName={bankName ?? ""}
          onDone={(fdAccountId) => {
            setRecordFdOpen(false);
            void run("Close FD", () => closeFdWithCredit(fdAccountId, expense.id));
          }}
          onClose={() => setRecordFdOpen(false)}
        />
      )}
    </Card>
  );
}
