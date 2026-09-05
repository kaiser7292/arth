import { useState, useCallback, useEffect, useMemo } from "react";
import { View, Pressable, FlatList, ActivityIndicator, ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Text } from "@/components/ui";
import { ExpenseListItem } from "@/components/expense/ExpenseListItem";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { ac } from "@/utils/accent";
import { formatAmount } from "@/utils/format";
import { logger } from "@/utils/logger";
import { getErrorMessage } from "@/utils/error-message";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getDeletedExpenses, getRejectedExpenses,
  restoreExpense, permanentlyDeleteExpense, purgeOldDeletedExpenses,
  restoreAllDeletedExpenses, approveAllRejectedExpenses, deleteAllRejectedExpenses,
  approveExpense, deleteExpense,
} from "@/services/expense";
import type { Expense } from "@/services/expense";
import { getCategories, getInactiveCategories, restoreCategory, hardDeleteCategory, restoreAllCategories, purgeAllInactiveCategories } from "@/services/category";
import type { Category } from "@/services/category";
import { getPaymentModes, getInactivePaymentModes, restorePaymentMode, hardDeletePaymentMode, restoreAllPaymentModes, purgeAllInactivePaymentModes } from "@/services/payment-mode";
import type { PaymentMode } from "@/services/payment-mode";
import { getActiveAccounts, getInactiveAccounts, restoreAccount, hardDeleteAccount, restoreAllAccounts, purgeAllInactiveAccounts } from "@/services/financial-account";
import type { FinancialAccount } from "@/services/financial-account";
import { getInactivePersons, restorePerson, hardDeletePerson, restoreAllPersons, purgeAllInactivePersons } from "@/services/hisaab";
import type { HisaabPerson } from "@/services/hisaab";
import { getDeletedCredits, restoreCredit, hardDeleteCredit, restoreAllCredits, purgeAllDeletedCredits } from "@/services/account-credit";
import type { AccountCredit } from "@/services/account-credit";
import { getDismissedRecurring, restoreRecurring, hardDeleteRecurring, restoreAllRecurring, purgeAllDismissedRecurring } from "@/services/recurring-detector";
import type { RecurringTransaction } from "@/services/recurring-detector";
import { getAllSmsRecords, deleteSmsRecord, deleteAllSmsRecords, getSmsLinkedExpenseInfo } from "@/services/sms";
import { getDeletedVaultEntries, restoreVaultEntry, restoreAllVaultEntries, hardDeleteVaultEntry, purgeAllDeletedVaultEntries } from "@/services/vault";
import type { VaultEntry } from "@/services/vault";
import { listDeletedRules, restoreRule, restoreAllRules, hardDeleteRule, purgeDeletedRules } from "@/services/smart-rules";
import type { SmartRule } from "@/services/smart-rules";
import { getDeletedUserTemplates, restoreUserTemplate, restoreAllUserTemplates, hardDeleteUserTemplate, purgeDeletedUserTemplates } from "@/services/sms/user-sms-templates";
import type { UserSmsTemplate } from "@/services/sms/user-sms-templates";

type SectionFilter = "deleted" | "rejected" | "categories" | "payment_modes" | "accounts" | "hisaab" | "credits" | "recurring" | "sms" | "vault" | "smart_rules" | "sms_templates";

interface SmsRecord {
  id: string; sms_id: string; address: string; body: string;
  sms_date: number; status: string; expense_id: string | null; created_at: string;
}

const FILTER_OPTIONS: { key: SectionFilter; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "deleted", label: "Expenses", icon: "receipt-outline" },
  { key: "rejected", label: "Rejected", icon: "close-circle-outline" },
  { key: "categories", label: "Categories", icon: "pricetags-outline" },
  { key: "payment_modes", label: "Pay Modes", icon: "card-outline" },
  { key: "accounts", label: "Accounts", icon: "business-outline" },
  { key: "hisaab", label: "Hisaab", icon: "people-outline" },
  { key: "credits", label: "Credits", icon: "arrow-down-outline" },
  { key: "recurring", label: "Patterns", icon: "repeat-outline" },
  { key: "sms", label: "SMS", icon: "chatbox-outline" },
  { key: "vault", label: "Vault", icon: "lock-closed-outline" },
  { key: "smart_rules", label: "Rules", icon: "flash-outline" },
  { key: "sms_templates", label: "Templates", icon: "code-slash-outline" },
];

function daysAgo(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

function formatSmsDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.substring(0, max) + "\u2026" : text;
}

function getSmsStatusStyle(cs: "light" | "dark"): Record<string, { label: string; color: string }> {
  const sc = StatusColors[cs];
  return {
    pending: { label: "PENDING", color: sc.warning },
    processed: { label: "PROCESSED", color: sc.success },
    ignored: { label: "IGNORED", color: sc.muted },
    failed: { label: "FAILED", color: sc.danger },
  };
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  savings: "Savings", credit_card: "Credit Card", loan: "Loan", wallet: "Wallet", demat: "Demat", pension: "Pension",
};

const FREQ_LABELS: Record<string, string> = {
  weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly",
};

export default function RecycleBinScreen() {
  const alert = useAlert();
  const router = useRouter();
  const { colors, accent, colorScheme } = useColorScheme();
  const [activeFilter, setActiveFilter] = useState<SectionFilter>("deleted");
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);

  // Data state
  const [deletedExpenses, setDeletedExpenses] = useState<Expense[]>([]);
  const [rejectedExpenses, setRejectedExpenses] = useState<Expense[]>([]);
  const [inactiveCategories, setInactiveCategories] = useState<Category[]>([]);
  const [inactivePaymentModes, setInactivePaymentModes] = useState<PaymentMode[]>([]);
  const [inactiveAccounts, setInactiveAccounts] = useState<FinancialAccount[]>([]);
  const [inactivePersons, setInactivePersons] = useState<HisaabPerson[]>([]);
  const [deletedCredits, setDeletedCredits] = useState<AccountCredit[]>([]);
  const [dismissedRecurring, setDismissedRecurring] = useState<RecurringTransaction[]>([]);
  const [smsRecords, setSmsRecords] = useState<SmsRecord[]>([]);
  const [deletedVaultEntries, setDeletedVaultEntries] = useState<VaultEntry[]>([]);
  const [deletedSmartRules, setDeletedSmartRules] = useState<SmartRule[]>([]);
  const [deletedSmsTemplates, setDeletedSmsTemplates] = useState<UserSmsTemplate[]>([]);

  // Reference data for expense list items
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [cats, pms, accts] = await Promise.all([
          getCategories(DEFAULT_USER_ID),
          getPaymentModes(DEFAULT_USER_ID),
          getActiveAccounts(DEFAULT_USER_ID),
        ]);
        setCategories(cats);
        setPaymentModes(pms);
        setAccounts(accts);
      } catch { /* DB not ready */ }
    })();
  }, []);

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const paymentModeMap = useMemo(() => new Map(paymentModes.map((p) => [p.id, p])), [paymentModes]);
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const loadData = useCallback(async () => {
    try {
      const [deleted, rejected, cats, pms, accts, persons, credits, recurring, sms, vault, rules, templates] = await Promise.all([
        getDeletedExpenses(DEFAULT_USER_ID),
        getRejectedExpenses(DEFAULT_USER_ID),
        getInactiveCategories(DEFAULT_USER_ID),
        getInactivePaymentModes(DEFAULT_USER_ID),
        getInactiveAccounts(DEFAULT_USER_ID),
        getInactivePersons(DEFAULT_USER_ID),
        getDeletedCredits(DEFAULT_USER_ID),
        getDismissedRecurring(DEFAULT_USER_ID),
        getAllSmsRecords(DEFAULT_USER_ID),
        getDeletedVaultEntries(),
        listDeletedRules(),
        getDeletedUserTemplates(),
      ]);
      setDeletedExpenses(deleted);
      setRejectedExpenses(rejected);
      setInactiveCategories(cats);
      setInactivePaymentModes(pms);
      setInactiveAccounts(accts);
      setInactivePersons(persons);
      setDeletedCredits(credits);
      setDismissedRecurring(recurring);
      setSmsRecords(sms);
      setDeletedVaultEntries(vault);
      setDeletedSmartRules(rules);
      setDeletedSmsTemplates(templates);
    } catch (e) {
      logger.error("Load recycle bin data failed:", e);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); loadData(); }, [loadData]));

  const counts: Record<SectionFilter, number> = {
    deleted: deletedExpenses.length, rejected: rejectedExpenses.length,
    categories: inactiveCategories.length, payment_modes: inactivePaymentModes.length,
    accounts: inactiveAccounts.length, hisaab: inactivePersons.length,
    credits: deletedCredits.length, recurring: dismissedRecurring.length,
    sms: smsRecords.length,
    vault: deletedVaultEntries.length, smart_rules: deletedSmartRules.length,
    sms_templates: deletedSmsTemplates.length,
  };

  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);

  // ═══════════════════════════════════════
  // Generic confirm helper
  // ═══════════════════════════════════════
  const confirm = useCallback(
    (title: string, msg: string, actionLabel: string, destructive: boolean, action: () => Promise<void>) => {
      alert(title, msg, [
        { text: "Cancel", style: "cancel" },
        {
          text: actionLabel, style: destructive ? "destructive" : "default",
          onPress: async () => {
            setPurging(true);
            try { await action(); } catch (e) { alert("Something went wrong", getErrorMessage(e)); }
            setPurging(false);
          },
        },
      ]);
    },
    [],
  );

  // ═══════════════════════════════════════
  // Generic row component for simple entities
  // ═══════════════════════════════════════
  const SimpleRow = useCallback(
    ({ icon, title, subtitle, onRestore, onDelete }: {
      icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string;
      onRestore: () => void; onDelete: () => void;
    }) => (
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Ionicons name={icon} size={18} color={colors.textSecondary} />
        <View className="flex-1 ml-3">
          <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Pressable onPress={onRestore} className="w-9 h-9 rounded-full bg-success/8 items-center justify-center mr-2">
          <Ionicons name="refresh-outline" size={16} color={StatusColors[colorScheme].success} />
        </Pressable>
        <Pressable onPress={onDelete} className="w-9 h-9 rounded-full bg-danger/8 items-center justify-center">
          <Ionicons name="close-outline" size={16} color={StatusColors[colorScheme].danger} />
        </Pressable>
      </View>
    ),
    [colors, colorScheme],
  );

  // ═══════════════════════════════════════
  // Bulk action bar component
  // ═══════════════════════════════════════
  const BulkBar = useCallback(
    ({ count, label, onRestoreAll, onPurgeAll, restoreLabel, purgeLabel }: {
      count: number; label: string;
      onRestoreAll?: () => void; onPurgeAll: () => void;
      restoreLabel?: string; purgeLabel?: string;
    }) => {
      if (count === 0) return null;
      return (
        <View className="flex-row items-center justify-between px-4 py-2.5 border-b border-border">
          <Text className="text-sm text-muted-foreground flex-1 mr-2">
            {count} {label}
          </Text>
          <View className="flex-row items-center">
            {onRestoreAll && (
              <Pressable onPress={onRestoreAll} disabled={purging}
                className="flex-row items-center py-1.5 px-3 rounded-lg bg-success/8 mr-2">
                <Ionicons name="refresh-outline" size={14} color={StatusColors[colorScheme].success} />
                <Text className="text-xs font-medium ml-1" style={{ color: StatusColors[colorScheme].success }}>
                  {restoreLabel ?? "Restore All"}
                </Text>
              </Pressable>
            )}
            <Pressable onPress={onPurgeAll} disabled={purging}
              className="flex-row items-center py-1.5 px-3 rounded-lg bg-danger/8">
              {purging ? <ActivityIndicator size="small" color={StatusColors[colorScheme].danger} /> : (
                <>
                  <Ionicons name="trash-outline" size={14} color={StatusColors[colorScheme].danger} />
                  <Text className="text-xs font-medium text-danger ml-1">{purgeLabel ?? "Delete All"}</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      );
    },
    [purging, colorScheme],
  );

  // ═══════════════════════════════════════
  // Render items per section
  // ═══════════════════════════════════════

  const renderDeletedItem = useCallback(({ item }: { item: Expense }) => (
    <ExpenseListItem
      expense={item}
      category={item.category_id ? categoryMap.get(item.category_id) : undefined}
      paymentMode={item.payment_mode_id ? paymentModeMap.get(item.payment_mode_id) : undefined}
      account={item.account_id ? accountMap.get(item.account_id) : undefined}
      onPress={() => router.push(`/expense/${item.id}`)}
      rightElement={
        <View className="flex-row items-center ml-2">
          {item.deleted_at && <Text className="text-label text-faint-foreground mr-2">{daysAgo(item.deleted_at)}</Text>}
          <Pressable onPress={() => confirm("Restore", `Restore "${item.description || "Expense"}"?`, "Restore", false, async () => {
            await restoreExpense(item.id); setDeletedExpenses((p) => p.filter((e) => e.id !== item.id));
          })} className="w-9 h-9 rounded-full bg-success/8 items-center justify-center mr-2">
            <Ionicons name="refresh-outline" size={18} color={StatusColors[colorScheme].success} />
          </Pressable>
          <Pressable onPress={() => confirm("Delete Forever", `Permanently delete "${item.description || "Expense"}"? Cannot be undone.`, "Delete", true, async () => {
            await permanentlyDeleteExpense(item.id); setDeletedExpenses((p) => p.filter((e) => e.id !== item.id));
          })} className="w-9 h-9 rounded-full bg-danger/8 items-center justify-center">
            <Ionicons name="close-outline" size={18} color={StatusColors[colorScheme].danger} />
          </Pressable>
        </View>
      }
    />
  ), [categoryMap, paymentModeMap, accountMap, colorScheme, router, confirm]);

  const renderRejectedItem = useCallback(({ item }: { item: Expense }) => (
    <ExpenseListItem
      expense={item}
      category={item.category_id ? categoryMap.get(item.category_id) : undefined}
      paymentMode={item.payment_mode_id ? paymentModeMap.get(item.payment_mode_id) : undefined}
      account={item.account_id ? accountMap.get(item.account_id) : undefined}
      onPress={() => router.push(`/expense/${item.id}`)}
      rightElement={
        <View className="flex-row items-center ml-2">
          <View className="px-1.5 py-0.5 rounded mr-2 bg-[#EF444414]">
            <Text className="text-label font-semibold" style={{ color: StatusColors[colorScheme].danger }}>REJECTED</Text>
          </View>
          <Pressable onPress={() => confirm("Re-approve", `Approve "${item.description || item.merchant_name || "Expense"}"?`, "Approve", false, async () => {
            await approveExpense(item.id); setRejectedExpenses((p) => p.filter((e) => e.id !== item.id));
          })} className="w-9 h-9 rounded-full bg-success/8 items-center justify-center mr-2">
            <Ionicons name="checkmark" size={18} color={StatusColors[colorScheme].success} />
          </Pressable>
          <Pressable onPress={() => confirm("Delete", `Move to recycle bin?`, "Delete", true, async () => {
            await deleteExpense(item.id); setRejectedExpenses((p) => p.filter((e) => e.id !== item.id)); loadData();
          })} className="w-9 h-9 rounded-full bg-danger/8 items-center justify-center">
            <Ionicons name="trash-outline" size={18} color={StatusColors[colorScheme].danger} />
          </Pressable>
        </View>
      }
    />
  ), [categoryMap, paymentModeMap, accountMap, colorScheme, router, confirm, loadData]);

  const renderCategoryItem = useCallback(({ item }: { item: Category }) => (
    <SimpleRow
      icon={(item.icon as keyof typeof Ionicons.glyphMap) ?? "ellipsis-horizontal-circle-outline"}
      title={item.name}
      subtitle={item.is_unavoidable ? "Unavoidable" : "Discretionary"}
      onRestore={() => confirm("Restore Category", `Restore "${item.name}"?`, "Restore", false, async () => {
        await restoreCategory(item.id); setInactiveCategories((p) => p.filter((c) => c.id !== item.id));
      })}
      onDelete={() => confirm("Delete Forever", `Permanently delete "${item.name}"? Linked budgets/baselines will also be removed.`, "Delete", true, async () => {
        const ok = await hardDeleteCategory(item.id);
        if (!ok) { alert("Cannot Delete", "This category still has linked expenses. Delete or reassign them first."); return; }
        setInactiveCategories((p) => p.filter((c) => c.id !== item.id));
      })}
    />
  ), [SimpleRow, confirm]);

  const renderPaymentModeItem = useCallback(({ item }: { item: PaymentMode }) => (
    <SimpleRow
      icon="card-outline"
      title={item.name}
      subtitle={item.type.replace("_", " ")}
      onRestore={() => confirm("Restore Payment Mode", `Restore "${item.name}"?`, "Restore", false, async () => {
        await restorePaymentMode(item.id); setInactivePaymentModes((p) => p.filter((pm) => pm.id !== item.id));
      })}
      onDelete={() => confirm("Delete Forever", `Permanently delete "${item.name}"?`, "Delete", true, async () => {
        const ok = await hardDeletePaymentMode(item.id);
        if (!ok) { alert("Cannot Delete", "This payment mode still has linked expenses."); return; }
        setInactivePaymentModes((p) => p.filter((pm) => pm.id !== item.id));
      })}
    />
  ), [SimpleRow, confirm]);

  const renderAccountItem = useCallback(({ item }: { item: FinancialAccount }) => (
    <SimpleRow
      icon="business-outline"
      title={item.account_label || `${item.bank_name} ****${item.account_identifier}`}
      subtitle={ACCOUNT_TYPE_LABELS[item.account_type] ?? item.account_type}
      onRestore={() => confirm("Restore Account", `Restore "${item.account_label || item.bank_name}"?`, "Restore", false, async () => {
        await restoreAccount(item.id); setInactiveAccounts((p) => p.filter((a) => a.id !== item.id));
      })}
      onDelete={() => confirm("Delete Forever", `Permanently delete this account and all its balances/credits?`, "Delete", true, async () => {
        await hardDeleteAccount(item.id); setInactiveAccounts((p) => p.filter((a) => a.id !== item.id));
      })}
    />
  ), [SimpleRow, confirm]);

  const renderPersonItem = useCallback(({ item }: { item: HisaabPerson }) => (
    <SimpleRow
      icon="person-outline"
      title={item.name}
      subtitle={item.phone ?? item.email ?? undefined}
      onRestore={() => confirm("Restore Person", `Restore "${item.name}"?`, "Restore", false, async () => {
        await restorePerson(item.id); setInactivePersons((p) => p.filter((pr) => pr.id !== item.id));
      })}
      onDelete={() => confirm("Delete Forever", `Permanently delete "${item.name}" and all their ledger entries?`, "Delete", true, async () => {
        await hardDeletePerson(item.id); setInactivePersons((p) => p.filter((pr) => pr.id !== item.id));
      })}
    />
  ), [SimpleRow, confirm]);

  const renderCreditItem = useCallback(({ item }: { item: AccountCredit }) => (
    <SimpleRow
      icon="arrow-down-outline"
      title={`${formatAmount(item.amount)} - ${item.description ?? "Credit"}`}
      subtitle={`${item.date} · ${item.source === "sms_auto" ? "Auto" : "Manual"}`}
      onRestore={() => confirm("Restore Credit", `Restore this ${formatAmount(item.amount)} credit?`, "Restore", false, async () => {
        await restoreCredit(item.id); setDeletedCredits((p) => p.filter((c) => c.id !== item.id));
      })}
      onDelete={() => confirm("Delete Forever", `Permanently delete this credit entry?`, "Delete", true, async () => {
        await hardDeleteCredit(item.id); setDeletedCredits((p) => p.filter((c) => c.id !== item.id));
      })}
    />
  ), [SimpleRow, confirm]);

  const VAULT_CATEGORY_LABELS: Record<string, string> = {
    banking: "Banking / Card", demat: "Demat / Trading",
    subscription: "Subscription", social: "Social / App", statement_pwd: "Statement Password",
  };

  const TX_TYPE_LABELS: Record<string, string> = {
    debit: "Debit", credit: "Credit", balance: "Balance",
  };

  const renderVaultItem = useCallback(({ item }: { item: VaultEntry }) => (
    <SimpleRow
      icon="lock-closed-outline"
      title={item.title}
      subtitle={VAULT_CATEGORY_LABELS[item.category] ?? item.category}
      onRestore={() => confirm("Restore Vault Entry", `Restore "${item.title}"?`, "Restore", false, async () => {
        await restoreVaultEntry(item.id); setDeletedVaultEntries((p) => p.filter((v) => v.id !== item.id));
      })}
      onDelete={() => confirm("Delete Forever", `Permanently delete "${item.title}"? All saved credentials will be erased.`, "Delete", true, async () => {
        await hardDeleteVaultEntry(item.id); setDeletedVaultEntries((p) => p.filter((v) => v.id !== item.id));
      })}
    />
  ), [SimpleRow, confirm]);

  const renderSmartRuleItem = useCallback(({ item }: { item: SmartRule }) => (
    <SimpleRow
      icon="flash-outline"
      title={item.name}
      subtitle={`${item.apply_count}x applied · ${item.conditions.length} condition${item.conditions.length !== 1 ? "s" : ""}`}
      onRestore={() => confirm("Restore Rule", `Restore "${item.name}"? It will become active again.`, "Restore", false, async () => {
        await restoreRule(item.id); setDeletedSmartRules((p) => p.filter((r) => r.id !== item.id));
      })}
      onDelete={() => confirm("Delete Forever", `Permanently delete rule "${item.name}"?`, "Delete", true, async () => {
        await hardDeleteRule(item.id); setDeletedSmartRules((p) => p.filter((r) => r.id !== item.id));
      })}
    />
  ), [SimpleRow, confirm]);

  const renderSmsTemplateItem = useCallback(({ item }: { item: UserSmsTemplate }) => (
    <SimpleRow
      icon="code-slash-outline"
      title={item.bank_name}
      subtitle={TX_TYPE_LABELS[item.tx_type] ?? item.tx_type}
      onRestore={() => confirm("Restore Template", `Restore SMS template for "${item.bank_name}"?`, "Restore", false, async () => {
        await restoreUserTemplate(item.id); setDeletedSmsTemplates((p) => p.filter((t) => t.id !== item.id));
      })}
      onDelete={() => confirm("Delete Forever", `Permanently delete this SMS template for "${item.bank_name}"?`, "Delete", true, async () => {
        await hardDeleteUserTemplate(item.id); setDeletedSmsTemplates((p) => p.filter((t) => t.id !== item.id));
      })}
    />
  ), [SimpleRow, confirm]);

  const renderRecurringItem = useCallback(({ item }: { item: RecurringTransaction }) => (
    <SimpleRow
      icon="repeat-outline"
      title={item.merchant_normalized}
      subtitle={`${formatAmount(item.amount)} · ${FREQ_LABELS[item.frequency] ?? item.frequency} · ${item.occurrence_count}x`}
      onRestore={() => confirm("Restore Pattern", `Restore "${item.merchant_normalized}"?`, "Restore", false, async () => {
        await restoreRecurring(item.id); setDismissedRecurring((p) => p.filter((r) => r.id !== item.id));
      })}
      onDelete={() => confirm("Delete Forever", `Permanently delete this detected pattern?`, "Delete", true, async () => {
        await hardDeleteRecurring(item.id); setDismissedRecurring((p) => p.filter((r) => r.id !== item.id));
      })}
    />
  ), [SimpleRow, confirm]);

  const renderSmsItem = useCallback(({ item }: { item: SmsRecord }) => {
    const smsStyles = getSmsStatusStyle(colorScheme);
    const style = smsStyles[item.status] ?? smsStyles.pending;
    return (
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <View className="flex-1">
          <View className="flex-row items-center mb-1">
            <Ionicons name="chatbox-outline" size={14} color={colors.textSecondary} />
            <Text className="text-xs font-semibold text-foreground ml-1.5 flex-1 mr-2" numberOfLines={1}>
              {item.address}
            </Text>
            <View className="px-1.5 py-0.5 rounded mr-2" style={{ backgroundColor: style.color + "14" }}>
              <Text className="text-label font-semibold" style={{ color: style.color }}>{style.label}</Text>
            </View>
            <Text className="text-label text-faint-foreground">{formatSmsDate(item.sms_date)}</Text>
          </View>
          <Text className="text-xs text-muted-foreground" numberOfLines={2}>
            {truncate(item.body, 150)}
          </Text>
        </View>
        <Pressable onPress={async () => {
          let message = "Remove this record? It will be re-detected on next scan.";
          if (item.expense_id) {
            try {
              const info = await getSmsLinkedExpenseInfo(item.id);
              if (info) {
                const kind = info.nature === "credit" ? "credit" : "expense";
                const acct = info.accountLabel ? ` in ${info.accountLabel}` : "";
                message = `The linked ${kind} entry (${formatAmount(info.amount)}${acct}) will also be permanently deleted. This cannot be undone.`;
              }
            } catch { /* fall back to generic message */ }
          }
          confirm("Delete SMS Record", message, "Delete", true, async () => {
            await deleteSmsRecord(item.id); setSmsRecords((p) => p.filter((r) => r.id !== item.id)); loadData();
          });
        }} className="w-9 h-9 rounded-full bg-danger/8 items-center justify-center ml-3">
          <Ionicons name="trash-outline" size={16} color={StatusColors[colorScheme].danger} />
        </Pressable>
      </View>
    );
  }, [colors, colorScheme, confirm, loadData]);

  // ═══════════════════════════════════════
  // Section config map
  // ═══════════════════════════════════════

  const sectionConfig: Record<SectionFilter, {
    data: any[]; renderItem: any; emptyTitle: string; emptySubtitle: string; emptyIcon: keyof typeof Ionicons.glyphMap;
  }> = useMemo(() => ({
    deleted: { data: deletedExpenses, renderItem: renderDeletedItem, emptyTitle: "No Deleted Expenses", emptySubtitle: "Deleted expenses will appear here for permanent removal or restoration.", emptyIcon: "trash-bin-outline" },
    rejected: { data: rejectedExpenses, renderItem: renderRejectedItem, emptyTitle: "No Rejected Expenses", emptySubtitle: "Rejected expenses from the review queue will appear here.", emptyIcon: "close-circle-outline" },
    categories: { data: inactiveCategories, renderItem: renderCategoryItem, emptyTitle: "No Deleted Categories", emptySubtitle: "Deactivated categories will appear here.", emptyIcon: "pricetags-outline" },
    payment_modes: { data: inactivePaymentModes, renderItem: renderPaymentModeItem, emptyTitle: "No Deleted Payment Modes", emptySubtitle: "Deactivated payment modes will appear here.", emptyIcon: "card-outline" },
    accounts: { data: inactiveAccounts, renderItem: renderAccountItem, emptyTitle: "No Deleted Accounts", emptySubtitle: "Deactivated financial accounts will appear here.", emptyIcon: "business-outline" },
    hisaab: { data: inactivePersons, renderItem: renderPersonItem, emptyTitle: "No Deleted Persons", emptySubtitle: "Deactivated hisaab persons will appear here.", emptyIcon: "people-outline" },
    credits: { data: deletedCredits, renderItem: renderCreditItem, emptyTitle: "No Deleted Credits", emptySubtitle: "Deleted credit entries will appear here.", emptyIcon: "arrow-down-outline" },
    recurring: { data: dismissedRecurring, renderItem: renderRecurringItem, emptyTitle: "No Dismissed Patterns", emptySubtitle: "Dismissed recurring transaction patterns will appear here.", emptyIcon: "repeat-outline" },
    sms: { data: smsRecords, renderItem: renderSmsItem, emptyTitle: "No SMS Records", emptySubtitle: "SMS records from scans will appear here.", emptyIcon: "chatbox-outline" },
    vault: { data: deletedVaultEntries, renderItem: renderVaultItem, emptyTitle: "No Deleted Vault Entries", emptySubtitle: "Deleted vault entries appear here. Restore to recover saved credentials.", emptyIcon: "lock-closed-outline" },
    smart_rules: { data: deletedSmartRules, renderItem: renderSmartRuleItem, emptyTitle: "No Deleted Rules", emptySubtitle: "Deleted smart auto-categorization rules will appear here.", emptyIcon: "flash-outline" },
    sms_templates: { data: deletedSmsTemplates, renderItem: renderSmsTemplateItem, emptyTitle: "No Deleted Templates", emptySubtitle: "Deleted SMS parsing templates will appear here.", emptyIcon: "code-slash-outline" },
  }), [deletedExpenses, rejectedExpenses, inactiveCategories, inactivePaymentModes, inactiveAccounts, inactivePersons, deletedCredits, dismissedRecurring, smsRecords, deletedVaultEntries, deletedSmartRules, deletedSmsTemplates, renderDeletedItem, renderRejectedItem, renderCategoryItem, renderPaymentModeItem, renderAccountItem, renderPersonItem, renderCreditItem, renderRecurringItem, renderSmsItem, renderVaultItem, renderSmartRuleItem, renderSmsTemplateItem]);

  if (loading) {
    return <ScreenContainer padTop={false} centered><ActivityIndicator size="large" color={colors.blue} /></ScreenContainer>;
  }

  const section = sectionConfig[activeFilter];

  return (
    <ScreenContainer padTop={false}>
      {/* Total summary */}
      {totalCount > 0 && (
        <View className="px-4 py-2 border-b border-border">
          <Text className="text-xs text-faint-foreground">
            {totalCount} item{totalCount !== 1 ? "s" : ""} across all sections
          </Text>
        </View>
      )}

      {/* Filter chips */}
      <View className="border-b border-border">
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
          {FILTER_OPTIONS.map((opt) => {
            const isActive = activeFilter === opt.key;
            const count = counts[opt.key];
            return (
              <Pressable key={opt.key} onPress={() => setActiveFilter(opt.key)}
                className={`flex-row items-center px-3 py-1.5 rounded-full ${isActive ? "border" : "bg-card"}`}
                style={isActive ? { backgroundColor: ac(accent, colorScheme, 100, 700), borderColor: accent[500] } : undefined}>
                <Ionicons name={opt.icon} size={14}
                  color={isActive ? ac(accent, colorScheme, 500, 200) : colors.textSecondary}
                  style={{ marginRight: 4 }} />
                <Text className={`text-xs ${isActive ? "font-semibold" : "text-muted-foreground"}`}
                  style={isActive ? { color: ac(accent, colorScheme, 500, 200) } : undefined}>
                  {opt.label}
                </Text>
                {count > 0 && (
                  <View className="ml-1.5 px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: isActive ? accent[500] + "20" : "#6B728014" }}>
                    <Text className="text-label font-bold"
                      style={{ color: isActive ? ac(accent, colorScheme, 500, 200) : "#6B7280" }}>
                      {count}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Bulk action bar per section */}
      {activeFilter === "deleted" && <BulkBar count={deletedExpenses.length} label={`deleted expense${deletedExpenses.length !== 1 ? "s" : ""}`}
        onRestoreAll={() => confirm("Restore All", `Restore all ${deletedExpenses.length} expenses?`, "Restore All", false, async () => { await restoreAllDeletedExpenses(DEFAULT_USER_ID); setDeletedExpenses([]); })}
        onPurgeAll={() => confirm("Empty All", `Permanently delete all ${deletedExpenses.length} expenses? Cannot be undone.`, "Delete All", true, async () => { await purgeOldDeletedExpenses(DEFAULT_USER_ID, 0); setDeletedExpenses([]); })}
        purgeLabel="Empty All" />}

      {activeFilter === "rejected" && <BulkBar count={rejectedExpenses.length} label={`rejected expense${rejectedExpenses.length !== 1 ? "s" : ""}`}
        restoreLabel="Approve All"
        onRestoreAll={() => confirm("Approve All", `Re-approve all ${rejectedExpenses.length} expenses?`, "Approve All", false, async () => { await approveAllRejectedExpenses(DEFAULT_USER_ID); setRejectedExpenses([]); })}
        onPurgeAll={() => confirm("Delete All", `Move all rejected to recycle bin?`, "Delete All", true, async () => { await deleteAllRejectedExpenses(DEFAULT_USER_ID); setRejectedExpenses([]); loadData(); })} />}

      {activeFilter === "categories" && <BulkBar count={inactiveCategories.length} label={`deleted categor${inactiveCategories.length !== 1 ? "ies" : "y"}`}
        onRestoreAll={() => confirm("Restore All", `Restore all ${inactiveCategories.length} categories?`, "Restore All", false, async () => { await restoreAllCategories(DEFAULT_USER_ID); setInactiveCategories([]); })}
        onPurgeAll={() => confirm("Purge All", `Permanently delete all inactive categories?`, "Delete All", true, async () => { await purgeAllInactiveCategories(DEFAULT_USER_ID); setInactiveCategories([]); })} />}

      {activeFilter === "payment_modes" && <BulkBar count={inactivePaymentModes.length} label={`deleted payment mode${inactivePaymentModes.length !== 1 ? "s" : ""}`}
        onRestoreAll={() => confirm("Restore All", `Restore all ${inactivePaymentModes.length} payment modes?`, "Restore All", false, async () => { await restoreAllPaymentModes(DEFAULT_USER_ID); setInactivePaymentModes([]); })}
        onPurgeAll={() => confirm("Purge All", `Permanently delete all inactive payment modes?`, "Delete All", true, async () => { await purgeAllInactivePaymentModes(DEFAULT_USER_ID); setInactivePaymentModes([]); })} />}

      {activeFilter === "accounts" && <BulkBar count={inactiveAccounts.length} label={`deleted account${inactiveAccounts.length !== 1 ? "s" : ""}`}
        onRestoreAll={() => confirm("Restore All", `Restore all ${inactiveAccounts.length} accounts?`, "Restore All", false, async () => { await restoreAllAccounts(DEFAULT_USER_ID); setInactiveAccounts([]); })}
        onPurgeAll={() => confirm("Purge All", `Permanently delete all inactive accounts and their data?`, "Delete All", true, async () => { await purgeAllInactiveAccounts(DEFAULT_USER_ID); setInactiveAccounts([]); })} />}

      {activeFilter === "hisaab" && <BulkBar count={inactivePersons.length} label={`deleted person${inactivePersons.length !== 1 ? "s" : ""}`}
        onRestoreAll={() => confirm("Restore All", `Restore all ${inactivePersons.length} persons?`, "Restore All", false, async () => { await restoreAllPersons(DEFAULT_USER_ID); setInactivePersons([]); })}
        onPurgeAll={() => confirm("Purge All", `Permanently delete all inactive persons and their entries?`, "Delete All", true, async () => { await purgeAllInactivePersons(DEFAULT_USER_ID); setInactivePersons([]); })} />}

      {activeFilter === "credits" && <BulkBar count={deletedCredits.length} label={`deleted credit${deletedCredits.length !== 1 ? "s" : ""}`}
        onRestoreAll={() => confirm("Restore All", `Restore all ${deletedCredits.length} credits?`, "Restore All", false, async () => { await restoreAllCredits(DEFAULT_USER_ID); setDeletedCredits([]); })}
        onPurgeAll={() => confirm("Purge All", `Permanently delete all deleted credits?`, "Delete All", true, async () => { await purgeAllDeletedCredits(DEFAULT_USER_ID); setDeletedCredits([]); })} />}

      {activeFilter === "recurring" && <BulkBar count={dismissedRecurring.length} label={`dismissed pattern${dismissedRecurring.length !== 1 ? "s" : ""}`}
        onRestoreAll={() => confirm("Restore All", `Restore all ${dismissedRecurring.length} patterns?`, "Restore All", false, async () => { await restoreAllRecurring(DEFAULT_USER_ID); setDismissedRecurring([]); })}
        onPurgeAll={() => confirm("Purge All", `Permanently delete all dismissed patterns?`, "Delete All", true, async () => { await purgeAllDismissedRecurring(DEFAULT_USER_ID); setDismissedRecurring([]); })} />}

      {activeFilter === "vault" && <BulkBar count={deletedVaultEntries.length} label={`deleted vault entr${deletedVaultEntries.length !== 1 ? "ies" : "y"}`}
        onRestoreAll={() => confirm("Restore All", `Restore all ${deletedVaultEntries.length} vault entries?`, "Restore All", false, async () => { await restoreAllVaultEntries(); setDeletedVaultEntries([]); })}
        onPurgeAll={() => confirm("Purge All", `Permanently delete all vault entries? All saved credentials will be erased.`, "Delete All", true, async () => { await purgeAllDeletedVaultEntries(); setDeletedVaultEntries([]); })} />}

      {activeFilter === "smart_rules" && <BulkBar count={deletedSmartRules.length} label={`deleted rule${deletedSmartRules.length !== 1 ? "s" : ""}`}
        onRestoreAll={() => confirm("Restore All", `Restore all ${deletedSmartRules.length} rules?`, "Restore All", false, async () => { await restoreAllRules(); setDeletedSmartRules([]); })}
        onPurgeAll={() => confirm("Purge All", `Permanently delete all deleted rules?`, "Delete All", true, async () => { await purgeDeletedRules(); setDeletedSmartRules([]); })} />}

      {activeFilter === "sms_templates" && <BulkBar count={deletedSmsTemplates.length} label={`deleted template${deletedSmsTemplates.length !== 1 ? "s" : ""}`}
        onRestoreAll={() => confirm("Restore All", `Restore all ${deletedSmsTemplates.length} SMS templates?`, "Restore All", false, async () => { await restoreAllUserTemplates(); setDeletedSmsTemplates([]); })}
        onPurgeAll={() => confirm("Purge All", `Permanently delete all deleted SMS templates?`, "Delete All", true, async () => { await purgeDeletedUserTemplates(); setDeletedSmsTemplates([]); })} />}

      {activeFilter === "sms" && smsRecords.length > 0 && (
        <View className="flex-row items-center justify-between px-4 py-2.5 border-b border-border">
          <Text className="text-xs text-muted-foreground flex-1 mr-2">
            {smsRecords.filter((s) => s.status === "processed").length} processed
            {" \u00b7 "}{smsRecords.filter((s) => s.status === "ignored").length} ignored
            {" \u00b7 "}{smsRecords.filter((s) => s.status === "pending").length} pending
            {" \u00b7 "}{smsRecords.filter((s) => s.status === "failed").length} failed
          </Text>
          <Pressable onPress={() => {
            const withLinks = smsRecords.filter((s) => s.expense_id).length;
            const msg = withLinks > 0
              ? `Delete all ${smsRecords.length} SMS records? ${withLinks} linked expense/credit entr${withLinks === 1 ? "y" : "ies"} will also be permanently deleted. This cannot be undone.`
              : `Delete all ${smsRecords.length} SMS records?`;
            confirm("Clear All", msg, "Clear All", true, async () => { await deleteAllSmsRecords(DEFAULT_USER_ID); setSmsRecords([]); loadData(); });
          }}
            disabled={purging} className="flex-row items-center py-1.5 px-3 rounded-lg bg-danger/8">
            {purging ? <ActivityIndicator size="small" color={StatusColors[colorScheme].danger} /> : (
              <>
                <Ionicons name="trash-outline" size={14} color={StatusColors[colorScheme].danger} />
                <Text className="text-xs font-medium text-danger ml-1">Clear All</Text>
              </>
            )}
          </Pressable>
        </View>
      )}

      {/* List */}
      {section.data.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name={section.emptyIcon} size={48} color={colors.textSecondary} />
          <Text className="text-lg font-medium text-foreground mt-4">
            {section.emptyTitle}
          </Text>
          <Text className="text-sm text-muted-foreground text-center mt-2">
            {section.emptySubtitle}
          </Text>
        </View>
      ) : (
        <FlatList
          data={section.data}
          keyExtractor={(item: any) => item.id}
          renderItem={section.renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListHeaderComponent={
            (activeFilter === "deleted" || activeFilter === "rejected") && section.data.length > 0 ? (
              <View className="mx-4 my-3 p-4 rounded-xl bg-card">
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Total at Risk
                </Text>
                <Text className="text-xl font-bold text-foreground mt-1">
                  {formatAmount(section.data.reduce((sum: number, e: any) => sum + (e.amount ?? 0), 0))}
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  {section.data.length} {section.data.length === 1 ? "expense" : "expenses"}
                </Text>
              </View>
            ) : null
          }
        />
      )}
    </ScreenContainer>
  );
}
