import { AmountInput } from "@/components/expense/AmountInput";
import {
    AccountPicker,
    CategoryPicker,
    DateSelector,
    MerchantPicker,
    PaymentModePicker,
    RightSpendToggle,
} from "@/components/expense/ExpenseFormFields";
import { SplitSheet } from "@/components/expense/SplitSheet";
import { TagPicker } from "@/components/expense/TagPicker";
import { Button, Input, ScreenContainer } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getLinkedModesForAccount } from "@/services/account-master";
import type { Category } from "@/services/category";
import { getCategories } from "@/services/category";
import type { SplitConfig } from "@/services/expense";
import {
    computeSplitAmounts,
    createExpense,
    createSplitTender,
    fulfillReminder,
    getActiveRecurringRules,
    getExpenseById,
    MAX_PURCHASE_GROUP_LEGS,
    splitNewExpense,
} from "@/services/expense";
import { adjustSplitAfterRefund } from "@/services/expense-splits";
import type { FinancialAccount } from "@/services/financial-account";
import { getActiveAccounts } from "@/services/financial-account";
import type { HisaabPersonWithBalance } from "@/services/hisaab";
import { getPersonsWithBalances } from "@/services/hisaab";
import { getDistinctMerchantNames } from "@/services/merchant-alias";
import type { PaymentMode } from "@/services/payment-mode";
import { getPaymentModes } from "@/services/payment-mode";
import { addTagsToExpense } from "@/services/tags";
import { ac } from "@/utils/accent";
import { formatError } from "@/utils/error-message";
import type { ExpenseValidationErrors } from "@/utils/expense-validation";
import {
    formatDateForStorage,
    parseAmount,
    validateExpense,
} from "@/utils/expense-validation";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    Keyboard,
    KeyboardAvoidingView,
    Pressable,
    ScrollView,
    Text,
    View,
} from "react-native";



export default function AddExpenseScreen() {
  const alert = useAlert();
  const router = useRouter();
  const params = useLocalSearchParams<{
    type?: string;
    linkExpenseId?: string;
    copyFromExpenseId?: string;
    fulfillsReminderId?: string;
    refundAccountId?: string;
    prefillAmount?: string;
    prefillMerchant?: string;
    prefillDescription?: string;
    prefillPaymentModeId?: string;
    prefillAccountId?: string;
    prefillCategoryId?: string;
    prefillDate?: string;
    prefillSplitPersonId?: string;
  }>();
  const isRefund = params.type === "refund";
  const linkedExpenseId = params.linkExpenseId ?? null;
  const copyFromExpenseId = params.copyFromExpenseId ?? null;
  const fulfillsReminderId = params.fulfillsReminderId ?? null;
  const refundAccountId = params.refundAccountId ?? null;
  const { accent, colorScheme, colors } = useColorScheme();
  const scrollRef = useRef<ScrollView>(null);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);

  // Form state
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [paymentModeId, setPaymentModeId] = useState<string | null>(null);
  const [date, setDate] = useState(formatDateForStorage(new Date()));
  const [isRightSpend, setIsRightSpend] = useState(true);
  const [errors, setErrors] = useState<ExpenseValidationErrors>({});
  const [saving, setSaving] = useState(false);

  // Tags state
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  // Set when duplicating a credit — so the new row is saved as nature='credit'
  const [isCreditDuplicate, setIsCreditDuplicate] = useState(false);

  // Split state
  const [showSplitSheet, setShowSplitSheet] = useState(false);
  const [splitConfig, setSplitConfig] = useState<SplitConfig | null>(null);
  const [persons, setPersons] = useState<HisaabPersonWithBalance[]>([]);

  // Refund split state — used when the linked expense was split with exact amounts.
  // The user must specify how much of this refund belongs to the other person.
  const [linkedExpenseSplitMode, setLinkedExpenseSplitMode] = useState<string | null>(null);
  const [otherPersonRefundShare, setOtherPersonRefundShare] = useState("");

  // Account state (V4)
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [showAccounts, setShowAccounts] = useState(false);

  // Split-tender state — extra payment legs (primary is the main amount/account
  // above). A 2-leg purchase has 1 extra leg here; cap is 3 total legs, so
  // max 2 extras. Each extra captures its own amount, account, payment mode.
  interface ExtraLeg {
    key: string;
    amount: string;
    accountId: string | null;
    paymentModeId: string | null;
    showAccounts: boolean;
    showPaymentModes: boolean;
  }
  const [extraLegs, setExtraLegs] = useState<ExtraLeg[]>([]);
  const MAX_EXTRA_LEGS = MAX_PURCHASE_GROUP_LEGS - 1;

  // Picker data
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  const [merchantNames, setMerchantNames] = useState<string[]>([]);
  const [showCategories, setShowCategories] = useState(false);
  const [showPaymentModes, setShowPaymentModes] = useState(false);
  const [showMerchants, setShowMerchants] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const [cats, pms, ppl, accts, merchants] = await Promise.all([
          getCategories(DEFAULT_USER_ID),
          getPaymentModes(DEFAULT_USER_ID),
          getPersonsWithBalances(DEFAULT_USER_ID),
          getActiveAccounts(DEFAULT_USER_ID),
          getDistinctMerchantNames(DEFAULT_USER_ID),
        ]);
        setCategories(cats);
        setPaymentModes(pms);
        setPersons(ppl);
        setAccounts(accts);
        setMerchantNames(merchants);
        if (params.prefillSplitPersonId) {
          const p = ppl.find((x) => x.id === params.prefillSplitPersonId);
          if (p) setSplitConfig({ paidBy: "me", splitMode: "equal", personId: p.id });
        }
      } catch {
        // Database not ready
      }
    }
    loadData();
  }, []);

  // Prefill form from a linked expense when recording a refund against it.
  // Amount defaults to the linked expense amount but user can override for
  // partial refunds. Account routes from `refundAccountId` URL param (chosen
  // via RefundTargetSheet); falls back to the linked expense's account only
  // when the param isn't set (older entry points).
  useEffect(() => {
    if (!linkedExpenseId) return;
    (async () => {
      try {
        const linked = await getExpenseById(linkedExpenseId);
        if (!linked) return;

        // Calculate remaining refundable amount to prevent exceeding original value
        const originalAmount = linked.split_original_amount ?? linked.amount;
        const { getRefundedAmount } = await import("@/services/expense");
        const alreadyRefunded = await getRefundedAmount(linkedExpenseId);
        const remainingRefundable = Math.max(0, originalAmount - alreadyRefunded);

        setAmount(String(remainingRefundable));
        if (linked.merchant_name) setMerchantName(linked.merchant_name);
        if (linked.description) setDescription(`Refund for: ${linked.description}`);
        if (refundAccountId) {
          setAccountId(refundAccountId);
        } else if (linked.account_id) {
          setAccountId(linked.account_id);
        }
        if (linked.category_id) setCategoryId(linked.category_id);
        if (linked.payment_mode_id) setPaymentModeId(linked.payment_mode_id);
        // Capture split mode so we know whether to ask for the other person's refund share.
        if (linked.split_original_amount) {
          setLinkedExpenseSplitMode((linked.split_mode as string | null) ?? null);
        }
      } catch (e) {
        logger.warn("Load linked expense failed:", e);
      }
    })();
  }, [linkedExpenseId, refundAccountId]);

  // Fulfill-reminder flow — user tapped "Log new expense" on a pending
  // reminder. Prefill merchant/category/account/PM/description from the
  // rule's source expense, but leave AMOUNT BLANK (utility-based amounts
  // vary, per user feedback). On save, the effect at handleSave bottom
  // calls fulfillReminder to link the new expense to the reminder.
  useEffect(() => {
    if (!fulfillsReminderId) return;
    (async () => {
      try {
        const rules = await getActiveRecurringRules(DEFAULT_USER_ID);
        const rule = rules.find((r) => r.id === fulfillsReminderId);
        if (!rule) return;
        const src = await getExpenseById(rule.source_expense_id);
        if (!src) return;
        // Amount intentionally not prefilled.
        if (src.merchant_name) setMerchantName(src.merchant_name);
        if (src.description) setDescription(src.description);
        if (src.category_id) setCategoryId(src.category_id);
        if (src.payment_mode_id) setPaymentModeId(src.payment_mode_id);
        if (src.account_id) setAccountId(src.account_id);
        if (src.is_right_spend !== null) setIsRightSpend(src.is_right_spend === 1);
      } catch (e) {
        logger.warn("Load reminder source failed:", e);
      }
    })();
  }, [fulfillsReminderId]);

  // Duplicate flow — prefill from a source expense but leave the date at
  // today (user typically wants "same expense, today"). Inherits merchant,
  // amount, category, account, payment mode, is_right_spend, description.
  // Split + tags NOT copied in v1 — user can re-split after creating; copying
  // a split config would silently put someone in the hisaab ledger without
  // the user noticing. Explicit is safer.
  useEffect(() => {
    if (!copyFromExpenseId) return;
    getExpenseById(copyFromExpenseId)
      .then((src) => {
        if (!src) return;
        const totalAmount = src.split_original_amount ?? src.amount;
        setAmount(String(totalAmount));
        if (src.merchant_name) setMerchantName(src.merchant_name);
        if (src.description) setDescription(src.description);
        if (src.category_id) setCategoryId(src.category_id);
        if (src.payment_mode_id) setPaymentModeId(src.payment_mode_id);
        if (src.account_id) setAccountId(src.account_id);
        if (src.is_right_spend !== null) setIsRightSpend(src.is_right_spend === 1);
        if (src.nature === "credit") setIsCreditDuplicate(true);
      })
      .catch((e) => logger.warn("Load source expense for duplicate failed:", e));
  }, [copyFromExpenseId]);

  // Voice pre-fill — applied once on mount when navigated from VoiceEntrySheet.
  // IDs are already resolved by VoiceEntrySheet, so direct assignment is safe.
  useEffect(() => {
    const { prefillAmount, prefillMerchant, prefillDescription, prefillDate,
            prefillPaymentModeId, prefillAccountId, prefillCategoryId } = params;
    if (!prefillAmount && !prefillMerchant && !prefillDescription && !prefillDate &&
        !prefillPaymentModeId && !prefillAccountId && !prefillCategoryId &&
        !params.prefillSplitPersonId) return;
    if (prefillAmount) {
      const n = parseFloat(prefillAmount);
      if (!isNaN(n) && n > 0) { setAmount(String(n)); setErrors((e) => ({ ...e, amount: undefined })); }
    }
    if (prefillMerchant) setMerchantName(prefillMerchant);
    if (prefillDescription) setDescription(prefillDescription);
    if (prefillDate) setDate(prefillDate);
    if (prefillPaymentModeId) setPaymentModeId(prefillPaymentModeId);
    if (prefillAccountId) setAccountId(prefillAccountId);
    if (prefillCategoryId) setCategoryId(prefillCategoryId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh accounts when returning from account-add screen
  useFocusEffect(
    useCallback(() => {
      getActiveAccounts(DEFAULT_USER_ID).then(setAccounts).catch((e) => logger.warn("Load accounts failed:", e));
    }, []),
  );

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const selectedPaymentMode = paymentModes.find((p) => p.id === paymentModeId);
  const selectedAccount = accounts.find((a) => a.id === accountId);

  // V4: Auto-suggest payment mode when account changes
  const handleAccountSelect = useCallback(
    async (acctId: string | null) => {
      setAccountId(acctId);
      setShowAccounts(false);
      if (!acctId) return;
      const linkedModes = await getLinkedModesForAccount(acctId);
      if (linkedModes.length === 1) {
        setPaymentModeId(linkedModes[0].id);
      } else if (linkedModes.length > 1) {
        // Filter payment mode list to show linked modes first — user picks
        setShowPaymentModes(true);
      }
    },
    [],
  );

  const splitPerson = splitConfig ? persons.find((p) => p.id === splitConfig.personId) : null;
  const parsedAmountForPreview = parseAmount(amount) ?? 0;
  const splitPreview = splitConfig && parsedAmountForPreview > 0
    ? computeSplitAmounts(parsedAmountForPreview, splitConfig)
    : null;

  // Post-save navigation: Duplicate and Refund were launched from an expense
  // detail screen, so router.back() would return to that stale source. Land
  // the user on the expenses list instead so they see the new row they just
  // created. Refunds additionally pre-filter the list to Refunded expenses.
  const navigateAfterSave = useCallback(() => {
    if (copyFromExpenseId) {
      router.dismissAll();
      if (isCreditDuplicate) {
        router.replace({ pathname: "/(tabs)/expenses", params: { preset: "credits" } });
      } else {
        router.replace("/(tabs)/expenses");
      }
      return;
    }
    if (isRefund) {
      router.dismissAll();
      router.replace({ pathname: "/(tabs)/expenses", params: { preset: "credits" } });
      return;
    }
    router.back();
  }, [router, copyFromExpenseId, isRefund, isCreditDuplicate]);

  const handleSave = useCallback(async () => {
    const validationErrors = validateExpense({
      amount,
      description,
      category_id: categoryId,
      payment_mode_id: paymentModeId,
      date,
      is_right_spend: isRightSpend,
    });

    if (validationErrors) {
      setErrors(validationErrors);
      return;
    }

    // Extra-leg validation
    if (extraLegs.length > 0) {
      for (const leg of extraLegs) {
        const legAmt = parseAmount(leg.amount);
        if (legAmt == null || legAmt <= 0) {
          alert("Check Payment Sources", "Every extra payment leg needs a positive amount.");
          return;
        }
      }
      if (splitConfig) {
        alert(
          "Can't Combine",
          "Split-with-someone and multi-payment sources can't be used together. Remove one before saving.",
        );
        return;
      }
      if (isRefund) {
        alert("Not Supported", "Refunds can't be split across multiple payment sources.");
        return;
      }
    }

    setErrors({});
    setSaving(true);

    try {
      const parsedAmount = parseAmount(amount)!;

      // Validate refund amount doesn't exceed remaining refundable amount
      if (isRefund && linkedExpenseId) {
        const linked = await getExpenseById(linkedExpenseId);
        if (linked) {
          const originalAmount = linked.split_original_amount ?? linked.amount;
          const { getRefundedAmount } = await import("@/services/expense");
          const alreadyRefunded = await getRefundedAmount(linkedExpenseId);
          const remainingRefundable = Math.max(0, originalAmount - alreadyRefunded);
          if (parsedAmount > remainingRefundable) {
            alert("Invalid Refund Amount", `Refund amount cannot exceed the remaining refundable amount of ₹${remainingRefundable.toLocaleString("en-IN")}.`);
            setSaving(false);
            return;
          }
        }
      }

      // Split-tender path: create 2-3 linked expenses sharing a purchase_group_id.
      if (extraLegs.length > 0) {
        const shared = {
          user_id: DEFAULT_USER_ID,
          description: description.trim() || undefined,
          merchant_name: merchantName.trim() || undefined,
          category_id: categoryId ?? undefined,
          date,
          is_right_spend: isRightSpend ? 1 : 0,
        };
        const legs = [
          { amount: parsedAmount, account_id: accountId, payment_mode_id: paymentModeId },
          ...extraLegs.map((l) => ({
            amount: parseAmount(l.amount)!,
            account_id: l.accountId,
            payment_mode_id: l.paymentModeId,
          })),
        ];
        const { expenseIds } = await createSplitTender({ shared, legs });
        // Apply tags to every leg so list filters behave consistently.
        await Promise.all(
          expenseIds.map((id) => addTagsToExpense(id, selectedTagIds)),
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        navigateAfterSave();
        return;
      }

      const expenseInput = {
        user_id: DEFAULT_USER_ID,
        amount: parsedAmount,
        description: description.trim() || undefined,
        merchant_name: merchantName.trim() || undefined,
        category_id: categoryId ?? undefined,
        payment_mode_id: paymentModeId ?? undefined,
        account_id: accountId,
        date,
        is_right_spend: isRightSpend ? 1 : 0,
        ...(isRefund
          ? { nature: "credit" as const, refund_of_expense_id: linkedExpenseId }
          : isCreditDuplicate
          ? { nature: "credit" as const }
          : {}),
      };

      let createdId: string;
      // Refunds don't split — skip splitNewExpense path even if splitConfig exists.
      if (splitConfig && !isRefund) {
        createdId = await splitNewExpense(expenseInput, parsedAmount, splitConfig);
      } else {
        createdId = await createExpense(expenseInput);
      }

      // Apply selected tags (batched)
      await addTagsToExpense(createdId, selectedTagIds);

      // Adjust split hisaab if this is a refund against a split expense.
      if (isRefund && linkedExpenseId) {
        try {
          const parsedOtherShare = parseAmount(otherPersonRefundShare) ?? 0;
          await adjustSplitAfterRefund(linkedExpenseId, parsedAmount, parsedOtherShare > 0 ? parsedOtherShare : undefined);
        } catch (e) {
          logger.warn("adjustSplitAfterRefund failed (non-fatal):", e);
        }
      }

      // If this save came from a reminder, link the new expense to it. A
      // failure here shouldn't block — the expense still saved; the user
      // can link later from the expense detail suggestion.
      if (fulfillsReminderId) {
        try {
          await fulfillReminder(fulfillsReminderId, createdId);
        } catch (e) {
          logger.warn("Auto-link to reminder failed:", e);
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigateAfterSave();
    } catch (e) {
      logger.error("Save expense failed:", e);
      alert("Error", formatError("Save expense", e));
    } finally {
      setSaving(false);
    }
  }, [amount, description, merchantName, categoryId, paymentModeId, accountId, date, isRightSpend, splitConfig, selectedTagIds, extraLegs, isRefund, linkedExpenseId, otherPersonRefundShare, fulfillsReminderId, alert, navigateAfterSave]);

  const handleDateShift = useCallback(
    (days: number) => {
      const current = new Date(date + "T00:00:00");
      current.setDate(current.getDate() + days);
      // Don't allow future dates
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (current > today) return;
      setDate(formatDateForStorage(current));
    },
    [date],
  );


  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        behavior="padding"
        className="flex-1"
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-border-light dark:border-border-dark">
          <Pressable onPress={() => router.back()} className="p-2 -ml-2">
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </Pressable>
          <Text className="text-lg font-semibold text-text-primary dark:text-text-dark-primary">
            {isRefund ? (linkedExpenseId ? "Add Linked Refund" : "Add Refund") : "Add Expense"}
          </Text>
          <View className="w-10" />
        </View>

        <ScrollView
          ref={scrollRef}
          className="flex-1"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: tagPickerOpen ? 320 : 40 }}
        >
          <View className="p-4">
            {/* Amount — Large prominent input */}
            <AmountInput
              value={amount}
              onChangeText={(text) => {
                setAmount(text);
                if (errors.amount) setErrors((e) => ({ ...e, amount: undefined }));
              }}
              error={errors.amount}
              autoFocus={!params.prefillAmount && !params.prefillMerchant && !params.prefillPaymentModeId}
            />

            {/* Split with someone — hidden for refunds (doesn't make sense to split a refund) */}
            {!isRefund && (
            <View className="mb-4">
              {splitConfig && splitPreview ? (
                <Pressable
                  onPress={() => setShowSplitSheet(true)}
                  className="p-4 rounded-xl border"
                  style={{ backgroundColor: ac(accent, colorScheme, 50, 900), borderColor: ac(accent, colorScheme, 200, 700) }}
                >
                  <View className="flex-row items-center justify-between mb-2">
                    <View className="flex-row items-center">
                      <Ionicons name="people" size={18} color={accent[500]} />
                      <Text className="ml-2 text-sm font-semibold" style={{ color: ac(accent, colorScheme, 600, 300) }}>
                        Split with {splitPerson?.name ?? "someone"}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => setSplitConfig(null)}
                      className="p-1"
                    >
                      <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                    </Pressable>
                  </View>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                      My budget: {"\u20B9"}{splitPreview.myBudgetAmount.toLocaleString("en-IN")}
                    </Text>
                    <Text className="text-xs text-orange-600 dark:text-orange-300">
                      {splitPreview.hisaabType === "debit" ? "They owe" : "I owe"}: {"\u20B9"}{splitPreview.hisaabAmount.toLocaleString("en-IN")}
                    </Text>
                  </View>
                  <Text className="text-[10px] text-text-tertiary mt-1">Tap to change</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => setShowSplitSheet(true)}
                  className="flex-row items-center rounded-lg border border-border-light dark:border-border-dark bg-white dark:bg-surface-dark-alt px-4 py-3"
                >
                  <Ionicons name="people-outline" size={20} color={colors.textSecondary} />
                  <Text className="ml-3 text-base font-medium text-text-primary dark:text-text-dark-primary">
                    Split with someone?
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} style={{ marginLeft: "auto" }} />
                </Pressable>
              )}
            </View>
            )}

            {!isRefund && (
            <SplitSheet
              visible={showSplitSheet}
              onClose={() => setShowSplitSheet(false)}
              totalAmount={parsedAmountForPreview}
              onConfirm={(config) => setSplitConfig(config)}
            />
            )}

            {/* Other person's refund share — only for exact-amount splits */}
            {isRefund && linkedExpenseSplitMode === 'exact' && (
              <View className="mb-4 p-4 rounded-xl border border-border-light dark:border-border-dark bg-surface-light-alt dark:bg-surface-dark-alt">
                <View className="flex-row items-center mb-3">
                  <Ionicons name="people-outline" size={16} color={colors.textSecondary} />
                  <Text className="ml-2 text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                    Split refund
                  </Text>
                </View>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-3">
                  This expense was split by exact amount. How much of this refund goes back to the other person?
                </Text>
                <Input
                  label="Other person's share of this refund"
                  value={otherPersonRefundShare}
                  onChangeText={setOtherPersonRefundShare}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                />
                <Text className="text-[11px] text-text-tertiary dark:text-text-dark-secondary mt-1">
                  Leave at 0 if the other person doesn't get any of this refund.
                </Text>
              </View>
            )}

            {/* Description */}
            <Input
              label="Description"
              value={description}
              onChangeText={setDescription}
              placeholder="What did you spend on?"
              maxLength={200}
              containerClassName="mb-4"
            />

            {/* Merchant */}
            <MerchantPicker
              value={merchantName}
              onChangeText={setMerchantName}
              merchantNames={merchantNames}
              showSuggestions={showMerchants}
              onToggleSuggestions={() => {
                setShowMerchants(!showMerchants);
                setShowCategories(false);
                setShowPaymentModes(false);
                setShowAccounts(false);
              }}
              onCloseSuggestions={() => setShowMerchants(false)}
            />

            {/* Account picker (V4) */}
            <AccountPicker
              accounts={accounts}
              accountId={accountId}
              selectedAccount={selectedAccount}
              showAccounts={showAccounts}
              onToggle={() => {
                setShowAccounts(!showAccounts);
                setShowCategories(false);
                setShowPaymentModes(false);
              }}
              onSelect={handleAccountSelect}
            />

            {/* Split-tender: extra payment legs + "Add another payment source" */}
            {!isRefund && !splitConfig && (
              <View className="mb-4">
                {extraLegs.map((leg, idx) => {
                  const legAccount = accounts.find((a) => a.id === leg.accountId);
                  const legPM = paymentModes.find((p) => p.id === leg.paymentModeId);
                  const legAmt = parseAmount(leg.amount);
                  const legValid = legAmt != null && legAmt > 0;
                  return (
                    <View
                      key={leg.key}
                      className="rounded-xl border border-border-light dark:border-border-dark p-3 mb-2"
                      style={{ backgroundColor: ac(accent, colorScheme, 50, 900) }}
                    >
                      <View className="flex-row items-center justify-between mb-2">
                        <View className="flex-row items-center">
                          <Ionicons name="card-outline" size={16} color={accent[500]} />
                          <Text
                            className="ml-2 text-xs font-semibold uppercase tracking-wider"
                            style={{ color: ac(accent, colorScheme, 600, 300) }}
                          >
                            Extra payment {idx + 1}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() =>
                            setExtraLegs((prev) => prev.filter((l) => l.key !== leg.key))
                          }
                          hitSlop={8}
                          accessibilityLabel="Remove this payment source"
                          accessibilityRole="button"
                        >
                          <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                        </Pressable>
                      </View>

                      <Input
                        label="Amount"
                        value={leg.amount}
                        onChangeText={(text) =>
                          setExtraLegs((prev) =>
                            prev.map((l) => (l.key === leg.key ? { ...l, amount: text } : l)),
                          )
                        }
                        placeholder="0.00"
                        keyboardType="decimal-pad"
                        error={!legValid && leg.amount.length > 0 ? "Enter a positive amount" : undefined}
                        containerClassName="mb-3"
                      />

                      <AccountPicker
                        accounts={accounts}
                        accountId={leg.accountId}
                        selectedAccount={legAccount}
                        showAccounts={leg.showAccounts}
                        onToggle={() =>
                          setExtraLegs((prev) =>
                            prev.map((l) =>
                              l.key === leg.key
                                ? {
                                    ...l,
                                    showAccounts: !l.showAccounts,
                                    showPaymentModes: false,
                                  }
                                : { ...l, showAccounts: false, showPaymentModes: false },
                            ),
                          )
                        }
                        onSelect={(acctId) =>
                          setExtraLegs((prev) =>
                            prev.map((l) =>
                              l.key === leg.key
                                ? { ...l, accountId: acctId, showAccounts: false }
                                : l,
                            ),
                          )
                        }
                      />

                      <PaymentModePicker
                        paymentModes={paymentModes}
                        paymentModeId={leg.paymentModeId}
                        selectedPaymentMode={legPM}
                        showPaymentModes={leg.showPaymentModes}
                        onToggle={() =>
                          setExtraLegs((prev) =>
                            prev.map((l) =>
                              l.key === leg.key
                                ? {
                                    ...l,
                                    showPaymentModes: !l.showPaymentModes,
                                    showAccounts: false,
                                  }
                                : { ...l, showAccounts: false, showPaymentModes: false },
                            ),
                          )
                        }
                        onSelect={(pmId) =>
                          setExtraLegs((prev) =>
                            prev.map((l) =>
                              l.key === leg.key
                                ? { ...l, paymentModeId: pmId, showPaymentModes: false }
                                : l,
                            ),
                          )
                        }
                      />
                    </View>
                  );
                })}

                {extraLegs.length > 0 && (
                  <View className="p-3 rounded-xl bg-surface-light-alt dark:bg-surface-dark-alt mb-2 flex-row items-center">
                    <Ionicons name="calculator-outline" size={16} color={colors.textSecondary} />
                    <Text className="ml-2 text-xs text-text-secondary dark:text-text-dark-secondary flex-1">
                      Purchase total
                    </Text>
                    <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary">
                      {"₹"}
                      {(
                        (parseAmount(amount) ?? 0) +
                        extraLegs.reduce((s, l) => s + (parseAmount(l.amount) ?? 0), 0)
                      ).toLocaleString("en-IN")}
                    </Text>
                  </View>
                )}

                {extraLegs.length < MAX_EXTRA_LEGS && (
                  <Pressable
                    onPress={() =>
                      setExtraLegs((prev) => [
                        ...prev,
                        {
                          key: `leg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                          amount: "",
                          accountId: null,
                          paymentModeId: null,
                          showAccounts: false,
                          showPaymentModes: false,
                        },
                      ])
                    }
                    className="flex-row items-center justify-center py-3 rounded-xl border border-dashed border-border-light dark:border-border-dark"
                    accessibilityRole="button"
                    accessibilityLabel="Add another payment source"
                  >
                    <Ionicons
                      name="add-circle-outline"
                      size={18}
                      color={ac(accent, colorScheme, 500, 300)}
                    />
                    <Text
                      className="ml-2 text-sm font-medium"
                      style={{ color: ac(accent, colorScheme, 500, 300) }}
                    >
                      Add another payment source
                    </Text>
                  </Pressable>
                )}
                {extraLegs.length > 0 && (
                  <Text className="text-[11px] text-text-tertiary dark:text-text-dark-secondary mt-2">
                    Legs share the same merchant, date, and category. Up to {MAX_PURCHASE_GROUP_LEGS} payment sources per purchase.
                  </Text>
                )}
              </View>
            )}

            {/* Date selector */}
            <DateSelector
              date={date}
              showDatePicker={showDatePicker}
              onToggleDatePicker={() => setShowDatePicker(!showDatePicker)}
              onDateShift={handleDateShift}
              onSetDate={setDate}
              onCloseDatePicker={() => setShowDatePicker(false)}
              dateError={errors.date}
            />

            {/* Category picker */}
            <CategoryPicker
              categories={categories}
              categoryId={categoryId}
              selectedCategory={selectedCategory}
              showCategories={showCategories}
              onToggle={() => {
                setShowCategories(!showCategories);
                setShowPaymentModes(false);
              }}
              onSelect={(catId) => {
                setCategoryId(catId);
                setShowCategories(false);
                // Auto-set unavoidable/discretionary based on category classification
                const cat = categories.find((c) => c.id === catId);
                if (cat) setIsRightSpend(cat.is_unavoidable === 1);
              }}
            />

            {/* Payment mode picker */}
            <PaymentModePicker
              paymentModes={paymentModes}
              paymentModeId={paymentModeId}
              selectedPaymentMode={selectedPaymentMode}
              showPaymentModes={showPaymentModes}
              onToggle={() => {
                setShowPaymentModes(!showPaymentModes);
                setShowCategories(false);
              }}
              onSelect={(pmId) => {
                setPaymentModeId(pmId);
                setShowPaymentModes(false);
              }}
            />

            {/* Spend classification toggle */}
            <RightSpendToggle
              isRightSpend={isRightSpend}
              onToggle={() => setIsRightSpend(!isRightSpend)}
            />

            {/* Tags */}
            <View className="mb-4">
              <Text className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary mb-2">
                Tags (optional)
              </Text>
              <TagPicker
                selectedTagIds={selectedTagIds}
                onSelectionChange={setSelectedTagIds}
                onOpen={() => {
                  setTagPickerOpen(true);
                  const sub = Keyboard.addListener("keyboardDidShow", () => {
                    scrollRef.current?.scrollToEnd({ animated: true });
                    sub.remove();
                  });
                  setTimeout(() => {
                    scrollRef.current?.scrollToEnd({ animated: true });
                  }, 400);
                }}
                onClose={() => setTagPickerOpen(false)}
              />
            </View>

            {/* Save button */}
            <Button
              title={
                isRefund
                  ? "Save Refund"
                  : extraLegs.length > 0
                    ? "Save Purchase"
                    : "Save Expense"
              }
              onPress={handleSave}
              loading={saving}
              className="mb-4"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
