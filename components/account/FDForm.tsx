import { useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAlert } from "@/hooks/use-alert";
import { Button, Card, Input, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { CalendarModal } from "@/components/ui/CalendarModal";
import { AccountPickerSheet } from "@/components/expense/AccountPickerSheet";
import { BucketLinkPicker } from "@/components/account/BucketLinkPicker";
import { BankPicker } from "@/components/account/BankPicker";
import { FDTermInput } from "@/components/account/FDTermInput";
import { FDRenewalPicker } from "@/components/account/FDRenewalPicker";
import { createFDAccount, linkFDToBucket, type FDRenewalMode } from "@/services/investment-accounts";
import { computeFDMaturityValue, type CompoundingFreq, type InterestMethod } from "@/services/investment-engine";
import { getAccountById } from "@/services/financial-account";
import { DEFAULT_USER_ID } from "@/constants/app";
import { logger } from "@/utils/logger";
import { formatAmount } from "@/utils/format";
import { formatDate, todayIso } from "@/utils/date";
import { formatError } from "@/utils/error-message";
import { useTheme } from "@/hooks/use-theme";

const COMPOUNDING_OPTIONS: { value: CompoundingFreq; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annually", label: "Annually" },
];

interface FDFormProps {
  /** Called with the new FD account's id once it's saved. */
  onSaved: (fdAccountId: string) => void;
  initialBankName?: string;
}

/**
 * The "add a fixed deposit" form, shared by Investments → Add FD
 * (app/investments/add-fd.tsx) and Add account (app/settings/account-add.tsx),
 * where it shows below the type picker like every other type. Renders its
 * own cards and Save button but no ScrollView — the screen supplies that.
 */
export function FDForm({ onSaved, initialBankName }: FDFormProps) {
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();

  const [bankName, setBankName] = useState(initialBankName ?? "");
  const [accountIdentifier, setAccountIdentifier] = useState("");
  const [principal, setPrincipal] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [interestMethod, setInterestMethod] = useState<InterestMethod>("compound");
  const [compoundingFreq, setCompoundingFreq] = useState<CompoundingFreq>("quarterly");
  const [startDate, setStartDate] = useState(todayIso());
  const [maturityDate, setMaturityDate] = useState("");
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [sourceAccountId, setSourceAccountId] = useState<string | null>(null);
  const [sourceAccountLabel, setSourceAccountLabel] = useState<string | null>(null);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [renewalMode, setRenewalMode] = useState<FDRenewalMode>("none");
  const [bucketId, setBucketId] = useState<string | null>(null);
  // The bank's own figures, when they differ from Arth's (null = use Arth's).
  const [corrected, setCorrected] = useState<{ maturity: string; interest: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const p = parseFloat(principal);

  const projectedValue = useMemo(() => {
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
  }, [p, interestRate, startDate, maturityDate, interestMethod, compoundingFreq]);

  const handleSelectAccount = useCallback(
    async (accountId: string) => {
      setSourceAccountId(accountId);
      setShowAccountPicker(false);
      try {
        const account = await getAccountById(accountId);
        setSourceAccountLabel(account ? (account.account_label ?? `${account.bank_name} ••••${account.account_identifier}`) : null);
        // Most FDs are opened with the bank that holds the funding account.
        if (account && account.account_type !== "wallet" && !bankName.trim()) setBankName(account.bank_name);
      } catch {
        setSourceAccountLabel(null);
      }
    },
    [bankName],
  );

  const startCorrecting = () => {
    if (projectedValue == null) return;
    setCorrected({ maturity: projectedValue.toFixed(0), interest: (projectedValue - p).toFixed(0) });
  };

  const handleSave = useCallback(async () => {
    const errors: string[] = [];
    if (!bankName.trim()) errors.push("Bank name is required.");
    const identifier = accountIdentifier.replace(/\s+/g, "");
    if (!identifier) errors.push("An account/receipt number is required to tell FDs at the same bank apart.");
    if (!(p > 0)) errors.push("Principal must be a positive amount.");
    const r = parseFloat(interestRate);
    if (!(r > 0)) errors.push("Interest rate must be a positive number.");
    if (!maturityDate) errors.push("Maturity date or term is required.");
    else if (maturityDate <= startDate) errors.push("Maturity date must be after the start date.");
    if (!sourceAccountId) errors.push("Choose which account this FD was funded from (and will pay back to).");
    const correctedValue = corrected ? parseFloat(corrected.maturity) : null;
    if (corrected && !(correctedValue! > p)) errors.push("The corrected maturity amount must be more than the principal.");

    if (errors.length > 0) {
      alert("Fix these fields", errors.join("\n"));
      return;
    }

    setSaving(true);
    try {
      const fdAccountId = await createFDAccount({
        user_id: DEFAULT_USER_ID,
        bank_name: bankName.trim(),
        account_identifier: identifier,
        principal: p,
        interest_rate_pa: r,
        interest_method: interestMethod,
        compounding_freq: interestMethod === "compound" ? compoundingFreq : undefined,
        start_date: startDate,
        maturity_date: maturityDate,
        source_account_id: sourceAccountId!,
        renewal_mode: renewalMode,
        // Only a figure that actually differs from Arth's is a correction.
        maturity_amount_override:
          correctedValue != null && projectedValue != null && Math.abs(correctedValue - projectedValue) >= 0.01
            ? correctedValue
            : null,
      });
      if (bucketId) {
        try {
          await linkFDToBucket(fdAccountId, bucketId);
        } catch (e) {
          // The FD itself is saved; only the bucket link failed. Say so instead of losing the FD.
          logger.error("Link new FD to bucket failed:", e);
          alert(
            "FD saved",
            "The fixed deposit is saved, but it couldn't be linked to the bucket. Open it from Investments to try again.",
          );
        }
      }
      onSaved(fdAccountId);
    } catch (e) {
      alert("Couldn't save", formatError("Save fixed deposit", e));
    } finally {
      setSaving(false);
    }
  }, [
    bankName, accountIdentifier, p, interestRate, interestMethod, compoundingFreq, startDate, maturityDate,
    sourceAccountId, renewalMode, corrected, projectedValue, bucketId, alert, onSaved,
  ]);

  const chip = (active: boolean) => ({
    backgroundColor: active ? theme.primary + "20" : colors.surface,
    borderColor: active ? theme.primary : colors.border,
  });

  return (
    <>
      <Card>
        <BankPicker value={bankName} onChange={setBankName} className="mb-2" />
        <Input
          label="FD account / receipt number"
          value={accountIdentifier}
          onChangeText={setAccountIdentifier}
          placeholder="As shown on the FD receipt (letters allowed)"
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </Card>

      <Card className="mt-3">
        <Input
          label="Principal amount"
          value={principal}
          onChangeText={setPrincipal}
          placeholder="e.g. 100000"
          keyboardType="numeric"
          formula
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
                style={chip(active)}
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
                    style={chip(active)}
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
        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Starts</Text>
        <Pressable
          onPress={() => setShowStartPicker(true)}
          className="flex-row items-center justify-between border border-border rounded-lg px-3 py-3 mb-3"
        >
          <Text className="text-sm text-foreground">{formatDate(startDate)}</Text>
          <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
        </Pressable>

        <FDTermInput startDate={startDate} value={maturityDate} onChange={setMaturityDate} />
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
          The deposit moves out of this account now. At maturity, what the FD pays out lands here as a credit for you to review.
        </Text>
      </Card>

      <Card className="mt-3">
        <FDRenewalPicker value={renewalMode} onChange={setRenewalMode} />
      </Card>

      <BucketLinkPicker value={bucketId} onChange={setBucketId} className="mt-3" />

      {projectedValue != null && (
        <Card className="mt-3">
          {corrected == null ? (
            <>
              <View className="flex-row justify-between items-end">
                <View>
                  <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Maturity amount
                  </Text>
                  <Text className="text-lg font-bold" style={{ color: theme.success }}>
                    {formatAmount(projectedValue)}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="text-xs text-muted-foreground mb-1">Interest</Text>
                  <Text className="text-sm font-semibold text-foreground">{formatAmount(projectedValue - p)}</Text>
                </View>
              </View>
              <Pressable onPress={startCorrecting} className="mt-3" accessibilityRole="button">
                <Text className="text-sm font-medium" style={{ color: theme.primary }}>
                  {"Bank's figure differs? Correct it"}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                As on your FD receipt
              </Text>
              <View className="flex-row gap-2">
                <Input
                  label="Maturity amount"
                  value={corrected.maturity}
                  onChangeText={(t) => {
                    const m = parseFloat(t);
                    setCorrected({ maturity: t, interest: Number.isFinite(m) ? (m - p).toFixed(2).replace(/\.00$/, "") : "" });
                  }}
                  keyboardType="numeric"
                  containerClassName="flex-1"
                />
                <Input
                  label="Interest"
                  value={corrected.interest}
                  onChangeText={(t) => {
                    const i = parseFloat(t);
                    setCorrected({ interest: t, maturity: Number.isFinite(i) ? (p + i).toFixed(2).replace(/\.00$/, "") : "" });
                  }}
                  keyboardType="numeric"
                  containerClassName="flex-1"
                />
              </View>
              <Text className="text-xs text-faint-foreground">Arth worked out {formatAmount(projectedValue)}.</Text>
              <Pressable onPress={() => setCorrected(null)} className="mt-2" accessibilityRole="button">
                <Text className="text-sm font-medium" style={{ color: theme.primary }}>
                  {"Use Arth's figure"}
                </Text>
              </Pressable>
            </>
          )}
        </Card>
      )}

      <Button title={saving ? "Saving…" : "Save fixed deposit"} onPress={handleSave} disabled={saving} className="mt-4" />

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
      <AccountPickerSheet
        visible={showAccountPicker}
        onSelect={handleSelectAccount}
        onClose={() => setShowAccountPicker(false)}
        title="Funded from / pays back to"
        filterTypes={["savings", "wallet"]}
      />
    </>
  );
}
