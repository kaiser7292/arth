import { useEffect, useState } from "react";
import { View } from "react-native";
import { Button, DateInput, Input, Sheet, Text } from "@/components/ui";
import { useAlert } from "@/hooks/use-alert";
import { useTheme } from "@/hooks/use-theme";
import { getAccountById } from "@/services/financial-account";
import { partialWithdrawFD, type InvestmentProduct } from "@/services/investment-accounts";
import { todayIso } from "@/utils/date";
import { formatError } from "@/utils/error-message";
import { formatAmount } from "@/utils/format";

/**
 * Take part of an FD out before maturity (owner, Nov 2026). The amount goes back to the account
 * the FD was funded from; what stays in becomes the principal, and interest is worked out on it
 * alone, from the start date: the withdrawn part earns nothing.
 */
export function FDPartialWithdrawSheet({
  visible,
  product,
  onDone,
  onClose,
}: {
  visible: boolean;
  product: InvestmentProduct;
  onDone: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const alert = useAlert();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [toName, setToName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setAmount("");
    const today = todayIso();
    setDate(product.maturity_date && today >= product.maturity_date ? (product.start_date ?? today) : today);
    if (product.source_account_id) {
      getAccountById(product.source_account_id)
        .then((a) => setToName(a ? a.account_label ?? `${a.bank_name} ····${a.account_identifier}` : null))
        .catch(() => setToName(null));
    } else setToName(null);
  }, [visible, product]);

  const principal = product.principal ?? 0;
  const value = parseFloat(amount);
  const valid = value > 0 && value < principal;
  const stays = valid ? principal - value : principal;

  const withdraw = async () => {
    if (!valid) {
      alert("Check the amount", value >= principal ? "To take it all out, close the fixed deposit instead." : "Enter how much to withdraw.");
      return;
    }
    setSaving(true);
    try {
      await partialWithdrawFD(product.financial_account_id, value, date);
      onDone();
    } catch (e) {
      alert("Couldn't withdraw", formatError("Partial withdrawal", e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="px-5 pb-5" style={{ gap: 12 }}>
        <Text className="text-heading font-bold text-foreground">Partial withdrawal</Text>
        <Text className="text-meta text-muted-foreground">
          {formatAmount(principal)} is in this fixed deposit now. What you take out goes to {toName ?? "the account it was funded from"}.
        </Text>
        <Input label="Amount to withdraw" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" prefix="₹" />
        <DateInput label="Date" value={date} onChange={setDate} />
        <View className="rounded-control px-3 py-2.5" style={{ backgroundColor: theme.alpha("primary", 0.08) }}>
          <Text className="text-meta text-foreground">
            {formatAmount(stays)} stays in and earns interest from the start date. The withdrawn amount earns no interest.
          </Text>
        </View>
        <Button title={valid ? `Withdraw ${formatAmount(value)}` : "Withdraw"} onPress={() => void withdraw()} loading={saving} disabled={!valid || !product.source_account_id} />
        {!product.source_account_id && (
          <Text className="text-label" style={{ color: theme.danger }}>
            This fixed deposit has no funding account recorded, so there's nowhere to send the money.
          </Text>
        )}
      </View>
    </Sheet>
  );
}
