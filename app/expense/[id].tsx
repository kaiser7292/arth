import { AccountPickerSheet } from "@/components/expense/AccountPickerSheet";
import { AmountInput } from "@/components/expense/AmountInput";
import { DematTransferTargetSheet } from "@/components/expense/DematTransferTargetSheet";
import {
    AccountPicker,
    CategoryPicker,
    DateSelector,
    MerchantPicker,
    PaymentModePicker,
    RightSpendToggle,
} from "@/components/expense/ExpenseFormFields";
import ExpenseHeroCard from "@/components/expense/ExpenseHeroCard";
import ExpenseMetadata from "@/components/expense/ExpenseMetadata";
import { ForecastActionBar } from "@/components/expense/ForecastActionBar";
import { HisaabSettlementPickerSheet } from "@/components/expense/HisaabSettlementPickerSheet";
import { InvestmentBucketPickerSheet } from "@/components/expense/InvestmentBucketPickerSheet";
import { LoanPaymentPickerSheet } from "@/components/expense/LoanPaymentPickerSheet";
import { MultiSplitSheet } from "@/components/expense/MultiSplitSheet";
import { RecurringRuleSheet } from "@/components/expense/RecurringRuleSheet";
import { RefundTargetSheet } from "@/components/expense/RefundTargetSheet";
import { RefundExpensePickerSheet } from "@/components/expense/RefundExpensePickerSheet";
import { SplitSheet } from "@/components/expense/SplitSheet";
import { TagPicker } from "@/components/expense/TagPicker";
import { Button, Input, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { TYPE_ICONS } from "@/constants/icons";
import { STATUS_COLORS } from "@/constants/semantic-colors";

import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getLinkedModesForAccount } from "@/services/account-master";
import { reclassifyCreditAsTransfer, reclassifyExpenseAsTransfer, undoTransfer, getTransferByLinkedExpenseId, type AccountTransfer } from "@/services/account-transfer";
import type { Category } from "@/services/category";
import { getCategories } from "@/services/category";
import type { DematTarget } from "@/services/demat-transfer";
import { handleDematTransferSideEffects, handleDematWithdrawalSideEffects } from "@/services/demat-transfer";
import type { Expense, RecurringFrequency, RecurringRule, SplitConfig } from "@/services/expense";
import {
    addLegToExistingGroup,
    approveExpense,
    convertToSplitTender,
    createRecurringRule,
    deleteExpense,
    deleteSplitExpense,
    fulfillReminder,
    getActiveRecurringRules,
    getExpenseById,
    getGroupSiblings,
    getRecurringRuleForExpense,
    markForecastAsPaid,
    markForecastPaidExternally,
    markRepaymentAsPaid,
    MAX_PURCHASE_GROUP_LEGS,
    propagateSharedEdit,
    realizeForecast,
    rejectExpense,
    removeSplit,
    splitExistingExpense,
    stopRecurringRule,
    suggestReminderForExpense,
    unfulfillReminder,
    unlinkFromGroup,
    updateExpense
} from "@/services/expense";
import {
    getLinkForExpense,
    InvestmentLinkError,
    linkExpenseToBucket,
    unlinkExpenseFromBucket,
    type ExpenseInvestmentLink,
} from "@/services/expense-investment-link";
import {
    getLoanLinkForExpense,
    linkExpenseAsEMI,
    linkExpenseAsPrepayment,
    LoanLinkError,
    unlinkExpenseFromLoan,
    type ExpenseLoanLink,
} from "@/services/expense-loan-link";
import type { MultiSplitConfig, MultiSplitSummary } from "@/services/expense-multi-split";
import {
    applyMultiSplit,
    getMultiSplitSummary,
    removeMultiSplit,
} from "@/services/expense-multi-split";
import { V15_FLAGS } from "@/services/feature-flags";
import type { FinancialAccount } from "@/services/financial-account";
import { getActiveAccounts } from "@/services/financial-account";
import {
    getPerson,
    getSettlementForCredit,
    linkCreditAsSettlement,
    unlinkCreditSettlement,
} from "@/services/hisaab";
import { getLoanById, type LoanAccount } from "@/services/loan-accounts";
import { getDistinctMerchantNames } from "@/services/merchant-alias";
import type { PaymentMode, PaymentModeType } from "@/services/payment-mode";
import { getPaymentModes } from "@/services/payment-mode";
import {
    extractMerchantFromDescription,
    recordCategoryCorrection,
} from "@/services/smart-categorizer";
import { getInvestmentBucketById } from "@/services/yearly-plan";

import { getMonthDateRange } from "@/utils/budget-helpers";
import { formatError } from "@/utils/error-message";
import type { ExpenseValidationErrors } from "@/utils/expense-validation";
import {
    formatDateForStorage,
    parseAmount,
    validateExpense,
} from "@/utils/expense-validation";
import { formatAmount } from "@/utils/format";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Modal, Pressable, ScrollView, View } from "react-native";
import { listRules, applyRuleActionsToExpense } from "@/services/smart-rules";
import type { SmartRule } from "@/services/smart-rules";
import { useTheme } from "@/hooks/use-theme";



export default function ExpenseDetailScreen() {
  const alert = useAlert();
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const scrollRef = useRef<ScrollView>(null);

  // Expense data
  const [expense, setExpense] = useState<Expense | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [transfer, setTransfer] = useState<AccountTransfer | null>(null);

  // Apply rule sheet
  const [rulePickerVisible, setRulePickerVisible] = useState(false);
  const [availableRules, setAvailableRules] = useState<SmartRule[]>([]);
  const [applyingRuleId, setApplyingRuleId] = useState<string | null>(null);

  // Edit mode
  const [editing, setEditing] = useState(false);

  // Form state (only used when editing)
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [paymentModeId, setPaymentModeId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [isRightSpend, setIsRightSpend] = useState(true);
  const [errors, setErrors] = useState<ExpenseValidationErrors>({});
  const [saving, setSaving] = useState(false);

  // Original expense (for detecting category corrections on SMS-sourced expenses)
  const [originalExpense, setOriginalExpense] = useState<Expense | null>(null);

  // Split-tender siblings (other legs of the same purchase group, if any)
  const [siblings, setSiblings] = useState<Expense[]>([]);

  // Extra legs to add on save (edit-screen split-tender flow). Works for both:
  //   - Standalone expenses (purchase_group_id == null): converts to split-tender
  //   - Already-grouped expenses: appends legs to the existing group (up to cap)
  // Each extra leg is a staged "about to be created" row until the user saves.
  interface ExtraLeg {
    key: string;
    amount: string;
    accountId: string | null;
    paymentModeId: string | null;
    showAccounts: boolean;
    showPaymentModes: boolean;
  }
  const [extraLegs, setExtraLegs] = useState<ExtraLeg[]>([]);

  // Account state (V4)
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [showAccounts, setShowAccounts] = useState(false);

  // Picker data
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  const [merchantNames, setMerchantNames] = useState<string[]>([]);
  const [showCategories, setShowCategories] = useState(false);
  const [showPaymentModes, setShowPaymentModes] = useState(false);
  const [showMerchants, setShowMerchants] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showSplitSheet, setShowSplitSheet] = useState(false);
  const [splitPersonName, setSplitPersonName] = useState<string | null>(null);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);


  // Multi-split state
  const [multiSplitSummary, setMultiSplitSummary] = useState<MultiSplitSummary | null>(null);
  const [showMultiSplitSheet, setShowMultiSplitSheet] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const [exp, cats, pms, accts, merchants] = await Promise.all([
          getExpenseById(id),
          getCategories(DEFAULT_USER_ID),
          getPaymentModes(DEFAULT_USER_ID),
          getActiveAccounts(DEFAULT_USER_ID),
          getDistinctMerchantNames(DEFAULT_USER_ID),
        ]);
        setCategories(cats);
        setPaymentModes(pms);
        setAccounts(accts);
        setMerchantNames(merchants);

        if (exp) {
          setExpense(exp);
          setOriginalExpense(exp);
          populateForm(exp);
          
          // Load transfer data if expense is reclassified
          if (exp.linked_transfer_id) {
            try {
              const transferData = await getTransferByLinkedExpenseId(exp.id);
              setTransfer(transferData);
            } catch {
              setTransfer(null);
            }
          }
          
          // Load active recurring rule (if any) for this expense. Shown as a
          // badge + swaps "Make Recurring" → "Stop Recurring" action.
          try {
            const rule = await getRecurringRuleForExpense(exp.id);
            setRecurringRule(rule);
          } catch {
            setRecurringRule(null);
          }

          // If this expense already fulfills a reminder, load the rule for
          // the "Fulfilled Reminder" badge. Otherwise check for a pending
          // reminder that matches (merchant + date window) — those become
          // the "Link to Rent reminder?" suggestion.
          if (exp.fulfills_rule_id) {
            try {
              const rules = await getActiveRecurringRules(DEFAULT_USER_ID);
              const match = rules.find((r) => r.id === exp.fulfills_rule_id);
              setFulfilledRule(match ?? null);
              setSuggestedReminder(null);
            } catch {
              setFulfilledRule(null);
            }
          } else if (exp.nature === "realized") {
            try {
              const suggestion = await suggestReminderForExpense(exp);
              setSuggestedReminder(suggestion);
            } catch {
              setSuggestedReminder(null);
            }
            setFulfilledRule(null);
          } else {
            setSuggestedReminder(null);
            setFulfilledRule(null);
          }
          if (exp.split_person_id) {
            const person = await getPerson(exp.split_person_id);
            setSplitPersonName(person?.name ?? null);
          }
          const msSummary = await getMultiSplitSummary(exp.id);
          setMultiSplitSummary(msSummary);
          if (exp.purchase_group_id) {
            const sibs = await getGroupSiblings(exp.id);
            setSiblings(sibs);
          }
          setLoaded(true);
        } else {
          alert("Error", "Expense not found.");
          router.back();
        }
      } catch (e) {
        logger.error("Load expense failed:", e);
        alert("Error", formatError("Load expense", e));
        router.back();
      }
    }
    loadData();
  }, [id, router]);

  // Refresh accounts + refund data when returning from any sub-screen
  useFocusEffect(
    useCallback(() => {
      getActiveAccounts(DEFAULT_USER_ID).then(setAccounts).catch((e) => logger.warn("Load accounts failed:", e));
      // Re-check refund total + list whenever screen gains focus (e.g. after deleting a refund)
      if (!expense?.id || expense.nature !== "realized") return;
      (async () => {
        try {
          const { getRefundedAmount, getRefundsForExpense } = await import("@/services/expense");
          const [amount, list] = await Promise.all([
            getRefundedAmount(expense.id),
            getRefundsForExpense(expense.id),
          ]);
          setRefundedAmount(amount);
          setRefunds(list);
        } catch {
          // non-fatal — stale values are better than a crash
        }
      })();
    }, [expense?.id, expense?.nature]),
  );

  function populateForm(exp: Expense) {
    // For split expenses, show the original total amount (not the post-split budget amount)
    const displayAmount = exp.split_original_amount ?? exp.amount;
    setAmount(String(displayAmount));
    setDescription(exp.description ?? "");
    setMerchantName(exp.merchant_name ?? "");
    setCategoryId(exp.category_id);
    setPaymentModeId(exp.payment_mode_id);
    setAccountId(exp.account_id);
    setDate(exp.date);
    setIsRightSpend(exp.is_right_spend !== 0);
  }

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
        setShowPaymentModes(true);
      }
    },
    [],
  );

  // Category and payment mode looked up from the expense (for read-only view)
  const expenseCategory = expense
    ? categories.find((c) => c.id === expense.category_id)
    : null;
  const expensePaymentMode = expense
    ? paymentModes.find((p) => p.id === expense.payment_mode_id)
    : null;
  const expenseAccount = expense
    ? accounts.find((a) => a.id === expense.account_id)
    : null;

  const handleEdit = useCallback(() => {
    if (expense) populateForm(expense);
    setEditing(true);
  }, [expense]);

  const handleCancelEdit = useCallback(() => {
    setEditing(false);
    setErrors({});
    setShowCategories(false);
    setShowPaymentModes(false);
    setShowMerchants(false);
    setShowDatePicker(false);
    setExtraLegs([]);
  }, []);

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

    setErrors({});
    setSaving(true);

    try {
      const parsedAmount = parseAmount(amount)!;
      const isSingleSplit = expense?.split_person_id != null && expense?.split_pct != null;
      const isMultiSplit = multiSplitSummary != null && multiSplitSummary.splits.length > 0;

      if (isSingleSplit) {
        // v15.13.1: reconstruct the split intent precisely.
        //   - splitMode comes from the persisted column (migration 024). Legacy
        //     rows without it fall back to "percentage" — the pre-v15.13.1
        //     behaviour (imperfect but not a regression for existing data).
        //   - paidBy is reconstructed from the linked hisaab entry's type
        //     (debit = me paid, credit = they paid). Hardcoding "me" was
        //     flipping hisaab direction on every edit of "they paid" splits.
        //   - exactAmount comes from the persisted column for exact-mode
        //     splits; preserves the rupee amount across total edits.
        const storedMode = expense!.split_mode ?? "percentage";
        let paidBy: "me" | "them" = "me";
        if (expense!.split_hisaab_entry_id) {
          const { getEntryById } = await import("@/services/hisaab");
          const hisaabEntry = await getEntryById(expense!.split_hisaab_entry_id);
          if (hisaabEntry?.type === "credit") paidBy = "them";
        }

        // Skip the expensive rebuild when NO split-affecting field changed.
        // Amount, person, and split intent drive the hisaab entry; the other
        // fields (merchant, category, date, account, payment mode, description,
        // is_right_spend) only touch the expense row itself.
        const originalTotalAmount = expense!.split_original_amount ?? expense!.amount;
        const splitAffectingFieldsChanged = parsedAmount !== originalTotalAmount;

        if (!splitAffectingFieldsChanged) {
          // Lightweight path — update only the fields the user actually
          // changed. The stored amount = myBudgetAmount stays correct because
          // the total didn't change; we must NOT overwrite it with the
          // displayed total.
          await updateExpense(id, {
            description: description.trim() || null,
            merchant_name: merchantName.trim() || null,
            category_id: categoryId,
            payment_mode_id: paymentModeId,
            account_id: accountId,
            date,
            is_right_spend: isRightSpend ? 1 : 0,
          });
        } else {
          // Full rebuild required because the total changed.
          const splitConfig: SplitConfig =
            storedMode === "exact" && expense!.split_exact_amount != null
              ? {
                  paidBy,
                  splitMode: "exact",
                  personId: expense!.split_person_id!,
                  exactAmount: expense!.split_exact_amount,
                }
              : storedMode === "equal"
                ? { paidBy, splitMode: "equal", personId: expense!.split_person_id! }
                : storedMode === "they_owe_full"
                  ? { paidBy, splitMode: "they_owe_full", personId: expense!.split_person_id! }
                  : storedMode === "i_owe_full"
                    ? { paidBy, splitMode: "i_owe_full", personId: expense!.split_person_id! }
                    : {
                        // percentage (explicit or legacy fallback): derive the
                        // other person's percentage from split_pct.
                        paidBy,
                        splitMode: "percentage",
                        personId: expense!.split_person_id!,
                        percentage: 100 - expense!.split_pct!,
                      };
          await removeSplit(id);
          await updateExpense(id, {
            amount: parsedAmount,
            description: description.trim() || null,
            merchant_name: merchantName.trim() || null,
            category_id: categoryId,
            payment_mode_id: paymentModeId,
            account_id: accountId,
            date,
            is_right_spend: isRightSpend ? 1 : 0,
          });
          await splitExistingExpense(id, splitConfig);
        }
      } else if (isMultiSplit) {
        // v15.13.1: only rebuild the hisaab entries when the TOTAL amount
        // changed. The per-split rupee amounts are already stored in
        // `expense_splits`; on a no-total change, the hisaab amounts stay
        // valid and rebuilding just churns UUIDs without changing anything.
        const originalTotalAmount = multiSplitSummary.originalAmount;
        const totalChanged = parsedAmount !== originalTotalAmount;

        if (!totalChanged) {
          await updateExpense(id, {
            description: description.trim() || null,
            merchant_name: merchantName.trim() || null,
            category_id: categoryId,
            payment_mode_id: paymentModeId,
            account_id: accountId,
            date,
            is_right_spend: isRightSpend ? 1 : 0,
          });
        } else {
          const currentSplits = multiSplitSummary.splits.map((s) => ({
            personId: s.hisaab_person_id,
            description: s.description ?? "",
            amount: s.amount,
          }));
          await removeMultiSplit(id);
          await updateExpense(id, {
            amount: parsedAmount,
            description: description.trim() || null,
            merchant_name: merchantName.trim() || null,
            category_id: categoryId,
            payment_mode_id: paymentModeId,
            account_id: accountId,
            date,
            is_right_spend: isRightSpend ? 1 : 0,
          });
          await applyMultiSplit(id, {
            splits: currentSplits,
            feeAbsorbed: multiSplitSummary.feeAbsorbed,
          });
          const msSummary = await getMultiSplitSummary(id);
          setMultiSplitSummary(msSummary);
        }
      } else {
        await updateExpense(id, {
          amount: parsedAmount,
          description: description.trim() || null,
          merchant_name: merchantName.trim() || null,
          category_id: categoryId,
          payment_mode_id: paymentModeId,
          account_id: accountId,
          date,
          is_right_spend: isRightSpend ? 1 : 0,
        });
      }

      // Record category correction for SMS-sourced expenses (smart categorization learning)
      if (
        originalExpense &&
        originalExpense.source === "sms_auto" &&
        categoryId &&
        categoryId !== originalExpense.category_id &&
        originalExpense.description
      ) {
        const merchant = extractMerchantFromDescription(originalExpense.description);
        if (merchant && merchant !== "Bank transaction") {
          await recordCategoryCorrection(DEFAULT_USER_ID, merchant, categoryId);
        }
      }

      // Propagate shared fields (merchant, date, category, description,
      // is_right_spend) to split-tender siblings. Per-leg fields — amount,
      // account, payment mode — stay local to the leg being edited.
      if (expense?.purchase_group_id) {
        await propagateSharedEdit(id, {
          merchant_name: merchantName.trim() || null,
          date,
          category_id: categoryId,
          description: description.trim() || null,
          is_right_spend: isRightSpend ? 1 : 0,
        });
      }

      // Create any newly-staged extra legs. Two paths:
      //   - Expense is already a leg → append each new leg to the existing group
      //   - Expense is standalone → convert to split-tender with the new legs
      if (extraLegs.length > 0) {
        const legInputs = extraLegs.map((l) => ({
          amount: parseAmount(l.amount)!,
          account_id: l.accountId,
          payment_mode_id: l.paymentModeId,
        }));
        const bad = legInputs.find((l) => !(l.amount > 0));
        if (bad) {
          throw new Error("Every extra payment leg needs a positive amount.");
        }
        if (expense?.purchase_group_id) {
          for (const leg of legInputs) {
            await addLegToExistingGroup(id, leg);
          }
        } else {
          await convertToSplitTender(id, legInputs);
        }
      }

      // Reload expense data to reflect changes
      const updated = await getExpenseById(id);
      if (updated) {
        setExpense(updated);
        setOriginalExpense(updated);
        if (updated.purchase_group_id) {
          const sibs = await getGroupSiblings(updated.id);
          setSiblings(sibs);
        }
      }
      setExtraLegs([]);
      setEditing(false);
    } catch (e) {
      logger.error("Update expense failed:", e);
      alert("Error", formatError("Save expense", e));
    } finally {
      setSaving(false);
    }
  }, [amount, description, merchantName, categoryId, paymentModeId, accountId, date, isRightSpend, id, expense, originalExpense, multiSplitSummary, extraLegs]);

  const openRulePicker = useCallback(async () => {
    try {
      const rules = await listRules();
      setAvailableRules(rules.filter((r) => r.is_active === 1));
      setRulePickerVisible(true);
    } catch (e) {
      alert("Error", formatError("Load rules", e));
    }
  }, [alert]);

  const handleApplyRule = useCallback(async (rule: SmartRule) => {
    if (!expense) return;
    const hasSplit = rule.actions.some((a) => a.type === "split_with_person");
    const doApply = async () => {
      setApplyingRuleId(rule.id);
      try {
        await applyRuleActionsToExpense(rule.id, expense.id);
        setRulePickerVisible(false);
        const updated = await getExpenseById(expense.id);
        if (updated) setExpense(updated);
      } catch (e) {
        alert("Couldn't apply rule", formatError("Apply rule", e));
      } finally {
        setApplyingRuleId(null);
      }
    };
    if (hasSplit) {
      alert(
        "Apply split?",
        `"${rule.name}" will split this expense. This creates a hisaab entry. Continue?`,
        [{ text: "Cancel", style: "cancel" }, { text: "Apply", onPress: doApply }],
      );
    } else {
      await doApply();
    }
  }, [expense, alert]);

  const handleDelete = useCallback(() => {
    const isSplit = expense?.split_hisaab_entry_id != null;
    alert(
      "Delete Expense",
      isSplit
        ? "This is a split expense. Deleting it will also remove the linked hisaab entry. Continue?"
        : "This expense will be moved to the Recycle Bin. You can restore it from Settings.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              if (isSplit) {
                await deleteSplitExpense(id);
              } else {
                await deleteExpense(id);
              }
              router.back();
            } catch (e) {
              logger.error("Delete expense failed:", e);
              alert("Error", formatError("Delete expense", e));
            }
          },
        },
      ],
    );
  }, [id, expense, router]);

  const handleRemoveSplit = useCallback(() => {
    alert(
      "Remove Split",
      "This will restore the expense to the original amount and delete the linked hisaab entry. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove Split",
          style: "destructive",
          onPress: async () => {
            await removeSplit(id);
            const updated = await getExpenseById(id);
            if (updated) {
              setExpense(updated);
              setOriginalExpense(updated);
            }
          },
        },
      ],
    );
  }, [id]);

  const handleSplitConfirm = useCallback(
    async (config: SplitConfig) => {
      try {
        await splitExistingExpense(id, config);
        const updated = await getExpenseById(id);
        if (updated) {
          setExpense(updated);
          setOriginalExpense(updated);
          if (updated.split_person_id) {
            const person = await getPerson(updated.split_person_id);
            setSplitPersonName(person?.name ?? null);
          }
        }
      } catch (e) {
        logger.error("Apply split failed:", e);
        alert("Error", formatError("Apply split", e));
      }
    },
    [id],
  );

  // Multi-split handlers
  const handleMultiSplitConfirm = useCallback(
    async (config: MultiSplitConfig) => {
      try {
        await applyMultiSplit(id, config);
        const updated = await getExpenseById(id);
        if (updated) {
          setExpense(updated);
          setOriginalExpense(updated);
        }
        const msSummary = await getMultiSplitSummary(id);
        setMultiSplitSummary(msSummary);
        setSplitPersonName(null);
      } catch (e) {
        logger.error("Apply multi-split failed:", e);
        alert("Error", formatError("Apply split", e));
      }
    },
    [id],
  );

  const handleRemoveMultiSplit = useCallback(() => {
    alert(
      "Remove Split",
      "This will restore the expense to the original amount and delete all linked hisaab entries. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await removeMultiSplit(id);
            const updated = await getExpenseById(id);
            if (updated) {
              setExpense(updated);
              setOriginalExpense(updated);
            }
            setMultiSplitSummary(null);
          },
        },
      ],
    );
  }, [id]);

  // Forecast lifecycle actions
  const [repaymentPickerVisible, setRepaymentPickerVisible] = useState(false);
  const [transferPickerVisible, setTransferPickerVisible] = useState(false);
  // Credit → transfer reclassification (incoming money that was actually a self-transfer or CC bill payment).
  const [creditTransferPickerVisible, setCreditTransferPickerVisible] = useState(false);

  // Pending demat-transfer follow-up: after Mark-as-Transfer lands in a demat
  // account, we stage this and open the DematTransferTargetSheet. If the user
  // skips it, no side-effects apply (transfer still exists as a plain ledger
  // row). Cleared on confirm or close.
  const [pendingDematTransfer, setPendingDematTransfer] = useState<
    | {
        transferId: string;
        dematAccountId: string;
        dematAccountLabel: string;
        amount: number;
        date: string;
      }
    | null
  >(null);

  // Recurring rule state — loaded alongside the expense, refreshed after
  // create/stop so the action row reflects the latest state.
  const [recurringRule, setRecurringRule] = useState<RecurringRule | null>(null);
  const [recurringSheetVisible, setRecurringSheetVisible] = useState(false);
  // Suggested reminder — for realized expenses NOT yet linked, matching a
  // pending rule by merchant + date. Rendered as a small banner at the top
  // of the expense detail with "Link" / "Dismiss" actions.
  const [suggestedReminder, setSuggestedReminder] = useState<RecurringRule | null>(null);
  // If this expense is already linked to a reminder (fulfills_rule_id set),
  // render a "Fulfilled Reminder" badge + Undo action.
  const [fulfilledRule, setFulfilledRule] = useState<RecurringRule | null>(null);

  // v15.12.0: hisaab-settlement state — for credits that the user wants to
  // mark as "settlement from [person]". Loaded on mount; the picker sheet is
  // shown when the user taps the "Mark as Settlement" action row.
  const [hisaabSettlementSheetVisible, setHisaabSettlementSheetVisible] = useState(false);
  const [linkedSettlement, setLinkedSettlement] = useState<{
    entryId: string;
    personId: string;
    personName: string;
    amount: number;
    date: string;
  } | null>(null);

  // Refund target sheet — asks whether the refund credited back to the same
  // account or a different one, then routes to add-expense with the chosen
  // account locked.
  const [refundTargetSheetVisible, setRefundTargetSheetVisible] = useState(false);

  // Refunded amount + list of refund credits linked back to this expense.
  const [refundedAmount, setRefundedAmount] = useState<number>(0);
  const [refunds, setRefunds] = useState<{ id: string; amount: number; date: string; description: string | null }[]>([]);
  useEffect(() => {
    if (!expense?.id || expense.nature !== "realized") {
      setRefundedAmount(0);
      setRefunds([]);
      return;
    }
    (async () => {
      try {
        const { getRefundedAmount, getRefundsForExpense } = await import("@/services/expense");
        const [amount, list] = await Promise.all([
          getRefundedAmount(expense.id),
          getRefundsForExpense(expense.id),
        ]);
        setRefundedAmount(amount);
        setRefunds(list);
      } catch {
        setRefundedAmount(0);
        setRefunds([]);
      }
    })();
  }, [expense?.id, expense?.nature, expense?.updated_at]);

  // "Tag as Refund" — for credits that already exist and should be linked to an expense.
  const [refundExpensePickerVisible, setRefundExpensePickerVisible] = useState(false);
  // Expense name shown in the badge when this credit is already linked as a refund.
  const [linkedExpenseSummary, setLinkedExpenseSummary] = useState<string | null>(null);
  useEffect(() => {
    if (!expense?.id || expense.nature !== "credit" || !expense.refund_of_expense_id) {
      setLinkedExpenseSummary(null);
      return;
    }
    (async () => {
      try {
        const { getExpenseById } = await import("@/services/expense");
        const linked = await getExpenseById(expense.refund_of_expense_id!);
        setLinkedExpenseSummary(linked?.merchant_name || linked?.description || linked?.date || null);
      } catch {
        setLinkedExpenseSummary(null);
      }
    })();
  }, [expense?.id, expense?.nature, expense?.refund_of_expense_id]);

  const handleLinkAsRefund = useCallback(
    async (expenseId: string, expenseSummary: string) => {
      setRefundExpensePickerVisible(false);
      if (!expense) return;
      try {
        const { linkCreditAsRefund } = await import("@/services/expense");
        await linkCreditAsRefund(expense.id, expenseId);
        setLinkedExpenseSummary(expenseSummary);
        // Reload the expense so expense.refund_of_expense_id is current
        const { getExpenseById } = await import("@/services/expense");
        const updated = await getExpenseById(expense.id);
        if (updated) setExpense(updated);
      } catch (e) {
        logger.error("Tag as refund failed:", e);
        alert("Couldn't link refund", formatError("Tag as refund", e));
      }
    },
    [expense, alert],
  );

  const handleUnlinkCreditAsRefund = useCallback(async () => {
    if (!expense) return;
    try {
      const { unlinkCreditAsRefund } = await import("@/services/expense");
      await unlinkCreditAsRefund(expense.id);
      setLinkedExpenseSummary(null);
      const { getExpenseById } = await import("@/services/expense");
      const updated = await getExpenseById(expense.id);
      if (updated) setExpense(updated);
    } catch (e) {
      logger.error("Unlink credit as refund failed:", e);
      alert("Error", formatError("Unlink refund", e));
    }
  }, [expense, alert]);

  // v15.12.0: load any existing hisaab-settlement link for this credit so we
  // can render the badge + Undo action instead of the "Mark as Settlement" row.
  useEffect(() => {
    if (!expense?.id || expense.nature !== "credit") {
      setLinkedSettlement(null);
      return;
    }
    (async () => {
      try {
        const s = await getSettlementForCredit(expense.id);
        setLinkedSettlement(s);
      } catch {
        setLinkedSettlement(null);
      }
    })();
  }, [expense?.id, expense?.nature, expense?.updated_at]);

  const handleHisaabSettlementPersonSelected = useCallback(
    async (personId: string) => {
      setHisaabSettlementSheetVisible(false);
      if (!expense) return;
      try {
        await linkCreditAsSettlement(expense.id, personId);
        const s = await getSettlementForCredit(expense.id);
        setLinkedSettlement(s);
        const updated = await getExpenseById(expense.id);
        if (updated) setExpense(updated);
      } catch (e) {
        logger.error("Link credit as settlement failed:", e);
        alert("Couldn't mark as settlement", formatError("Mark as settlement", e));
      }
    },
    [expense, alert],
  );

  // v17.0.0: expense-investment-bucket link state. A realized non-split,
  // non-credit, non-refund expense can be "promoted" to an investment
  // contribution that credits any active bucket.
  const [investmentSheetVisible, setInvestmentSheetVisible] = useState(false);
  const [investmentLink, setInvestmentLink] = useState<ExpenseInvestmentLink | null>(null);
  const [investmentBucketName, setInvestmentBucketName] = useState<string | null>(null);

  useEffect(() => {
    if (!expense?.id || !V15_FLAGS.v17_expense_investment_link) {
      setInvestmentLink(null);
      setInvestmentBucketName(null);
      return;
    }
    (async () => {
      try {
        const l = await getLinkForExpense(expense.id);
        setInvestmentLink(l);
        if (l) {
          const bucket = await getInvestmentBucketById(l.investment_bucket_id);
          setInvestmentBucketName(bucket?.name ?? null);
        } else {
          setInvestmentBucketName(null);
        }
      } catch {
        setInvestmentLink(null);
        setInvestmentBucketName(null);
      }
    })();
  }, [expense?.id, expense?.updated_at]);

  const handleInvestmentBucketSelected = useCallback(
    async (bucketId: string) => {
      setInvestmentSheetVisible(false);
      if (!expense) return;
      try {
        await linkExpenseToBucket(expense.id, bucketId);
        const l = await getLinkForExpense(expense.id);
        setInvestmentLink(l);
        if (l) {
          const bucket = await getInvestmentBucketById(l.investment_bucket_id);
          setInvestmentBucketName(bucket?.name ?? null);
        }
      } catch (e) {
        const msg =
          e instanceof InvestmentLinkError
            ? e.message
            : formatError("Mark as investment", e);
        alert("Couldn't mark as investment", msg);
      }
    },
    [expense, alert],
  );

  const handleUnlinkInvestment = useCallback(() => {
    if (!expense || !investmentLink) return;
    alert(
      "Unlink investment?",
      `This will keep the ${formatAmount(expense.amount)} expense but remove it from the ${investmentBucketName ?? "bucket"}. Your budget for that month will re-include it.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unlink",
          style: "destructive",
          onPress: async () => {
            try {
              await unlinkExpenseFromBucket(expense.id);
              setInvestmentLink(null);
              setInvestmentBucketName(null);
            } catch (e) {
              alert("Couldn't unlink", formatError("Unlink investment", e));
            }
          },
        },
      ],
    );
  }, [expense, investmentLink, investmentBucketName, alert]);

  // v17.4.0 — Loan payment linking state
  const [loanSheetVisible, setLoanSheetVisible] = useState(false);
  const [loanLink, setLoanLink] = useState<ExpenseLoanLink | null>(null);
  const [linkedLoan, setLinkedLoan] = useState<LoanAccount | null>(null);
  const [linkedLoanBankName, setLinkedLoanBankName] = useState<string | null>(null);

  useEffect(() => {
    if (!expense?.id || !V15_FLAGS.v17_loans_v1) {
      setLoanLink(null);
      setLinkedLoan(null);
      setLinkedLoanBankName(null);
      return;
    }
    (async () => {
      try {
        const l = await getLoanLinkForExpense(expense.id);
        setLoanLink(l);
        if (l) {
          const loan = await getLoanById(l.loan_account_id);
          setLinkedLoan(loan);
          if (loan) {
            const { getDatabase } = await import("@/database");
            const db = getDatabase();
            const fa = await db.getFirstAsync<{ bank_name: string }>(
              "SELECT bank_name FROM financial_accounts WHERE id = ?;",
              loan.financial_account_id,
            );
            setLinkedLoanBankName(fa?.bank_name ?? null);
          }
        } else {
          setLinkedLoan(null);
          setLinkedLoanBankName(null);
        }
      } catch {
        setLoanLink(null);
        setLinkedLoan(null);
        setLinkedLoanBankName(null);
      }
    })();
  }, [expense?.id, expense?.updated_at]);

  const handleLoanPaymentSubmit = useCallback(
    async (payload: {
      loan_account_id: string;
      kind: "emi" | "prepayment";
      schedule_entry_id?: string;
      strategy?: "reduce_tenure" | "reduce_emi";
      prepayment_kind?: "part_payment" | "foreclosure";
      prepayment_charge?: number;
      gst_on_charge?: number;
    }) => {
      setLoanSheetVisible(false);
      if (!expense) return;
      try {
        if (payload.kind === "emi" && payload.schedule_entry_id) {
          await linkExpenseAsEMI(expense.id, payload.loan_account_id, payload.schedule_entry_id);
        } else if (payload.kind === "prepayment" && payload.strategy) {
          // v17.5.11 — forward kind + charge + GST so the linked prepayment
          // row carries the same metadata as one created via the standalone
          // PrepaymentSheet. Previously these were silently defaulted.
          await linkExpenseAsPrepayment(expense.id, payload.loan_account_id, {
            strategy: payload.strategy,
            kind: payload.prepayment_kind,
            prepayment_charge: payload.prepayment_charge,
            gst_on_charge: payload.gst_on_charge,
          });
        }
        const l = await getLoanLinkForExpense(expense.id);
        setLoanLink(l);
        if (l) {
          const loan = await getLoanById(l.loan_account_id);
          setLinkedLoan(loan);
        }
      } catch (e) {
        const msg =
          e instanceof LoanLinkError
            ? e.message
            : formatError("Mark as loan payment", e);
        alert("Couldn't mark as loan payment", msg);
      }
    },
    [expense, alert],
  );

  const handleUnlinkLoan = useCallback(() => {
    if (!expense || !loanLink) return;
    const warning =
      loanLink.link_kind === "emi"
        ? `The linked EMI installment will revert to scheduled.`
        : `The prepayment will be removed from the loan and the schedule recalculated as if it never happened. The expense itself stays; you can re-link it if needed.`;
    alert("Unlink loan payment?", warning, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unlink",
        style: "destructive",
        onPress: async () => {
          try {
            await unlinkExpenseFromLoan(expense.id);
            setLoanLink(null);
            setLinkedLoan(null);
            setLinkedLoanBankName(null);
          } catch (e) {
            alert("Couldn't unlink", formatError("Unlink loan", e));
          }
        },
      },
    ]);
  }, [expense, loanLink, alert]);

  const handleUnlinkSettlement = useCallback(() => {
    if (!expense || !linkedSettlement) return;
    alert(
      "Unlink settlement?",
      `This will keep the ${formatAmount(linkedSettlement.amount)} credit but remove the hisaab link to ${linkedSettlement.personName}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unlink",
          style: "destructive",
          onPress: async () => {
            try {
              await unlinkCreditSettlement(expense.id);
              setLinkedSettlement(null);
            } catch (e) {
              alert("Couldn't unlink", formatError("Unlink settlement", e));
            }
          },
        },
      ],
    );
  }, [expense, linkedSettlement, alert]);

  // v15.2: If this expense was auto-categorized by a smart rule, fetch the
  // rule's display name for the "Processed by rule" badge.
  const [appliedRuleSummary, setAppliedRuleSummary] = useState<string | null>(null);
  useEffect(() => {
    if (!expense?.applied_rule_id) {
      setAppliedRuleSummary(null);
      return;
    }
    (async () => {
      try {
        const { getRule } = await import("@/services/smart-rules");
        const r = await getRule(expense.applied_rule_id!);
        setAppliedRuleSummary(r?.name ?? "Deleted rule");
      } catch {
        setAppliedRuleSummary(null);
      }
    })();
  }, [expense?.applied_rule_id]);

  const handleForecastMarkPaid = useCallback(async (forecastId: string) => {
    try {
      const result = await markForecastAsPaid(forecastId);
      alert(
        "Marked as Paid",
        result.linked
          ? "Forecast dismissed and linked to a matching transaction."
          : "Forecast dismissed. No matching transaction was found.",
      );
      router.back();
    } catch (e) {
      logger.error("Mark forecast as paid failed:", e);
      alert("Error", formatError("Mark as paid", e));
    }
  }, [router]);

  const handleForecastRepaymentPaid = useCallback((_id: string) => {
    setRepaymentPickerVisible(true);
  }, []);

  const handleRepaymentAccountSelected = useCallback(async (fromAccountId: string) => {
    setRepaymentPickerVisible(false);
    try {
      const { transferId } = await markRepaymentAsPaid(id, fromAccountId);
      // Cross-link to the new transfer on the CC account's ledger so the user
      // can see the payment land and reduce the CC dues directly.
      if (expenseAccount?.id && transferId) {
        router.replace({
          pathname: "/reconciliation/account-ledger",
          params: { accountId: expenseAccount.id, transferId },
        });
        return;
      }
      router.back();
    } catch (e) {
      logger.error("Mark repayment as paid failed:", e);
      alert("Error", formatError("Pay bill", e));
    }
  }, [id, router, expenseAccount]);

  const handleForecastPaidExternally = useCallback(async (forecastId: string) => {
    try {
      await markForecastPaidExternally(forecastId);
      alert("Paid Externally", "Forecast dismissed. No savings account was debited.");
      router.back();
    } catch (e) {
      logger.error("Mark forecast paid externally failed:", e);
      alert("Error", formatError("Paid externally", e));
    }
  }, [router]);

  const handleForecastRealise = useCallback(async (forecastId: string) => {
    try {
      const today = new Date().toISOString().split("T")[0];
      await realizeForecast(forecastId, today);
      alert("Realised", "Forecast converted to an actual expense. It now counts in your budget.");
      const updated = await getExpenseById(forecastId);
      if (updated) {
        setExpense(updated);
        setOriginalExpense(updated);
      }
    } catch (e) {
      logger.error("Realise forecast failed:", e);
      alert("Error", formatError("Realise forecast", e));
    }
  }, []);

  const handleForecastDelete = useCallback(async (forecastId: string) => {
    try {
      await rejectExpense(forecastId);
      router.back();
    } catch (e) {
      logger.error("Delete forecast failed:", e);
      alert("Error", formatError("Delete forecast", e));
    }
  }, [router]);

  // Mark as Transfer — reclassify a savings debit as inter-account transfer.
  // If the destination is a demat account, pause before navigating back so
  // the user can declare fund/portfolio + optional bucket.
  const handleTransferAccountSelected = useCallback(async (toAccountId: string) => {
    setTransferPickerVisible(false);
    try {
      const transferId = await reclassifyExpenseAsTransfer(id, toAccountId, expense?.updated_at);
      const toAcct = accounts.find((a) => a.id === toAccountId);
      if (toAcct?.account_type === "demat" && expense) {
        const label =
          toAcct.account_label ||
          `${toAcct.bank_name} ****${toAcct.account_identifier}`;
        setPendingDematTransfer({
          transferId,
          dematAccountId: toAcct.id,
          dematAccountLabel: label,
          amount: expense.amount,
          date: expense.date,
        });
        // Stay on this screen; router.back() will run after the sheet resolves.
        return;
      }
      alert("Reclassified", "This expense has been converted to an inter-account transfer.");
      router.back();
    } catch (e) {
      logger.error("Reclassify as transfer failed:", e);
      alert("Error", formatError("Mark as transfer", e));
    }
  }, [id, router, accounts, expense]);

  const handleConfirmDematTarget = useCallback(
    async (target: DematTarget, bucketId: string | null) => {
      if (!pendingDematTransfer) return;
      try {
        await handleDematTransferSideEffects(
          pendingDematTransfer.transferId,
          pendingDematTransfer.dematAccountId,
          pendingDematTransfer.amount,
          pendingDematTransfer.date,
          { target, bucketId },
        );
        setPendingDematTransfer(null);
        router.back();
      } catch (e) {
        logger.error("Apply demat transfer side-effects failed:", e);
        alert("Error", formatError("Apply demat transfer", e));
        setPendingDematTransfer(null);
      }
    },
    [pendingDematTransfer, router],
  );

  const handleSkipDematTarget = useCallback(() => {
    // User chose not to categorize — the transfer still exists as a plain
    // ledger row. Navigate away; the account's demat numbers just won't
    // reflect this transfer until they edit it later.
    setPendingDematTransfer(null);
    router.back();
  }, [router]);

  // Recurring — create a new rule from the sheet's result.
  const handleCreateRecurring = useCallback(
    async (input: {
      frequency: RecurringFrequency;
      startDate: string;
      endDate: string | null;
      notes: string | null;
    }) => {
      if (!expense) return;
      try {
        await createRecurringRule(DEFAULT_USER_ID, {
          source_expense_id: expense.id,
          frequency: input.frequency,
          start_date: input.startDate,
          end_date: input.endDate,
          notes: input.notes,
        });
        const rule = await getRecurringRuleForExpense(expense.id);
        setRecurringRule(rule);
        setRecurringSheetVisible(false);
      } catch (e) {
        alert("Couldn't save reminder", formatError("Save reminder", e));
      }
    },
    [expense, alert],
  );

  const handleStopRecurring = useCallback(() => {
    if (!recurringRule) return;
    alert(
      "Stop reminder?",
      "Future cycles won't be created. Already-materialized upcoming reminders stay - you can delete them individually if needed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Stop",
          style: "destructive",
          onPress: async () => {
            try {
              await stopRecurringRule(recurringRule.id);
              setRecurringRule(null);
            } catch (e) {
              alert("Couldn't stop reminder", formatError("Stop reminder", e));
            }
          },
        },
      ],
    );
  }, [recurringRule, alert]);

  // Mark a credit as transfer — the picked account is the SOURCE the money
  // came from. The destination is the credit's own account. For a CC credit
  // this is typically savings; for a demat credit (money sent to the broker,
  // arrived as an SMS credit on the demat account) the destination is demat
  // and we open the follow-up sheet to categorize.
  const handleCreditTransferSourceSelected = useCallback(async (fromAccountId: string) => {
    setCreditTransferPickerVisible(false);
    try {
      const transferId = await reclassifyCreditAsTransfer(id, fromAccountId, expense?.updated_at);
      if (expenseAccount?.account_type === "demat" && expense) {
        const label =
          expenseAccount.account_label ||
          `${expenseAccount.bank_name} ****${expenseAccount.account_identifier}`;
        setPendingDematTransfer({
          transferId,
          dematAccountId: expenseAccount.id,
          dematAccountLabel: label,
          amount: expense.amount,
          date: expense.date,
        });
        return;
      }
      // If the source account is demat (e.g. a fund redemption arriving as a savings credit),
      // automatically subtract from the fund snapshot — matches the pattern used in manual transfers.
      const fromAccount = accounts.find((a) => a.id === fromAccountId);
      if (fromAccount?.account_type === "demat" && expense) {
        try {
          await handleDematWithdrawalSideEffects(transferId, fromAccount.id, expense.amount, expense.date);
        } catch (e) {
          alert("Warning", `Transfer saved but fund snapshot could not be updated: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      // Cross-link to the resulting transfer so the user can see the payment
      // land. For CC bill payments, land on the CC account's ledger (the
      // destination account — "where did my bill payment go?"). For plain
      // self-transfers, do the same — the credit's own account is the landing
      // side the user was viewing a moment ago, just now with the payment
      // properly classified as a transfer.
      if (expenseAccount?.id && transferId) {
        router.replace({
          pathname: "/reconciliation/account-ledger",
          params: { accountId: expenseAccount.id, transferId },
        });
        return;
      }
      router.back();
    } catch (e) {
      logger.error("Reclassify credit as transfer failed:", e);
      alert("Error", formatError("Mark as transfer", e));
    }
  }, [id, router, expenseAccount, expense, accounts]);

  // Undo transfer reclassification
  const handleUndoTransfer = useCallback(async () => {
    if (!transfer) return;
    try {
      await undoTransfer(transfer.id);
      alert("Success", "Transfer has been undone. The expense/credit is restored.");
      router.back();
    } catch (e) {
      logger.error("Undo transfer failed:", e);
      alert("Error", formatError("Undo transfer", e));
    }
  }, [transfer, alert, router]);

  // Undo a single refund credit
  const handleUndoRefund = useCallback(async (refundCreditId: string) => {
    try {
      const { undoRefund } = await import("@/services/expense");
      await undoRefund(refundCreditId);
      // Refresh refund state inline — no need to navigate away
      const { getRefundedAmount, getRefundsForExpense } = await import("@/services/expense");
      const [amount, list] = await Promise.all([
        getRefundedAmount(id),
        getRefundsForExpense(id),
      ]);
      setRefundedAmount(amount);
      setRefunds(list);
    } catch (e) {
      logger.error("Undo refund failed:", e);
      alert("Error", formatError("Undo refund", e));
    }
  }, [id, alert]);

  // Navigate to account ledger
  const navigateToAccountLedger = useCallback((accountId: string) => {
    router.push({
      pathname: "/reconciliation/account-ledger",
      params: { accountId }
    });
  }, [router]);

  const navigateToTransferAccountLedger = useCallback((accountId: string) => {
    if (!transfer) {
      router.push({ pathname: "/reconciliation/account-ledger", params: { accountId } });
      return;
    }
    router.push({
      pathname: "/reconciliation/account-ledger",
      params: {
        accountId,
        month: transfer.date.slice(0, 7),
        transferId: transfer.id,
        filterMode: "transfers",
      },
    });
  }, [router, transfer]);

  // Pending review actions (approve/reject from detail page)
  const handleApprove = useCallback(async () => {
    try {
      await approveExpense(id);
      const updated = await getExpenseById(id);
      if (updated) {
        setExpense(updated);
        setOriginalExpense(updated);
      }
    } catch (e) {
      logger.error("Approve expense failed:", e);
      alert("Error", formatError("Approve expense", e));
    }
  }, [id]);

  const handleReject = useCallback(() => {
    alert(
      "Reject Expense",
      "This will reject the auto-detected expense. You can find it in the Review Queue if needed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reject",
          style: "destructive",
          onPress: async () => {
            try {
              await rejectExpense(id);
              router.back();
            } catch (e) {
              logger.error("Reject expense failed:", e);
              alert("Error", formatError("Reject expense", e));
            }
          },
        },
      ],
    );
  }, [id, router]);

  const handleDateShift = useCallback(
    (days: number) => {
      const current = new Date(date + "T00:00:00");
      current.setDate(current.getDate() + days);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (current > today) return;
      setDate(formatDateForStorage(current));
    },
    [date],
  );

  if (!loaded || !expense) {
    return (
      <ScreenContainer>
        <LoadingState message="Loading expense..." icon="receipt-outline" />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        behavior="padding"
        className="flex-1"
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
          <View className="flex-row items-center -ml-2">
            <Pressable onPress={() => router.back()} className="p-2">
              <Ionicons name="arrow-back" size={24} color={colors.textSecondary} />
            </Pressable>
            <Pressable onPress={() => router.replace("/(tabs)" as never)} className="p-2" hitSlop={8} accessibilityLabel="Go to Home">
              <Ionicons name="home-outline" size={20} color={colors.tint} />
            </Pressable>
          </View>
          <Text className="text-lg font-semibold text-foreground">
            {editing
              ? expense.nature === "credit"
                ? "Edit Credit"
                : expense.nature === "forecast"
                  ? "Edit Forecast"
                  : "Edit Expense"
              : expense.nature === "credit"
                ? "Credit"
                : expense.nature === "forecast"
                  ? "Forecast"
                  : "Expense"}
          </Text>
          {editing ? (
            <Pressable onPress={handleCancelEdit} className="p-2 -mr-2">
              <Text className="text-sm font-medium" style={{ color: theme.primary }}>Cancel</Text>
            </Pressable>
          ) : (
            <View className="flex-row items-center">
              <Pressable onPress={openRulePicker} className="p-2" accessibilityLabel="Apply rule">
                <Ionicons name="flash-outline" size={21} color={colors.textSecondary} />
              </Pressable>
              <Pressable onPress={handleEdit} className="p-2">
                <Ionicons name="create-outline" size={22} color={colors.blue} />
              </Pressable>
              <Pressable onPress={handleDelete} className="p-2 -mr-2">
                <Ionicons name="trash-outline" size={22} color={theme.danger} />
              </Pressable>
            </View>
          )}
        </View>

        <ScrollView
          ref={scrollRef}
          className="flex-1"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: tagPickerOpen ? 320 : 40 }}
        >
          {editing ? (
            /* ========== EDIT MODE ========== */
            <View className="p-4">
              {/* Amount */}
              <AmountInput
                value={amount}
                onChangeText={(text) => {
                  setAmount(text);
                  if (errors.amount) setErrors((e) => ({ ...e, amount: undefined }));
                }}
                error={errors.amount}
              />

              {/* Description */}
              <Input
                label="Description"
                value={description}
                onChangeText={setDescription}
                placeholder="What did you spend on?"
                maxLength={200}
                containerClassName="mb-4"
              />

              {/* Merchant Name */}
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

              {/* Transaction Time (read-only — from SMS, not editable) */}
              {expense.transaction_time && expense.transaction_time !== "00:00:00" && (
                <View className="mb-4">
                  <Text className="text-sm font-medium text-muted-foreground mb-2">
                    Transaction Time
                  </Text>
                  <View className="flex-row items-center rounded-lg border border-border bg-card px-4 py-3">
                    <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
                    <Text className="text-base text-muted-foreground ml-3">
                      {(() => {
                        const [h, m] = expense.transaction_time.split(":").map(Number);
                        const ampm = h >= 12 ? "PM" : "AM";
                        const hour12 = h % 12 || 12;
                        return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
                      })()}
                    </Text>
                    <Text className="text-xs text-muted-foreground ml-auto">
                      Read-only
                    </Text>
                  </View>
                </View>
              )}

              {/* Category picker */}
              <CategoryPicker
                categories={categories}
                categoryId={categoryId}
                selectedCategory={selectedCategory}
                showCategories={showCategories}
                allowNone
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
                allowNone
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

              {/* ───── Split-tender management ─────
                  - Standalone expenses can be converted to split-tender
                  - Existing legs can add siblings (up to cap) or unlink from the group
                  Split-tender is not offered for credits or forecasts. */}
              {expense.nature !== "credit" && expense.nature !== "forecast" && (
                <View className="mb-4">
                  {extraLegs.map((leg, idx) => {
                    const legAccount = accounts.find((a) => a.id === leg.accountId);
                    const legPM = paymentModes.find((p) => p.id === leg.paymentModeId);
                    const legAmt = parseAmount(leg.amount);
                    const legValid = legAmt != null && legAmt > 0;
                    return (
                      <View
                        key={leg.key}
                        className="rounded-xl border border-border p-3 mb-2"
                        style={{ backgroundColor: theme.alpha("primary", 0.1) }}
                      >
                        <View className="flex-row items-center justify-between mb-2">
                          <View className="flex-row items-center">
                            <Ionicons name="card-outline" size={16} color={theme.primary} />
                            <Text
                              className="ml-2 text-xs font-semibold uppercase tracking-wider"
                              style={{ color: theme.primary }}
                            >
                              New payment source {idx + 1}
                            </Text>
                          </View>
                          <Pressable
                            onPress={() =>
                              setExtraLegs((prev) => prev.filter((l) => l.key !== leg.key))
                            }
                            hitSlop={8}
                            accessibilityLabel="Remove this new payment source"
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
                                  ? { ...l, showAccounts: !l.showAccounts, showPaymentModes: false }
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
                                  ? { ...l, showPaymentModes: !l.showPaymentModes, showAccounts: false }
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

                  {/* Add-another button — only if under the cap */}
                  {siblings.length + 1 + extraLegs.length < MAX_PURCHASE_GROUP_LEGS && (
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
                      className="flex-row items-center justify-center py-3 rounded-xl border border-dashed border-border"
                      accessibilityRole="button"
                      accessibilityLabel="Add another payment source"
                    >
                      <Ionicons
                        name="add-circle-outline"
                        size={18}
                        color={theme.primary}
                      />
                      <Text
                        className="ml-2 text-sm font-medium"
                        style={{ color: theme.primary }}
                      >
                        Add another payment source
                      </Text>
                    </Pressable>
                  )}

                  {/* Remove from group (only when this expense is already a leg) */}
                  {expense.purchase_group_id && extraLegs.length === 0 && (
                    <Pressable
                      onPress={() => {
                        alert(
                          "Remove from split purchase?",
                          "This leg will become a standalone expense. The other legs of the purchase will remain grouped (unless this leaves only one - in which case the remaining leg becomes standalone too).",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Remove",
                              style: "destructive",
                              onPress: async () => {
                                try {
                                  await unlinkFromGroup(expense.id);
                                  const updated = await getExpenseById(expense.id);
                                  if (updated) {
                                    setExpense(updated);
                                    setOriginalExpense(updated);
                                    setSiblings([]);
                                  }
                                } catch (e) {
                                  alert("Error", formatError("Remove from group", e));
                                }
                              },
                            },
                          ],
                        );
                      }}
                      className="flex-row items-center justify-center py-3 mt-2 rounded-xl"
                      style={{ backgroundColor: theme.danger + "14" }}
                      accessibilityRole="button"
                      accessibilityLabel="Remove this leg from the split purchase"
                    >
                      <Ionicons
                        name="unlink-outline"
                        size={16}
                        color={theme.danger}
                      />
                      <Text
                        className="ml-2 text-sm font-medium"
                        style={{ color: theme.danger }}
                      >
                        Remove from split purchase
                      </Text>
                    </Pressable>
                  )}

                  {extraLegs.length > 0 && (
                    <Text className="text-label text-faint-foreground mt-2">
                      New legs inherit the merchant, date, category, and description of this expense. Up to {MAX_PURCHASE_GROUP_LEGS} payment sources per purchase.
                    </Text>
                  )}
                </View>
              )}

              {/* Save button */}
              <Button
                title={
                  expense.nature === "credit"
                    ? "Update Credit"
                    : expense.nature === "forecast"
                      ? "Update Forecast"
                      : extraLegs.length > 0 || expense.purchase_group_id
                        ? "Update Purchase"
                        : "Update Expense"
                }
                onPress={handleSave}
                loading={saving}
                className="mb-4"
              />
            </View>
          ) : (
            /* ========== READ-ONLY MODE (Axio-inspired) ========== */
            /* For credits, hide sections that don't apply (splits, right-spend,
               forecast actions, mark-as-transfer). Credits show amount, date,
               account, merchant/payer, category, and notes. */
            <View className="pb-8">
              {/* 1. Hero Card */}
              <ExpenseHeroCard
                merchantName={expense.merchant_name}
                description={expense.description}
                amount={expense.amount}
                categoryName={expenseCategory?.name ?? null}
                categoryColor={expenseCategory?.color ?? null}
                categoryIcon={expenseCategory?.icon ?? null}
                date={expense.date}
                dueDate={expense.due_date}
                transactionTime={expense.transaction_time}
                source={expense.source}
                nature={expense.nature}
                status={expense.status}
                refundedAmount={refundedAmount}
                splitOriginalAmount={expense.split_original_amount}
              />

              {/* 1b. Split-tender siblings (if this expense is one leg of a split purchase) */}
              {siblings.length > 0 && (
                <View className="mx-4 mt-3 rounded-xl bg-card">
                  <View className="flex-row items-center px-4 py-3 border-b border-border">
                    <View
                      className="w-8 h-8 rounded-full items-center justify-center mr-2.5"
                      style={{ backgroundColor: theme.alpha("primary", 0.1) }}
                    >
                      <Ionicons name="git-branch-outline" size={16} color={theme.primary} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Split Tender
                      </Text>
                      <Text className="text-xs text-faint-foreground mt-0.5">
                        Paid across {siblings.length + 1} payment source{siblings.length + 1 !== 1 ? "s" : ""}
                      </Text>
                    </View>
                    <Text className="text-sm font-bold text-foreground">
                      {formatAmount(
                        expense.amount + siblings.reduce((s, sib) => s + sib.amount, 0),
                      )}
                    </Text>
                  </View>

                  {siblings.map((sib, i) => {
                    const sibAccount = accounts.find((a) => a.id === sib.account_id);
                    const sibPM = paymentModes.find((p) => p.id === sib.payment_mode_id);
                    const label =
                      sibAccount?.account_label ||
                      (sibAccount
                        ? `${sibAccount.bank_name} ****${sibAccount.account_identifier}`
                        : sibPM?.name ?? "Unknown source");
                    return (
                      <Pressable
                        key={sib.id}
                        onPress={() => router.push(`/expense/${sib.id}`)}
                        className={`flex-row items-center px-4 py-3 ${i < siblings.length - 1 ? "border-b border-border" : ""}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Open sibling leg: ${label}`}
                      >
                        <Ionicons
                          name="card-outline"
                          size={16}
                          color={colors.textSecondary}
                          style={{ marginRight: 8 }}
                        />
                        <Text
                          className="flex-1 text-sm text-foreground"
                          numberOfLines={1}
                        >
                          {label}
                        </Text>
                        <Text className="text-sm font-semibold text-foreground mr-2">
                          {formatAmount(sib.amount)}
                        </Text>
                        <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* 1c. Pending Review Action Bar */}
              {expense.status === "pending_review" && !transfer && (
                <View className="mx-4 mt-1 flex-row rounded-xl overflow-hidden" style={{ backgroundColor: theme.warning + "12" }}>
                  <Pressable
                    onPress={handleApprove}
                    className="flex-1 flex-row items-center justify-center py-3"
                  >
                    <Ionicons name="checkmark-circle" size={20} color={theme.success} />
                    <Text className="text-sm font-semibold ml-1.5" style={{ color: theme.success }}>
                      Approve
                    </Text>
                  </Pressable>
                  <View className="w-px bg-border" />
                  <Pressable
                    onPress={handleReject}
                    className="flex-1 flex-row items-center justify-center py-3"
                  >
                    <Ionicons name="close-circle" size={20} color={theme.danger} />
                    <Text className="text-sm font-semibold ml-1.5" style={{ color: theme.danger }}>
                      Reject
                    </Text>
                  </Pressable>
                </View>
              )}

              {/* 2a. Timeline — detection + due + payment dates (forecasts only) */}
              {expense.nature === "forecast" && (() => {
                const detected = new Date(expense.created_at).toLocaleDateString("en-IN", {
                  day: "numeric", month: "short", year: "numeric",
                });
                const due = expense.due_date
                  ? new Date(expense.due_date + "T00:00:00").toLocaleDateString("en-IN", {
                      day: "numeric", month: "short", year: "numeric",
                    })
                  : null;
                const isPaid = expense.status === "rejected" && expense.paid_from_account_id;
                const paidOn = isPaid
                  ? new Date(expense.updated_at).toLocaleDateString("en-IN", {
                      day: "numeric", month: "short", year: "numeric",
                    })
                  : null;
                return (
                  <View className="mx-4 mt-3 rounded-xl bg-card">
                    <View className="flex-row items-center px-4 py-3 border-b border-border">
                      <Ionicons name="scan-outline" size={16} color={colors.textSecondary} />
                      <Text className="text-xs text-muted-foreground ml-3 w-24">
                        Detected
                      </Text>
                      <Text className="text-sm font-medium text-foreground flex-1 text-right">
                        {detected}
                      </Text>
                    </View>
                    {due && (
                      <View className={`flex-row items-center px-4 py-3 ${paidOn ? "border-b border-border" : ""}`}>
                        <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                        <Text className="text-xs text-muted-foreground ml-3 w-24">
                          Due
                        </Text>
                        <Text className="text-sm font-medium text-foreground flex-1 text-right">
                          {due}
                        </Text>
                      </View>
                    )}
                    {paidOn && (
                      <View className="flex-row items-center px-4 py-3">
                        <Ionicons name="checkmark-circle-outline" size={16} color={theme.success} />
                        <Text className="text-xs text-muted-foreground ml-3 w-24">
                          Paid on
                        </Text>
                        <Text className="text-sm font-medium flex-1 text-right" style={{ color: theme.success }}>
                          {paidOn}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })()}

              {/* 2. Summary Fields (read-only) */}
              <View className="mx-4 mt-3 rounded-xl bg-card">
                {/* Account */}
                <View className="flex-row items-center px-4 py-3 border-b border-border">
                  <Ionicons name="business-outline" size={16} color={colors.textSecondary} />
                  <Text className="text-xs text-muted-foreground ml-3 w-20">
                    Account
                  </Text>
                  {expenseAccount ? (
                    <Text className="text-sm font-medium text-foreground flex-1 text-right" numberOfLines={1}>
                      {expenseAccount.account_label || `${expenseAccount.bank_name} ****${expenseAccount.account_identifier}`}
                    </Text>
                  ) : (
                    <Text className="text-sm text-muted-foreground flex-1 text-right">
                      Not set
                    </Text>
                  )}
                </View>

                {/* Category */}
                <View className="flex-row items-center px-4 py-3 border-b border-border">
                  <Ionicons name="pricetags-outline" size={16} color={colors.textSecondary} />
                  <Text className="text-xs text-muted-foreground ml-3 w-20">
                    Category
                  </Text>
                  {expenseCategory ? (
                    <View className="flex-row items-center flex-1 justify-end">
                      <View
                        className="w-5 h-5 rounded-full items-center justify-center mr-1.5"
                        style={{ backgroundColor: expenseCategory.color + "14" }}
                      >
                        <Ionicons
                          name={expenseCategory.icon as keyof typeof Ionicons.glyphMap}
                          size={10}
                          color={expenseCategory.color}
                        />
                      </View>
                      <Text className="text-sm font-medium text-foreground">
                        {expenseCategory.name}
                      </Text>
                    </View>
                  ) : (
                    <Text className="text-sm text-muted-foreground flex-1 text-right">
                      Uncategorized
                    </Text>
                  )}
                </View>

                {/* Merchant */}
                <View className="flex-row items-center px-4 py-3 border-b border-border">
                  <Ionicons name="storefront-outline" size={16} color={colors.textSecondary} />
                  <Text className="text-xs text-muted-foreground ml-3 w-20">
                    Merchant
                  </Text>
                  {expense.merchant_name ? (
                    <Text className="text-sm font-medium text-foreground flex-1 text-right">
                      {expense.merchant_name}
                    </Text>
                  ) : (
                    <Text className="text-sm text-muted-foreground flex-1 text-right">
                      Not set
                    </Text>
                  )}
                </View>

                {/* Payment Mode */}
                <View className="flex-row items-center px-4 py-3 border-b border-border">
                  <Ionicons name="card-outline" size={16} color={colors.textSecondary} />
                  <Text className="text-xs text-muted-foreground ml-3 w-20">
                    Payment
                  </Text>
                  {expensePaymentMode ? (
                    <View className="flex-row items-center flex-1 justify-end">
                      <Ionicons
                        name={TYPE_ICONS[expensePaymentMode.type as PaymentModeType]}
                        size={14}
                        color={colors.textSecondary}
                      />
                      <Text className="text-sm font-medium text-foreground ml-1.5">
                        {expensePaymentMode.name}
                      </Text>
                    </View>
                  ) : (
                    <Text className="text-sm text-muted-foreground flex-1 text-right">
                      Not set
                    </Text>
                  )}
                </View>

                {/* Spend Classification — hidden for credits (doesn't apply to income) */}
                {expense.nature !== "credit" && (
                  <View className="flex-row items-center px-4 py-3 border-b border-border">
                    <Ionicons
                      name={expense.is_right_spend !== 0 ? "lock-closed" : "pricetag-outline"}
                      size={16}
                      color={expense.is_right_spend !== 0 ? colors.blue : theme.warning}
                    />
                    <Text className="text-xs text-muted-foreground ml-3 w-20">
                      Spend
                    </Text>
                    <Text className="text-sm font-medium text-foreground flex-1 text-right">
                      {expense.is_right_spend !== 0 ? "Unavoidable" : "Discretionary"}
                    </Text>
                  </View>
                )}

                {/* Description / Notes */}
                {expense.description && (
                  <View className="flex-row items-start px-4 py-3">
                    <Ionicons name="document-text-outline" size={16} color={colors.textSecondary} />
                    <Text className="text-xs text-muted-foreground ml-3 w-20">
                      Notes
                    </Text>
                    <Text
                      className="text-sm text-foreground flex-1 text-right"
                      numberOfLines={3}
                    >
                      {expense.description}
                    </Text>
                  </View>
                )}
              </View>

              {/* 4. Split Section — not applicable for credits */}
              {expense.nature !== "credit" && (
              <View className="mx-4 mt-3">
                {multiSplitSummary ? (
                  /* ── Multi-split active ── */
                  <View>
                    <View
                      className="py-3 px-4 rounded-xl"
                      style={{ backgroundColor: theme.alpha("primary", 0.08) }}
                    >
                      <View className="flex-row items-center mb-2">
                        <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                          <Ionicons name="people" size={20} color={colors.blue} />
                        </View>
                        <View className="flex-1">
                          <Text className="text-sm font-semibold" style={{ color: theme.primary }}>
                            Split with:
                          </Text>
                          <Text className="text-xs text-muted-foreground mt-0.5">
                            Originally {formatAmount(multiSplitSummary.originalAmount)}
                          </Text>
                        </View>
                      </View>

                      {/* Per-person split rows — tappable to navigate to ledger */}
                      {multiSplitSummary.splits.map((split) => (
                        <Pressable
                          key={split.id}
                          onPress={() => {
                            const { startDate, endDate } = getMonthDateRange(expense!.date.substring(0, 7));
                            router.push({
                              pathname: "/hisaab/ledger",
                              params: { personId: split.hisaab_person_id, personName: split.person_name, fromDate: startDate, toDate: endDate },
                            });
                          }}
                          className="flex-row items-center py-2 ml-13"
                        >
                          <View className="flex-1">
                            <Text className="text-xs font-medium text-foreground" numberOfLines={1}>
                              {split.person_name}
                            </Text>
                            {split.description && (
                              <Text className="text-label text-muted-foreground" numberOfLines={1}>
                                {split.description}
                              </Text>
                            )}
                          </View>
                          <Text className="text-xs font-semibold text-foreground ml-2">
                            {formatAmount(split.amount)}
                          </Text>
                          <Ionicons name="chevron-forward" size={12} color={colors.textSecondary} className="ml-1" />
                        </Pressable>
                      ))}

                      {/* My share (absorbed portion) */}
                      {multiSplitSummary.convenienceFee > 0 && (
                        <View className="flex-row items-center py-1.5 ml-13 mt-1 pt-1.5 border-t border-border">
                          <Text className="text-xs text-muted-foreground flex-1">
                            My share
                          </Text>
                          <Text className="text-xs font-semibold" style={{ color: STATUS_COLORS.warning }}>
                            {formatAmount(multiSplitSummary.convenienceFee)}
                          </Text>
                        </View>
                      )}

                      {/* My share */}
                      <View className="flex-row items-center py-1.5 ml-13 mt-1 pt-1.5 border-t border-border">
                        <Text className="text-xs font-medium text-foreground flex-1">
                          My budget
                        </Text>
                        <Text className="text-xs font-bold" style={{ color: theme.primary }}>
                          {formatAmount(multiSplitSummary.myShare)}
                        </Text>
                      </View>
                    </View>

                    <View className="flex-row items-center justify-center mt-1.5 gap-4">
                      <Pressable
                        onPress={() => setShowMultiSplitSheet(true)}
                        className="py-2 px-3 rounded-lg"
                      >
                        <Text className="text-label font-medium" style={{ color: theme.primary }}>
                          Change Split
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={handleRemoveMultiSplit}
                        className="py-2 px-3 rounded-lg"
                      >
                        <Text className="text-label font-medium" style={{ color: theme.danger }}>
                          Remove Split
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : expense.split_person_id ? (
                  /* ── Legacy single split active ── */
                  <View>
                    <View
                      className="py-3 px-4 rounded-xl"
                      style={{ backgroundColor: theme.alpha("primary", 0.08) }}
                    >
                      <View className="flex-row items-center mb-2">
                        <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                          <Ionicons name="people" size={20} color={colors.blue} />
                        </View>
                        <View className="flex-1">
                          <Text className="text-sm font-semibold" style={{ color: theme.primary }}>
                            Split with:
                          </Text>
                          <Text className="text-xs text-muted-foreground mt-0.5">
                            Originally {formatAmount(expense.split_original_amount ?? expense.amount)}
                          </Text>
                        </View>
                      </View>

                      {/* Split details */}
                      <Pressable
                        onPress={() => {
                          const { startDate, endDate } = getMonthDateRange(expense.date.substring(0, 7));
                          router.push({
                            pathname: "/hisaab/ledger",
                            params: { personId: expense.split_person_id!, personName: splitPersonName ?? "Person", fromDate: startDate, toDate: endDate },
                          });
                        }}
                        className="flex-row items-center py-2 ml-13"
                      >
                        <View className="flex-1">
                          <Text className="text-xs font-medium text-foreground" numberOfLines={1}>
                            {splitPersonName ?? "Unknown"}
                          </Text>
                          <Text className="text-label text-muted-foreground">
                            {(() => {
                              const orig = expense.split_original_amount ?? expense.amount;
                              const pct = expense.split_pct ?? 100;
                              const myShare = refundedAmount > 0
                                ? Math.max(0, Math.round((orig - refundedAmount) * pct / 100 * 100) / 100)
                                : expense.amount;
                              return `Your share: ${pct}% (${formatAmount(myShare)})`;
                            })()}
                          </Text>
                        </View>
                        <Text className="text-xs font-semibold text-foreground ml-2">
                          {formatAmount(expense.split_original_amount ?? expense.amount)}
                        </Text>
                        <Ionicons name="chevron-forward" size={12} color={colors.textSecondary} className="ml-1" />
                      </Pressable>
                    </View>
                    <View className="flex-row items-center justify-center mt-1.5 gap-4">
                      <Pressable
                        onPress={() => setShowMultiSplitSheet(true)}
                        className="py-2 px-3 rounded-lg"
                      >
                        <Text className="text-label font-medium" style={{ color: theme.primary }}>
                          Change Split
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={handleRemoveSplit}
                        className="py-2 px-3 rounded-lg"
                      >
                        <Text className="text-label font-medium" style={{ color: theme.danger }}>
                          Remove Split
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  /* ── No split — show split options ── */
                  <View className="gap-2">
                    <Pressable
                      onPress={() => setShowSplitSheet(true)}
                      className="flex-row items-center py-3 px-4 rounded-xl bg-card"
                    >
                      <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                        <Ionicons name="people-outline" size={20} color={colors.blue} />
                      </View>
                      <View className="flex-1">
                        <Text className="text-sm font-semibold text-foreground">
                          Split Expense
                        </Text>
                        <Text className="text-xs text-muted-foreground mt-0.5">
                          50-50, they owe, I owe, exact amount
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                    </Pressable>
                    <Pressable
                      onPress={() => setShowMultiSplitSheet(true)}
                      className="flex-row items-center py-2.5 px-4 rounded-xl bg-card"
                    >
                      <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                        <Ionicons name="git-network-outline" size={20} color={colors.blue} />
                      </View>
                      <View className="flex-1">
                        <Text className="text-sm font-semibold text-foreground">
                          Multi-person Split
                        </Text>
                        <Text className="text-xs text-muted-foreground mt-0.5">
                          Split among multiple people
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                    </Pressable>
                  </View>
                )}
              </View>
              )}

              {/* 4b. Tags */}
              <View className="mx-4 mt-3">
                <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Tags
                </Text>
                <TagPicker
                  expenseId={expense.id}
                  onOpen={() => {
                    setTagPickerOpen(true);
                    const sub = Keyboard.addListener("keyboardDidShow", () => {
                      scrollRef.current?.scrollToEnd({ animated: true });
                      sub.remove();
                    });
                    // Fallback if keyboard is already visible
                    setTimeout(() => {
                      scrollRef.current?.scrollToEnd({ animated: true });
                    }, 400);
                  }}
                  onClose={() => setTagPickerOpen(false)}
                />
              </View>

              {/* 4c. Forecast Actions (only for forecasts) */}
              {expense.nature === "forecast" && (
                <View className="mx-4 mt-3 rounded-xl bg-card overflow-hidden">
                  <View className="px-4 pt-3 pb-1">
                    <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Forecast Actions
                    </Text>
                  </View>
                  <ForecastActionBar
                    forecastId={expense.id}
                    forecastType={expense.forecast_type}
                    onMarkAsPaid={handleForecastMarkPaid}
                    onRealiseNow={handleForecastRealise}
                    onDelete={handleForecastDelete}
                    onRepaymentPaid={handleForecastRepaymentPaid}
                    onPaidExternally={handleForecastPaidExternally}
                  />
                </View>
              )}

              {/* 4d. Transfer Details (shown when expense is reclassified as transfer) */}
              {transfer && (
                <View className="mx-4 mt-3 rounded-xl bg-card overflow-hidden">
                  <View className="px-4 pt-3 pb-1">
                    <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Transfer Details
                    </Text>
                  </View>
                  <View className="px-4 py-3">
                    <View className="flex-row items-center mb-3">
                      <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                        <Ionicons name="swap-horizontal-outline" size={20} color={colors.blue} />
                      </View>
                      <View className="flex-1">
                        <Text className="text-sm font-semibold text-foreground">
                          Marked as Transfer
                        </Text>
                      </View>
                    </View>
                    <View className="ml-13 mb-3">
                      <Text className="text-xs text-muted-foreground mb-1">From:</Text>
                      <Pressable onPress={() => navigateToTransferAccountLedger(transfer.from_account_id)}>
                        <Text className="text-sm font-semibold" style={{ color: theme.primary }}>
                          {accounts.find(a => a.id === transfer.from_account_id)?.bank_name || "Unknown"} ****{accounts.find(a => a.id === transfer.from_account_id)?.account_identifier || ""}
                        </Text>
                      </Pressable>
                    </View>
                    <View className="ml-13 mb-3">
                      <Text className="text-xs text-muted-foreground mb-1">To:</Text>
                      <Pressable onPress={() => navigateToTransferAccountLedger(transfer.to_account_id)}>
                        <Text className="text-sm font-semibold" style={{ color: theme.primary }}>
                          {accounts.find(a => a.id === transfer.to_account_id)?.bank_name || "Unknown"} ****{accounts.find(a => a.id === transfer.to_account_id)?.account_identifier || ""}
                        </Text>
                      </Pressable>
                    </View>
                    <View className="ml-13 mb-3">
                      <Text className="text-xs text-muted-foreground mb-1">Amount:</Text>
                      <Text className="text-sm font-semibold text-foreground">
                        ₹{transfer.amount.toLocaleString()}
                      </Text>
                    </View>
                    <View className="ml-13">
                      <Text className="text-xs text-muted-foreground mb-1">Date:</Text>
                      <Text className="text-sm font-semibold text-foreground">
                        {transfer.date}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={handleUndoTransfer}
                    className="mx-4 mb-3 flex-row items-center py-3 px-4 rounded-xl bg-background"
                  >
                    <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                      <Ionicons name="arrow-undo-outline" size={20} color={colors.blue} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-foreground">
                        Undo Transfer
                      </Text>
                      <Text className="text-xs text-muted-foreground mt-0.5">
                        Convert back to expense
                      </Text>
                    </View>
                  </Pressable>
                </View>
              )}

              {/* 4e. Mark as Transfer (realized savings debits only, shown when not reclassified) */}
              {!transfer && expense.nature === "realized" && expense.account_id && expenseAccount?.account_type === "savings" && (
                <Pressable
                  onPress={() => setTransferPickerVisible(true)}
                  className="mx-4 mt-3 flex-row items-center py-3 px-4 rounded-xl bg-card"
                >
                  <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                    <Ionicons name="swap-horizontal-outline" size={20} color={colors.blue} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">
                      Mark as Transfer
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      This was a transfer, not spending
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>
              )}

              {/* 4e. Mark as Transfer (credits) — for incoming SMS credits that were
                   actually a CC bill payment or a self-transfer. Labels differ for
                   CC credits (bill payment mental model) vs savings credits.
                   Hidden once a settlement link is in place (the credit's
                   already been claimed). */}
              {!transfer && expense.nature === "credit" && expense.account_id && !linkedSettlement && (
                <Pressable
                  onPress={() => setCreditTransferPickerVisible(true)}
                  className="mx-4 mt-3 flex-row items-center py-3 px-4 rounded-xl bg-card"
                  accessibilityRole="button"
                  accessibilityLabel="Mark this credit as a transfer from another account"
                >
                  <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                    <Ionicons name="swap-horizontal-outline" size={20} color={colors.blue} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">
                      {expenseAccount?.account_type === "credit_card" ? "Mark as CC Bill Payment" : "Mark as Transfer"}
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      {expenseAccount?.account_type === "credit_card"
                        ? "This was your bill paid from another account"
                        : "This money came from another account of yours"}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>
              )}

              {/* 4f. v15.12.0: Mark as Settlement (credits only, non-CC). For
                   incoming money that was actually a friend/family settling
                   up a hisaab balance. Hidden for credit-card accounts (a CC
                   credit is always a bill payment/refund, not a settlement)
                   and hidden if already linked. */}
              {expense.nature === "credit"
                && expense.account_id
                && expenseAccount?.account_type !== "credit_card"
                && !linkedSettlement && (
                <Pressable
                  onPress={() => setHisaabSettlementSheetVisible(true)}
                  className="mx-4 mt-3 flex-row items-center py-3 px-4 rounded-xl bg-card"
                  accessibilityRole="button"
                  accessibilityLabel="Mark this credit as a settlement from a hisaab person"
                >
                  <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                    <Ionicons name="people-outline" size={20} color={colors.blue} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">
                      Mark as Settlement
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      Someone paid you back from hisaab
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>
              )}

              {/* v15.12.0: Linked-to-hisaab badge — shown when this credit is
                   already marked as a settlement. Tap the person name to jump
                   to their hisaab ledger; tap Unlink to unmark (keeps credit). */}
              {expense.nature === "credit" && linkedSettlement && (
                <View
                  className="mx-4 mt-3 p-3 rounded-xl"
                  style={{ backgroundColor: theme.alpha("primary", 0.1) }}
                >
                  <View className="flex-row items-center">
                    <View
                      className="w-10 h-10 rounded-full items-center justify-center mr-3"
                      style={{ backgroundColor: theme.alpha("primary", 0.1) }}
                    >
                      <Ionicons
                        name="people"
                        size={20}
                        color={theme.primary}
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                        Settlement from {linkedSettlement.personName}
                      </Text>
                      <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                        Applied against their hisaab balance.
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row mt-3 gap-2">
                    <Pressable
                      onPress={() => router.push(`/hisaab/ledger?personId=${linkedSettlement.personId}`)}
                      className="flex-1 py-2 rounded-lg items-center"
                      style={{ backgroundColor: theme.primary }}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${linkedSettlement.personName}'s hisaab ledger`}
                    >
                      <Text className="text-sm font-semibold text-white">View ledger</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleUnlinkSettlement}
                      className="flex-1 py-2 rounded-lg items-center"
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                      accessibilityRole="button"
                      accessibilityLabel="Unlink settlement"
                    >
                      <Text className="text-sm font-semibold" style={{ color: colors.textSecondary }}>
                        Unlink
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {/* Tag as Refund (credits only) — links this credit to the expense it
                   refunded. Hidden when already linked, or already classified
                   as settlement/transfer (mutually exclusive). */}
              {expense.nature === "credit"
                && !expense.refund_of_expense_id
                && !linkedSettlement
                && !transfer && (
                <Pressable
                  onPress={() => setRefundExpensePickerVisible(true)}
                  className="mx-4 mt-3 flex-row items-center py-3 px-4 rounded-xl bg-card"
                  accessibilityRole="button"
                  accessibilityLabel="Tag this credit as a refund for an expense"
                >
                  <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                    <Ionicons name="return-up-back-outline" size={20} color={colors.blue} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">
                      Tag as Refund
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      Link to the expense this money came back for
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>
              )}

              {/* Badge: credit already tagged as refund. Tap expense name to deep-link;
                   tap Unlink to remove the soft link (credit stays in ledger). */}
              {expense.nature === "credit" && expense.refund_of_expense_id && (
                <View
                  className="mx-4 mt-3 p-3 rounded-xl"
                  style={{ backgroundColor: theme.alpha("primary", 0.1) }}
                >
                  <View className="flex-row items-center">
                    <View
                      className="w-10 h-10 rounded-full items-center justify-center mr-3"
                      style={{ backgroundColor: theme.alpha("primary", 0.1) }}
                    >
                      <Ionicons
                        name="return-up-back"
                        size={20}
                        color={theme.primary}
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                        Refund for {linkedExpenseSummary ?? "an expense"}
                      </Text>
                      <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                        Reduces effective spend in budget &amp; insights
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row mt-3 gap-2">
                    <Pressable
                      onPress={() => router.push(`/expense/${expense.refund_of_expense_id}`)}
                      className="flex-1 py-2 rounded-lg items-center"
                      style={{ backgroundColor: theme.primary }}
                      accessibilityRole="button"
                      accessibilityLabel="Open the linked expense"
                    >
                      <Text className="text-sm font-semibold text-white">View expense</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleUnlinkCreditAsRefund}
                      className="flex-1 py-2 rounded-lg items-center"
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                      accessibilityRole="button"
                      accessibilityLabel="Unlink refund"
                    >
                      <Text className="text-sm font-semibold" style={{ color: colors.textSecondary }}>
                        Unlink
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {/* v17.0.0: Mark as Investment (realized, non-credit, non-refund,
                   non-split). Lets user promote an expense (SIP, PPF, gold
                   purchase) to an investment bucket contribution. */}
              {V15_FLAGS.v17_expense_investment_link
                && expense.nature === "realized"
                && !expense.refund_of_expense_id
                && !expense.purchase_group_id
                && !investmentLink && (
                <Pressable
                  onPress={() => setInvestmentSheetVisible(true)}
                  className="mx-4 mt-3 flex-row items-center py-3 px-4 rounded-xl bg-card"
                  accessibilityRole="button"
                  accessibilityLabel="Mark this expense as an investment contribution"
                >
                  <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                    <Ionicons name="trending-up-outline" size={20} color={colors.blue} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">
                      Mark as Investment
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      Credits an Investment Bucket instead of counting as spend
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>
              )}

              {/* v17.0.0: Investment-linked badge */}
              {investmentLink && (
                <View
                  className="mx-4 mt-3 p-3 rounded-xl"
                  style={{ backgroundColor: theme.alpha("primary", 0.1) }}
                >
                  <View className="flex-row items-center">
                    <View
                      className="w-10 h-10 rounded-full items-center justify-center mr-3"
                      style={{ backgroundColor: theme.alpha("primary", 0.1) }}
                    >
                      <Ionicons
                        name="trending-up"
                        size={20}
                        color={theme.primary}
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                        Investment · {investmentBucketName ?? "Bucket"}
                      </Text>
                      <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                        Credited to the bucket. Excluded from this month's budget.
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row mt-3 gap-2">
                    <Pressable
                      onPress={() => router.push({ pathname: "/goals/investment-detail", params: { bucketId: investmentLink.investment_bucket_id } } as never)}
                      className="flex-1 py-2 rounded-lg items-center"
                      style={{ backgroundColor: theme.primary }}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${investmentBucketName} bucket`}
                    >
                      <Text className="text-sm font-semibold text-white">View bucket</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleUnlinkInvestment}
                      className="flex-1 py-2 rounded-lg items-center"
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                      accessibilityRole="button"
                      accessibilityLabel="Unlink investment"
                    >
                      <Text className="text-sm font-semibold" style={{ color: colors.textSecondary }}>
                        Unlink
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {/* v17.4.0: Mark as Loan Payment (realized, non-credit, non-refund,
                   non-split, non-investment-linked). Same guard family as
                   Mark-as-Investment. */}
              {V15_FLAGS.v17_loans_v1
                && expense.nature === "realized"
                && !expense.refund_of_expense_id
                && !expense.purchase_group_id
                && !investmentLink
                && !loanLink && (
                <Pressable
                  onPress={() => setLoanSheetVisible(true)}
                  className="mx-4 mt-3 flex-row items-center py-3 px-4 rounded-xl bg-card"
                  accessibilityRole="button"
                  accessibilityLabel="Mark this expense as a loan payment"
                >
                  <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                    <Ionicons name="cash-outline" size={20} color={colors.blue} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">
                      Mark as Loan Payment
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      EMI or prepayment. Excluded from budget.
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>
              )}

              {/* v17.4.0: Loan-linked badge */}
              {loanLink && (
                <View
                  className="mx-4 mt-3 p-3 rounded-xl"
                  style={{ backgroundColor: theme.alpha("primary", 0.1) }}
                >
                  <View className="flex-row items-center">
                    <View
                      className="w-10 h-10 rounded-full items-center justify-center mr-3"
                      style={{ backgroundColor: theme.alpha("primary", 0.1) }}
                    >
                      <Ionicons
                        name={loanLink.link_kind === "emi" ? "calendar" : "trending-down"}
                        size={20}
                        color={theme.primary}
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                        {loanLink.link_kind === "emi" ? "EMI" : "Prepayment"}
                        {linkedLoanBankName ? ` · ${linkedLoanBankName}` : ""}
                        {linkedLoan ? ` ${linkedLoan.loan_type}` : ""}
                      </Text>
                      <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                        {loanLink.link_kind === "emi"
                          ? "Logged against the scheduled installment."
                          : "Principal reduced. Excluded from budget."}
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row mt-3 gap-2">
                    <Pressable
                      onPress={() =>
                        router.push({ pathname: "/loans/[id]", params: { id: loanLink.loan_account_id } } as never)
                      }
                      className="flex-1 py-2 rounded-lg items-center"
                      style={{ backgroundColor: theme.primary }}
                      accessibilityRole="button"
                      accessibilityLabel="View loan"
                    >
                      <Text className="text-sm font-semibold text-white">View loan</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleUnlinkLoan}
                      className="flex-1 py-2 rounded-lg items-center"
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                      accessibilityRole="button"
                      accessibilityLabel="Unlink loan payment"
                    >
                      <Text className="text-sm font-semibold" style={{ color: colors.textSecondary }}>
                        Unlink
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {/* Set reminder / Stop reminder — realized expenses only.
                  Forecasts themselves don't get a reminder (that would be a
                  reminder on a reminder's output). */}
              {expense.nature === "realized" && (
                <Pressable
                  onPress={() =>
                    recurringRule ? handleStopRecurring() : setRecurringSheetVisible(true)
                  }
                  className="mx-4 mt-3 flex-row items-center py-3 px-4 rounded-xl bg-card"
                  accessibilityRole="button"
                  accessibilityLabel={recurringRule ? "Stop reminder" : "Set reminder"}
                >
                  <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                    <Ionicons
                      name={recurringRule ? "pause-circle-outline" : "repeat-outline"}
                      size={20}
                      color={colors.blue}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">
                      {recurringRule ? "Stop reminder" : "Set reminder"}
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      {recurringRule
                        ? `Reminds ${recurringRule.frequency}${recurringRule.end_date ? ` · Until ${recurringRule.end_date}` : ""}`
                        : "Get reminded on a schedule"}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>
              )}

              {/* v14.7.0: Recurring-reminder suggestion banner. Shown only
                  when this realized expense isn't already linked and a
                  pending rule matches by merchant + date window. Tapping
                  "Link" fulfills the reminder; "Dismiss" hides the banner
                  for this session only. */}
              {expense.nature === "realized" && suggestedReminder && (
                <View
                  className="mx-4 mt-3 p-3 rounded-xl"
                  style={{ backgroundColor: theme.alpha("primary", 0.1) }}
                >
                  <View className="flex-row items-start">
                    <Ionicons name="repeat-outline" size={18} color={theme.primary} />
                    <View className="flex-1 ml-2">
                      <Text
                        className="text-sm font-semibold"
                        style={{ color: theme.primary }}
                      >
                        Link to a reminder?
                      </Text>
                      <Text className="text-xs text-muted-foreground mt-0.5">
                        Looks like this could fulfill a recurring reminder due {suggestedReminder.next_due_date}.
                      </Text>
                      <View className="flex-row mt-2">
                        <Pressable
                          onPress={async () => {
                            try {
                              await fulfillReminder(suggestedReminder.id, expense.id);
                              const rules = await getActiveRecurringRules(DEFAULT_USER_ID);
                              const match = rules.find(
                                (r) => r.id === suggestedReminder.id,
                              );
                              setFulfilledRule(match ?? suggestedReminder);
                              setSuggestedReminder(null);
                            } catch (e) {
                              alert("Couldn't link", formatError("Link reminder", e));
                            }
                          }}
                          className="px-3 py-1.5 rounded-lg mr-2"
                          style={{ backgroundColor: theme.primary }}
                          accessibilityRole="button"
                          accessibilityLabel="Link this expense to the reminder"
                        >
                          <Text className="text-xs font-semibold text-white">Link</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setSuggestedReminder(null)}
                          className="px-3 py-1.5 rounded-lg"
                          accessibilityRole="button"
                          accessibilityLabel="Dismiss suggestion"
                        >
                          <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
                            Dismiss
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                </View>
              )}

              {/* v15.2: Smart-rule-applied badge (tap to open the rule). */}
              {expense.applied_rule_id && appliedRuleSummary && (
                <Pressable
                  onPress={() =>
                    router.push(`/settings/smart-rules/${expense.applied_rule_id}` as never)
                  }
                  className="mx-4 mt-3 p-3 rounded-xl flex-row items-center bg-card"
                  accessibilityRole="button"
                >
                  <Ionicons name={expense.applied_rule_manually ? "flash-outline" : "sparkles"} size={18} color={colors.textSecondary} />
                  <View className="flex-1 ml-2">
                    <Text className="text-sm font-semibold text-foreground">
                      {expense.applied_rule_manually ? "Applied manually" : "Processed by rule"}
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      {appliedRuleSummary}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
                </Pressable>
              )}

              {/* v14.7.0: Fulfilled-reminder badge + tap to detail + Undo. */}
              {expense.nature === "realized" && fulfilledRule && (
                <Pressable
                  onPress={() => router.push(`/settings/recurring-rule-detail?ruleId=${fulfilledRule.id}` as never)}
                  className="mx-4 mt-3 p-3 rounded-xl flex-row items-center"
                  style={{ backgroundColor: theme.success + "14" }}
                  accessibilityRole="button"
                  accessibilityLabel="View reminder details"
                >
                  <Ionicons
                    name="checkmark-circle"
                    size={18}
                    color={theme.success}
                  />
                  <View className="flex-1 ml-2">
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: theme.success }}
                    >
                      {fulfilledRule.notes
                        ? fulfilledRule.notes
                        : "Fulfilled a recurring reminder"}
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      {fulfilledRule.frequency} reminder · Tap to view
                    </Text>
                  </View>
                  <View className="flex-row items-center ml-1">
                    <Pressable
                      onPress={async () => {
                        try {
                          await unfulfillReminder(expense.id);
                          setFulfilledRule(null);
                        } catch (err) {
                          alert("Couldn't unlink", formatError("Unlink reminder", err));
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Unlink this reminder"
                      hitSlop={8}
                    >
                      <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
                        Undo
                      </Text>
                    </Pressable>
                    <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} style={{ marginLeft: 8 }} />
                  </View>
                </Pressable>
              )}

              {/* Duplicate — create a new expense/credit pre-filled from this one. */}
              {(expense.nature === "realized" || expense.nature === "credit") && (
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/expense/add",
                      params: { copyFromExpenseId: expense.id },
                    })
                  }
                  className="mx-4 mt-3 flex-row items-center py-3 px-4 rounded-xl bg-card"
                  accessibilityRole="button"
                  accessibilityLabel="Duplicate this expense"
                >
                  <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                    <Ionicons name="copy-outline" size={20} color={colors.blue} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">
                      Duplicate
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      {expense.nature === "credit" ? "Start a new credit pre-filled from this one" : "Start a new expense pre-filled from this one"}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>
              )}

              {/* Refund Details card — shown when at least one refund has been recorded */}
              {expense.nature === "realized" && refunds.length > 0 && (
                <View className="mx-4 mt-3 rounded-xl bg-card overflow-hidden">
                  <View className="px-4 pt-3 pb-1">
                    <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Refund Details
                    </Text>
                  </View>
                  {refunds.map((refund, idx) => (
                    <View key={refund.id}>
                      <View className="px-4 py-3">
                        <View className="flex-row items-center mb-2">
                          <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                            <Ionicons name="return-up-back-outline" size={20} color={colors.blue} />
                          </View>
                          <View className="flex-1">
                            <Text className="text-sm font-semibold text-foreground">
                              {refunds.length > 1 ? `Refund ${idx + 1}` : "Refunded"}
                            </Text>
                          </View>
                        </View>
                        <View className="ml-13 mb-1">
                          <Text className="text-xs text-muted-foreground mb-0.5">Amount:</Text>
                          <Text className="text-sm font-semibold text-foreground">
                            {formatAmount(refund.amount)}
                          </Text>
                        </View>
                        <View className="ml-13">
                          <Text className="text-xs text-muted-foreground mb-0.5">Date:</Text>
                          <Text className="text-sm font-semibold text-foreground">
                            {refund.date}
                          </Text>
                        </View>
                      </View>
                      <Pressable
                        onPress={() => handleUndoRefund(refund.id)}
                        className="mx-4 mb-3 flex-row items-center py-3 px-4 rounded-xl bg-background"
                      >
                        <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                          <Ionicons name="arrow-undo-outline" size={20} color={colors.blue} />
                        </View>
                        <View className="flex-1">
                          <Text className="text-sm font-semibold text-foreground">
                            Undo Refund
                          </Text>
                          <Text className="text-xs text-muted-foreground mt-0.5">
                            Remove this refund record
                          </Text>
                        </View>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              {/* Record a refund — hidden once the expense is fully refunded */}
              {expense.nature === "realized" && refundedAmount < (expense.split_original_amount ?? expense.amount) && (
                <Pressable
                  onPress={() => setRefundTargetSheetVisible(true)}
                  className="mx-4 mt-3 flex-row items-center py-3 px-4 rounded-xl bg-card"
                  accessibilityRole="button"
                  accessibilityLabel="Record a refund for this expense"
                >
                  <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                    <Ionicons name="return-up-back-outline" size={20} color={colors.blue} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">
                      Record a Refund
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      Money came back for this expense
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>
              )}

              {/* 5. Other Info (Collapsible Metadata) */}
              <ExpenseMetadata expense={expense} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {expense && (
        <SplitSheet
          visible={showSplitSheet}
          onClose={() => setShowSplitSheet(false)}
          totalAmount={expense.split_original_amount ?? expense.amount}
          onConfirm={handleSplitConfirm}
        />
      )}

      {expense && (
        <MultiSplitSheet
          visible={showMultiSplitSheet}
          onClose={() => setShowMultiSplitSheet(false)}
          totalAmount={expense.split_original_amount ?? expense.amount}
          onConfirm={handleMultiSplitConfirm}
          initialSplits={multiSplitSummary?.splits.map((s) => ({
            personId: s.hisaab_person_id,
            description: s.description ?? "",
            amount: s.amount,
          }))}
          initialFeeAbsorbed={multiSplitSummary?.feeAbsorbed}
        />
      )}

      <AccountPickerSheet
        visible={repaymentPickerVisible}
        onSelect={handleRepaymentAccountSelected}
        onClose={() => setRepaymentPickerVisible(false)}
        title="Pay from which account?"
      />

      <AccountPickerSheet
        visible={transferPickerVisible}
        onSelect={handleTransferAccountSelected}
        onClose={() => setTransferPickerVisible(false)}
        title="Transfer to which account?"
        filterTypes={["savings", "credit_card", "wallet", "demat"]}
      />

      <AccountPickerSheet
        visible={creditTransferPickerVisible}
        onSelect={handleCreditTransferSourceSelected}
        onClose={() => setCreditTransferPickerVisible(false)}
        title={
          expenseAccount?.account_type === "credit_card"
            ? "Pay from which account?"
            : "Money came from which account?"
        }
        filterTypes={["savings", "wallet", "demat"]}
        excludeAccountId={expense?.account_id ?? undefined}
      />

      {/* Demat fund/portfolio + optional bucket follow-up. Rendered only when
          a Mark-as-Transfer lands in a demat account; dismissible via Skip. */}
      {pendingDematTransfer && (
        <DematTransferTargetSheet
          visible={true}
          dematAccountLabel={pendingDematTransfer.dematAccountLabel}
          amount={pendingDematTransfer.amount}
          date={pendingDematTransfer.date}
          onConfirm={handleConfirmDematTarget}
          onClose={handleSkipDematTarget}
        />
      )}

      {/* Reminder sheet — opens from the "Set reminder" action row above. */}
      {expense && (
        <RecurringRuleSheet
          visible={recurringSheetVisible}
          defaultStartDate={expense.date}
          onConfirm={handleCreateRecurring}
          onClose={() => setRecurringSheetVisible(false)}
        />
      )}

      {/* v15.12.0: Hisaab settlement person picker. */}
      {expense && (
        <HisaabSettlementPickerSheet
          visible={hisaabSettlementSheetVisible}
          creditAmount={expense.amount}
          onPick={handleHisaabSettlementPersonSelected}
          onClose={() => setHisaabSettlementSheetVisible(false)}
        />
      )}

      {/* Tag as Refund — expense picker for existing credits. */}
      {expense && (
        <RefundExpensePickerSheet
          visible={refundExpensePickerVisible}
          creditAmount={expense.amount}
          onPick={handleLinkAsRefund}
          onClose={() => setRefundExpensePickerVisible(false)}
        />
      )}

      {/* v17.0.0: Investment Bucket picker. */}
      {expense && V15_FLAGS.v17_expense_investment_link && (
        <InvestmentBucketPickerSheet
          visible={investmentSheetVisible}
          expenseAmount={expense.amount}
          onPick={handleInvestmentBucketSelected}
          onClose={() => setInvestmentSheetVisible(false)}
        />
      )}

      {/* v17.4.0: Loan payment picker (EMI or prepayment). */}
      {expense && V15_FLAGS.v17_loans_v1 && (
        <LoanPaymentPickerSheet
          visible={loanSheetVisible}
          expenseAmount={expense.amount}
          expenseDate={expense.date}
          onSubmit={handleLoanPaymentSubmit}
          onClose={() => setLoanSheetVisible(false)}
        />
      )}

      {/* Refund target picker — same account or a different one. */}
      {expense && (
        <RefundTargetSheet
          visible={refundTargetSheetVisible}
          sourceAccountId={expense.account_id}
          onPick={(accountId) => {
            setRefundTargetSheetVisible(false);
            router.push({
              pathname: "/expense/add",
              params: {
                type: "refund",
                linkExpenseId: expense.id,
                ...(accountId ? { refundAccountId: accountId } : {}),
              },
            });
          }}
          onClose={() => setRefundTargetSheetVisible(false)}
        />
      )}

      {/* Rule picker sheet */}
      <Modal
        transparent
        animationType="slide"
        visible={rulePickerVisible}
        onRequestClose={() => setRulePickerVisible(false)}
      >
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={() => setRulePickerVisible(false)} />
        <View
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0,
            backgroundColor: colors.surface,
            borderTopLeftRadius: 20, borderTopRightRadius: 20,
            maxHeight: "70%", paddingBottom: 28,
          }}
        >
          <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 4 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>Apply rule</Text>
            <Pressable onPress={() => setRulePickerVisible(false)} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          {availableRules.length === 0 ? (
            <View style={{ alignItems: "center", padding: 32 }}>
              <Text style={{ fontSize: 14, color: colors.textSecondary }}>No active rules found.</Text>
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {availableRules.map((rule) => (
                <Pressable
                  key={rule.id}
                  onPress={() => handleApplyRule(rule)}
                  disabled={applyingRuleId === rule.id}
                  style={{
                    flexDirection: "row", alignItems: "center",
                    paddingHorizontal: 20, paddingVertical: 14,
                    opacity: applyingRuleId === rule.id ? 0.5 : 1,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Apply rule: ${rule.name}`}
                >
                  <View
                    style={{
                      width: 36, height: 36, borderRadius: 18,
                      backgroundColor: theme.alpha("primary", 0.09),
                      alignItems: "center", justifyContent: "center", marginRight: 12,
                    }}
                  >
                    <Ionicons name="flash-outline" size={17} color={theme.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>{rule.name}</Text>
                    <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                      {rule.actions.map((a) => a.type.replace(/_/g, " ")).join(" · ")}
                    </Text>
                  </View>
                  {applyingRuleId === rule.id ? (
                    <Text style={{ fontSize: 12, color: colors.textSecondary }}>Applying…</Text>
                  ) : (
                    <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>

    </ScreenContainer>
  );
}
