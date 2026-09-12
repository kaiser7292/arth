import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Input, Sheet, Text } from "@/components/ui";
import { CalendarModal } from "@/components/ui/CalendarModal";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import { createFDAccountShell } from "@/services/investment-accounts";
import { reclassifyExpenseAsTransfer } from "@/services/account-transfer";
import type { CompoundingFreq, InterestMethod } from "@/services/investment-engine";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";
import { formatDate } from "@/utils/date";
import { formatError } from "@/utils/error-message";
import { useTheme } from "@/hooks/use-theme";

const COMPOUNDING_OPTIONS: { value: CompoundingFreq; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annually", label: "Annually" },
];

interface MarkAsFDSheetProps {
  visible: boolean;
  expenseId: string;
  expenseUpdatedAt: string | undefined;
  sourceAccountId: string;
  amount: number;
  date: string;
  /** Best-effort guess at the bank name, e.g. from the expense's merchant/description. */
  suggestedBankName: string;
  onDone: (financialAccountId: string) => void;
  onClose: () => void;
}

/**
 * "Mark as Fixed Deposit" — reclassifies an SMS-detected debit as the funding
 * transfer for a brand-new FD account, in one step, instead of requiring the
 * FD to be created separately first (the full /investments/add-fd form) and
 * then reclassified as a transfer to it via the generic account picker.
 *
 * Interest rate and maturity date are optional here — a debit alert rarely
 * carries them — matching createFDAccountShell: leave both blank and fill
 * them in later from the account detail screen once you have the FD receipt.
 */
export function MarkAsFDSheet({
  visible,
  expenseId,
  expenseUpdatedAt,
  sourceAccountId,
  amount,
  date,
  suggestedBankName,
  onDone,
  onClose,
}: MarkAsFDSheetProps) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  const alert = useAlert();

  const [bankName, setBankName] = useState("");
  const [accountIdentifier, setAccountIdentifier] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [interestMethod, setInterestMethod] = useState<InterestMethod>("compound");
  const [compoundingFreq, setCompoundingFreq] = useState<CompoundingFreq>("quarterly");
  const [maturityDate, setMaturityDate] = useState("");
  const [showMaturityPicker, setShowMaturityPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setBankName(suggestedBankName);
      setAccountIdentifier("");
      setInterestRate("");
      setInterestMethod("compound");
      setCompoundingFreq("quarterly");
      setMaturityDate("");
    }
  }, [visible, suggestedBankName]);

  const hasRateInput = interestRate.trim().length > 0;

  const handleClose = useCallback(() => onClose(), [onClose]);

  const handleSave = useCallback(async () => {
    const errors: string[] = [];
    if (!bankName.trim()) errors.push("Bank name is required.");
    const identifierDigits = accountIdentifier.replace(/\D/g, "");
    if (!identifierDigits) errors.push("An account/receipt number is required to tell FDs at the same bank apart.");
    const r = hasRateInput ? parseFloat(interestRate) : null;
    if (hasRateInput && !(r! > 0)) errors.push("Interest rate must be a positive number.");
    if (hasRateInput && !maturityDate) errors.push("Maturity date is required if you enter an interest rate.");
    if (maturityDate && !hasRateInput) errors.push("Interest rate is required if you set a maturity date.");
    if (hasRateInput && maturityDate && maturityDate <= date) errors.push("Maturity date must be after the deposit date.");

    if (errors.length > 0) {
      alert("Fix these fields", errors.join("\n"));
      return;
    }

    setSaving(true);
    try {
      const financialAccountId = await createFDAccountShell({
        user_id: DEFAULT_USER_ID,
        bank_name: bankName.trim(),
        account_identifier: identifierDigits,
        principal: amount,
        start_date: date,
        source_account_id: sourceAccountId,
        interest_rate_pa: hasRateInput ? r! : undefined,
        interest_method: hasRateInput ? interestMethod : undefined,
        compounding_freq: hasRateInput && interestMethod === "compound" ? compoundingFreq : undefined,
        maturity_date: hasRateInput ? maturityDate : undefined,
      });
      await reclassifyExpenseAsTransfer(expenseId, financialAccountId, expenseUpdatedAt);
      onDone(financialAccountId);
    } catch (e) {
      alert("Couldn't save", formatError("Mark as fixed deposit", e));
    } finally {
      setSaving(false);
    }
  }, [
    bankName, accountIdentifier, hasRateInput, interestRate, maturityDate, date, interestMethod, compoundingFreq,
    amount, sourceAccountId, expenseId, expenseUpdatedAt, alert, onDone,
  ]);

  const title = useMemo(() => `${formatAmount(amount)} on ${formatDate(date)}`, [amount, date]);

  if (!visible) return null;

  return (
    <Sheet visible={visible} onClose={handleClose}>
      <View className="px-5 pb-3">
        <Text className="text-base font-bold" style={{ color: colors.text }}>
          Mark as Fixed Deposit
        </Text>
        <Text className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>
          {title} becomes the deposit into a new FD account.
        </Text>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
        <View className="px-5">
          <Input label="Bank name" value={bankName} onChangeText={setBankName} placeholder="e.g. HDFC Bank" containerClassName="mb-3" />
          <Input
            label="FD account / receipt number"
            value={accountIdentifier}
            onChangeText={setAccountIdentifier}
            placeholder="Last 4+ digits, as shown on the FD receipt"
            keyboardType="numeric"
            containerClassName="mb-3"
          />

          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Interest rate & maturity (optional — add later if you don't know yet)
          </Text>
          <Input
            label="Interest rate (% per year)"
            value={interestRate}
            onChangeText={setInterestRate}
            placeholder="e.g. 7.1"
            keyboardType="numeric"
            containerClassName="mb-3"
          />

          {hasRateInput && (
            <>
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Interest type
              </Text>
              <View className="flex-row gap-2 mb-3">
                {([{ value: "compound", label: "Compound" }, { value: "simple", label: "Simple" }] as const).map((opt) => {
                  const active = interestMethod === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => setInterestMethod(opt.value)}
                      className="flex-1 py-2.5 rounded-xl items-center border"
                      style={{
                        backgroundColor: active ? theme.primary + "20" : colors.surface,
                        borderColor: active ? theme.primary : colors.border,
                      }}
                    >
                      <Text className="text-sm font-semibold" style={{ color: active ? theme.primary : colors.textSecondary }}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {interestMethod === "compound" && (
                <>
                  <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Compounding frequency
                  </Text>
                  <View className="flex-row gap-2 mb-3">
                    {COMPOUNDING_OPTIONS.map((opt) => {
                      const active = compoundingFreq === opt.value;
                      return (
                        <Pressable
                          key={opt.value}
                          onPress={() => setCompoundingFreq(opt.value)}
                          className="flex-1 py-2.5 rounded-xl items-center border"
                          style={{
                            backgroundColor: active ? theme.primary + "20" : colors.surface,
                            borderColor: active ? theme.primary : colors.border,
                          }}
                        >
                          <Text className="text-sm font-semibold" style={{ color: active ? theme.primary : colors.textSecondary }}>
                            {opt.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}

              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Matures
              </Text>
              <Pressable
                onPress={() => setShowMaturityPicker(true)}
                className="flex-row items-center justify-between border border-border rounded-lg px-3 py-3 mb-3"
              >
                <Text className="text-sm" style={{ color: maturityDate ? colors.text : colors.textSecondary }}>
                  {maturityDate ? formatDate(maturityDate) : "Select maturity date"}
                </Text>
                <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>

      <View className="flex-row px-5 pt-3 pb-1 gap-3">
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          className="flex-1 py-3 rounded-xl items-center"
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
        >
          <Text className="text-sm font-semibold" style={{ color: colors.textSecondary }}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          accessibilityRole="button"
          className="flex-1 py-3 rounded-xl items-center"
          style={{ backgroundColor: theme.primary, opacity: saving ? 0.6 : 1 }}
        >
          <Text className="text-sm font-semibold text-primary-foreground">{saving ? "Saving…" : "Create FD"}</Text>
        </Pressable>
      </View>

      <CalendarModal
        visible={showMaturityPicker}
        onClose={() => setShowMaturityPicker(false)}
        value={maturityDate || date}
        onChange={(d) => {
          setMaturityDate(d);
          setShowMaturityPicker(false);
        }}
        maximumDate={null}
      />
    </Sheet>
  );
}
