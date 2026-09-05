import { useState, useRef } from "react";
import { View, ScrollView, Pressable, Keyboard } from "react-native";
import { useRouter } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Button, DateInput, Input, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import { formatError } from "@/utils/error-message";
import { logger } from "@/utils/logger";
import { createManualAccount, addOrUpdateSnapshot } from "@/services/financial-account";
import type { AccountType } from "@/services/financial-account";
import { DEFAULT_USER_ID } from "@/constants/app";
import type { AlertButton } from "@/hooks/use-alert";

const TYPE_OPTIONS: AccountType[] = [
  "savings",
  "credit_card",
  "loan",
  "wallet",
  "demat",
  "pension",
];

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  savings: "Savings",
  credit_card: "Credit Card",
  loan: "Loan",
  wallet: "Wallet",
  demat: "Demat",
  pension: "Pension",
};

export default function AccountAddScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { accent, colorScheme } = useColorScheme();
  const scrollRef = useRef<ScrollView>(null);

  const [accountType, setAccountType] = useState<AccountType>("savings");

  // Bank account fields (savings, credit_card, loan)
  const [bankName, setBankName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [label, setLabel] = useState("");

  // Demat account fields
  const [dematName, setDematName] = useState("");
  const [dematAccountNumber, setDematAccountNumber] = useState("");
  const [fundBalance, setFundBalance] = useState("");
  const [portfolioValue, setPortfolioValue] = useState("");
  const [snapshotDate, setSnapshotDate] = useState(
    new Date().toISOString().split("T")[0],
  );

  const [loading, setLoading] = useState(false);

  const isDemat = accountType === "demat";
  const isSimple = accountType === "wallet";

  const handleSave = async () => {
    if (isDemat) {
      if (!dematName.trim()) {
        alert("Error", "Account name is required.");
        return;
      }
    } else if (isSimple) {
      // No mandatory fields — balance defaults to 0
    } else {
      if (!bankName.trim()) {
        alert("Error", "Bank name is required.");
        return;
      }
      if (!identifier.trim()) {
        alert("Error", "Last 4 digits are required.");
        return;
      }
    }

    setLoading(true);
    try {
      if (isDemat) {
        const fund = fundBalance
          ? parseFloat(fundBalance.replace(/,/g, ""))
          : 0;
        const id = await createManualAccount({
          userId: DEFAULT_USER_ID,
          bankName: dematName.trim(),
          accountType: "demat",
          accountIdentifier: dematAccountNumber.trim() || dematName.trim(),
          accountLabel: dematName.trim(),
          fundBalance: isNaN(fund) ? 0 : fund,
          accountNumber: dematAccountNumber.trim() || undefined,
        });

        const pv = portfolioValue
          ? parseFloat(portfolioValue.replace(/,/g, ""))
          : 0;
        if (pv > 0 && snapshotDate) {
          await addOrUpdateSnapshot(id, snapshotDate, pv);
        }
      } else if (isSimple) {
        await createManualAccount({
          userId: DEFAULT_USER_ID,
          bankName: label.trim() || "Wallet",
          accountType: "wallet",
          accountIdentifier: "0000",
          accountLabel: label.trim() || undefined,
        });
      } else {
        const newId = await createManualAccount({
          userId: DEFAULT_USER_ID,
          bankName: bankName.trim(),
          accountType,
          accountIdentifier: identifier.trim(),
          accountLabel: label.trim() || undefined,
        });

        // Offer to add credentials for banking accounts
        if (accountType === "savings" || accountType === "credit_card" || accountType === "loan") {
          const buttons: AlertButton[] = [
            {
              text: "Add credentials",
              onPress: () => {
                const prefillCategory = accountType === "savings" ? "banking" : "card";
                router.replace(
                  `/vault/add?linked_account_id=${newId}&prefill_category=${prefillCategory}&prefill_title=${encodeURIComponent(label.trim() || bankName.trim())}`,
                );
              },
            },
            { text: "Not now", style: "cancel" as const, onPress: () => router.back() },
          ];
          alert(
            "Add credentials?",
            `Save login details for ${label.trim() || bankName.trim()} to your vault?`,
            buttons,
          );
          return;
        }
      }
      router.back();
    } catch (e) {
      logger.error("Save account failed:", e);
      alert("Error", formatError("Save account", e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer padTop={false} keyboardAware>
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-4 py-4">
          {/* Account Type Picker */}
          <Text className="text-xs font-semibold text-faint-foreground uppercase tracking-wider mb-3">
            Account Type
          </Text>
          <View className="flex-row flex-wrap mb-4">
            {TYPE_OPTIONS.map((t) => (
              <Pressable
                key={t}
                onPress={() => setAccountType(t)}
                className={`px-4 py-3 rounded-lg mr-2 mb-2 border ${
                  accountType === t
                    ? ""
                    : "bg-card border-transparent"
                }`}
                style={
                  accountType === t
                    ? {
                        backgroundColor: ac(accent, colorScheme, 100, 700),
                        borderColor: ac(accent, colorScheme, 600, 300),
                      }
                    : undefined
                }
              >
                <Text
                  className={`text-sm ${
                    accountType === t
                      ? "font-medium"
                      : "text-muted-foreground"
                  }`}
                  style={
                    accountType === t
                      ? { color: ac(accent, colorScheme, 500, 200) }
                      : undefined
                  }
                >
                  {ACCOUNT_TYPE_LABELS[t]}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* ── Bank Detail Fields (savings, credit_card, loan) ── */}
          {!isDemat && !isSimple && (
            <>
              <Input
                label="Bank Name"
                value={bankName}
                onChangeText={setBankName}
                placeholder="e.g., HDFC Bank, ICICI Bank, SBI"
                maxLength={100}
                containerClassName="mb-4"
              />
              <Input
                label="Last 4 Digits"
                value={identifier}
                onChangeText={setIdentifier}
                placeholder="e.g., 3001"
                keyboardType="numeric"
                maxLength={4}
                containerClassName="mb-4"
              />
              <Input
                label="Nickname (optional)"
                value={label}
                onChangeText={setLabel}
                placeholder="e.g., Salary Account, Amazon CC"
                maxLength={50}
                containerClassName="mb-6"
              />
            </>
          )}

          {/* ── Simple Fields (wallet) ── */}
          {isSimple && (
            <Input
              label="Nickname (optional)"
              value={label}
              onChangeText={setLabel}
              placeholder="e.g., Paytm, PhonePe"
              maxLength={50}
              containerClassName="mb-6"
            />
          )}

          {/* ── Demat Fields ── */}
          {isDemat && (
            <>
              <Input
                label="Account Name"
                value={dematName}
                onChangeText={setDematName}
                placeholder="e.g., Zerodha, Groww, ICICI Direct"
                maxLength={100}
                containerClassName="mb-4"
              />
              <Input
                label="Account Number (optional)"
                value={dematAccountNumber}
                onChangeText={setDematAccountNumber}
                placeholder="e.g., DP ID or account number"
                maxLength={20}
                containerClassName="mb-4"
              />
              <Input
                label="Fund Balance (idle cash)"
                value={fundBalance}
                onChangeText={setFundBalance}
                placeholder="0"
                keyboardType="numeric"
                formula
                containerClassName="mb-4"
                onFocus={() => {
                  const sub = Keyboard.addListener("keyboardDidShow", () => {
                    scrollRef.current?.scrollToEnd({ animated: true });
                    sub.remove();
                  });
                  setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 400);
                }}
              />
              <Input
                label="Initial Portfolio Value (optional)"
                value={portfolioValue}
                onChangeText={setPortfolioValue}
                placeholder="Current total portfolio value"
                keyboardType="numeric"
                formula
                containerClassName="mb-2"
                onFocus={() => {
                  const sub = Keyboard.addListener("keyboardDidShow", () => {
                    scrollRef.current?.scrollToEnd({ animated: true });
                    sub.remove();
                  });
                  setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 400);
                }}
              />
              {portfolioValue.length > 0 && (
                <DateInput
                  label="Value as of"
                  value={snapshotDate}
                  onChange={setSnapshotDate}
                  containerClassName="mb-6"
                />
              )}
              {!portfolioValue.length && <View className="mb-4" />}
            </>
          )}

          <Button
            title="Add Account"
            onPress={handleSave}
            loading={loading}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
