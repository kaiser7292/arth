import { useCallback, useMemo, useState } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAlert } from "@/hooks/use-alert";
import { Button, Card, Input, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { CalendarModal } from "@/components/ui/CalendarModal";
import { AccountPickerSheet } from "@/components/expense/AccountPickerSheet";
import { createFDAccount } from "@/services/investment-accounts";
import type { CompoundingFreq, InterestMethod } from "@/services/investment-engine";
import { computeFDMaturityValue } from "@/services/investment-engine";
import { getAccountById } from "@/services/financial-account";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";
import { formatDate, todayIso } from "@/utils/date";
import { formatError } from "@/utils/error-message";
import { useTheme } from "@/hooks/use-theme";

const COMPOUNDING_OPTIONS: { value: CompoundingFreq; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annually", label: "Annually" },
];

export default function AddFixedDepositScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();

  const [bankName, setBankName] = useState("");
  const [accountIdentifier, setAccountIdentifier] = useState("");
  const [principal, setPrincipal] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [interestMethod, setInterestMethod] = useState<InterestMethod>("compound");
  const [compoundingFreq, setCompoundingFreq] = useState<CompoundingFreq>("quarterly");
  const [startDate, setStartDate] = useState(todayIso());
  const [maturityDate, setMaturityDate] = useState("");
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showMaturityPicker, setShowMaturityPicker] = useState(false);
  const [sourceAccountId, setSourceAccountId] = useState<string | null>(null);
  const [sourceAccountLabel, setSourceAccountLabel] = useState<string | null>(null);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const projectedValue = useMemo(() => {
    const p = parseFloat(principal);
    const r = parseFloat(interestRate);
    if (!(p > 0) || !(r > 0) || !maturityDate || maturityDate <= startDate) return null;
    return computeFDMaturityValue({
      principal: p,
      interest_rate_pa: r,
      start_date: startDate,
      maturity_date: maturityDate,
      interest_method: interestMethod,
      compounding_freq: compoundingFreq,
    });
  }, [principal, interestRate, startDate, maturityDate, interestMethod, compoundingFreq]);

  const handleSelectAccount = useCallback(async (accountId: string) => {
    setSourceAccountId(accountId);
    setShowAccountPicker(false);
    try {
      const account = await getAccountById(accountId);
      setSourceAccountLabel(account ? (account.account_label ?? `${account.bank_name} ••••${account.account_identifier}`) : null);
    } catch {
      setSourceAccountLabel(null);
    }
  }, []);

  const handleSave = useCallback(async () => {
    const errors: string[] = [];
    if (!bankName.trim()) errors.push("Bank name is required.");
    const identifierDigits = accountIdentifier.replace(/\D/g, "");
    if (!identifierDigits) errors.push("An account/receipt number is required to tell FDs at the same bank apart.");
    const p = parseFloat(principal);
    if (!(p > 0)) errors.push("Principal must be a positive amount.");
    const r = parseFloat(interestRate);
    if (!(r > 0)) errors.push("Interest rate must be a positive number.");
    if (!maturityDate) errors.push("Maturity date is required.");
    else if (maturityDate <= startDate) errors.push("Maturity date must be after the start date.");
    if (!sourceAccountId) errors.push("Choose which account this FD was funded from (and will pay back to).");

    if (errors.length > 0) {
      alert("Fix these fields", errors.join("\n"));
      return;
    }

    setSaving(true);
    try {
      await createFDAccount({
        user_id: DEFAULT_USER_ID,
        bank_name: bankName.trim(),
        account_identifier: identifierDigits,
        principal: p,
        interest_rate_pa: r,
        interest_method: interestMethod,
        compounding_freq: interestMethod === "compound" ? compoundingFreq : undefined,
        start_date: startDate,
        maturity_date: maturityDate,
        source_account_id: sourceAccountId!,
      });
      router.back();
    } catch (e) {
      alert("Couldn't save", formatError("Save fixed deposit", e));
    } finally {
      setSaving(false);
    }
  }, [
    bankName, accountIdentifier, principal, interestRate, interestMethod, compoundingFreq,
    startDate, maturityDate, sourceAccountId, alert, router,
  ]);

  return (
    <ScreenContainer padTop={false}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Card>
          <Input label="Bank name" value={bankName} onChangeText={setBankName} placeholder="e.g. HDFC Bank" />
          <Input
            label="FD account / receipt number"
            value={accountIdentifier}
            onChangeText={setAccountIdentifier}
            placeholder="Last 4+ digits, as shown on the FD receipt"
            keyboardType="numeric"
          />
        </Card>

        <Card className="mt-3">
          <Input
            label="Principal amount"
            value={principal}
            onChangeText={setPrincipal}
            placeholder="e.g. 100000"
            keyboardType="numeric"
          />
          <Input
            label="Interest rate (% per year)"
            value={interestRate}
            onChangeText={setInterestRate}
            placeholder="e.g. 7.1"
            keyboardType="numeric"
          />

          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 mt-2">
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
              <View className="flex-row gap-2 mb-1">
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
        </Card>

        <Card className="mt-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Starts
          </Text>
          <Pressable
            onPress={() => setShowStartPicker(true)}
            className="flex-row items-center justify-between border border-border rounded-lg px-3 py-3 mb-3"
          >
            <Text className="text-sm text-foreground">{formatDate(startDate)}</Text>
            <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
          </Pressable>

          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Matures
          </Text>
          <Pressable
            onPress={() => setShowMaturityPicker(true)}
            className="flex-row items-center justify-between border border-border rounded-lg px-3 py-3"
          >
            <Text className="text-sm" style={{ color: maturityDate ? colors.text : colors.textSecondary }}>
              {maturityDate ? formatDate(maturityDate) : "Select maturity date"}
            </Text>
            <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
          </Pressable>
        </Card>

        <Card className="mt-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Funded from / pays back to
          </Text>
          <Pressable
            onPress={() => setShowAccountPicker(true)}
            className="flex-row items-center justify-between border border-border rounded-lg px-3 py-3"
          >
            <Text className="text-sm" style={{ color: sourceAccountLabel ? colors.text : colors.textSecondary }}>
              {sourceAccountLabel ?? "Select account"}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
          <Text className="text-xs text-faint-foreground mt-1.5">
            The deposit moves out of this account now. At maturity, the principal moves back here and the interest lands as a credit for you to review.
          </Text>
        </Card>

        {projectedValue != null && (
          <Card className="mt-3">
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Projected maturity value
            </Text>
            <Text className="text-lg font-bold" style={{ color: theme.success }}>
              {formatAmount(projectedValue)}
            </Text>
          </Card>
        )}

        <Button
          title={saving ? "Saving…" : "Save fixed deposit"}
          onPress={handleSave}
          disabled={saving}
          className="mt-4"
        />
      </ScrollView>

      <CalendarModal
        visible={showStartPicker}
        onClose={() => setShowStartPicker(false)}
        value={startDate}
        onChange={(d) => {
          setStartDate(d);
          setShowStartPicker(false);
        }}
        maximumDate={null}
      />
      <CalendarModal
        visible={showMaturityPicker}
        onClose={() => setShowMaturityPicker(false)}
        value={maturityDate || startDate}
        onChange={(d) => {
          setMaturityDate(d);
          setShowMaturityPicker(false);
        }}
        maximumDate={null}
      />
      <AccountPickerSheet
        visible={showAccountPicker}
        onSelect={handleSelectAccount}
        onClose={() => setShowAccountPicker(false)}
        title="Funded from / pays back to"
        filterTypes={["savings", "wallet"]}
      />
    </ScreenContainer>
  );
}
