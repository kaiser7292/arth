import { tint } from "@/constants/brand";
import { QuickAddCategorySheet } from "@/components/expense/QuickAddCategorySheet";
import { CalendarModal } from "@/components/ui/CalendarModal";
import { Pop } from "@/components/motion/Pop";

import { Text } from "@/components/ui";
import { TYPE_ICONS } from "@/constants/icons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAccountBalances } from "@/hooks/use-account-balances";
import { withPickerBalance } from "@/services/account-picker-balance";
import type { Category } from "@/services/category";
import type { FinancialAccount } from "@/services/financial-account";
import type { PaymentMode, PaymentModeType } from "@/services/payment-mode";
import { PAYMENT_MODE_TYPE_LABELS } from "@/services/payment-mode";

import { formatDateForDisplay, formatDateForStorage } from "@/utils/expense-validation";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { Rows } from "@/components/ui/Rows";
import { buildCategoryTree, categoryPath } from "@/utils/category-tree";
import { PickerSheet, type PickerSheetSection } from "./PickerSheet";
import type { MerchantUsage } from "@/services/picker-usage";

// ---------------------------------------------------------------------------
// Searchable Picker List — shared helper for all pickers
// ---------------------------------------------------------------------------

export interface PickerItem {
  id: string;
  label: string;
  subtitle?: string;
  icon?: string;
  color?: string;
}

export function SearchablePickerList({
  items,
  selectedId,
  onSelect,
  allowNone = false,
  searchPlaceholder = "Search...",
}: {
  items: PickerItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  allowNone?: boolean;
  searchPlaceholder?: string;
}) {
  const [query, setQuery] = useState("");
  const { colorScheme } = useColorScheme();
  const theme = useTheme();

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(q) || i.subtitle?.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <Rows className="mt-2 rounded-control border border-border bg-card overflow-hidden">
      {items.length > 5 && (
        <View className="flex-row items-center px-3 py-2 border-b border-border">
          <Ionicons name="search" size={14} color={theme.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={searchPlaceholder}
            placeholderTextColor={theme.faintForeground}
            className="flex-1 ml-2 text-meta text-foreground"
          />
          {query !== "" && (
            <Pressable onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={14} color={theme.mutedForeground} />
            </Pressable>
          )}
        </View>
      )}
      <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
        {allowNone && (
          <Pressable
            onPress={() => onSelect(null)}
            className="flex-row items-center px-4 py-3 border-b border-border"
            style={selectedId === null ? { backgroundColor: theme.alpha("primary", 0.1) } : undefined}
          >
            <Ionicons name="remove-circle-outline" size={18} color={theme.mutedForeground} />
            <Text className="ml-3 text-meta text-faint-foreground">None</Text>
          </Pressable>
        )}
        {filtered.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => onSelect(item.id)}
            className="flex-row items-center px-4 py-3 border-b border-border"
            style={selectedId === item.id ? { backgroundColor: theme.alpha("primary", 0.1) } : undefined}
          >
            {item.color && (
              <View className="w-6 h-6 rounded-full items-center justify-center mr-2" style={{ backgroundColor: tint(item.color, 0.08) }}>
                {item.icon && <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={14} color={item.color} />}
              </View>
            )}
            <View className="flex-1">
              <Text className="text-meta text-foreground">{item.label}</Text>
              {item.subtitle && <Text className="text-label text-muted-foreground">{item.subtitle}</Text>}
            </View>
            {selectedId === item.id && (
              <Pop><Ionicons name="checkmark" size={16} color={theme.primary} /></Pop>
            )}
          </Pressable>
        ))}
        {filtered.length === 0 && query !== "" && (
          <Text className="text-label text-faint-foreground text-center py-4">No matches</Text>
        )}
      </ScrollView>
    </Rows>
  );
}

// ---------------------------------------------------------------------------
// Account Picker
// ---------------------------------------------------------------------------

interface AccountPickerProps {
  accounts: FinancialAccount[];
  accountId: string | null;
  selectedAccount: FinancialAccount | undefined;
  showAccounts: boolean;
  onToggle: () => void;
  onSelect: (acctId: string | null) => void;
  /** Field label — "Paid from", "Into account", "From", "To". Defaults to "Account". */
  label?: string;
  placeholder?: string;
  /** Small note next to the label, e.g. "From merchant". */
  hint?: string | null;
  /** Show as a row of the form's card. */
  row?: boolean;
  divider?: boolean;
}

// Every account type, not just spending ones: the same picker chooses both sides of a transfer.
const PICKER_TYPE_LABEL: Record<string, string> = {
  savings: "Savings",
  bank: "Savings",
  credit_card: "Credit Card",
  wallet: "Wallet",
  loan: "Loan",
  demat: "Demat",
  investment: "Investment",
  pension: "Pension",
};
/** The picker's groups: Savings / Cards / Wallets, then everything else. */
const ACCOUNT_GROUP: Record<string, { key: string; title: string; icon: keyof typeof Ionicons.glyphMap }> = {
  savings: { key: "savings", title: "Savings", icon: "business-outline" },
  bank: { key: "savings", title: "Savings", icon: "business-outline" },
  credit_card: { key: "cards", title: "Cards", icon: "card-outline" },
  wallet: { key: "wallets", title: "Wallets", icon: "phone-portrait-outline" },
};
const OTHER_GROUP = { key: "other", title: "Other accounts", icon: "wallet-outline" as keyof typeof Ionicons.glyphMap };

export function AccountPicker({
  accounts,
  accountId,
  selectedAccount,
  showAccounts,
  onToggle,
  onSelect,
  label = "Account",
  placeholder = "Select account (optional)",
  hint,
  row,
  divider,
}: AccountPickerProps) {
  const theme = useTheme();
  const router = useRouter();
  const balances = useAccountBalances(accounts, showAccounts);

  const sections = useMemo<PickerSheetSection[]>(() => {
    const order = ["savings", "cards", "wallets", "other"];
    const by = new Map<string, PickerSheetSection>();
    for (const acct of accounts) {
      const g = ACCOUNT_GROUP[acct.account_type] ?? OTHER_GROUP;
      if (!by.has(g.key)) by.set(g.key, { key: g.key, title: g.title, items: [] });
      by.get(g.key)!.items.push({
        id: acct.id,
        label: acct.account_label ?? `${acct.bank_name} ····${acct.account_identifier}`,
        sub: withPickerBalance(`${PICKER_TYPE_LABEL[acct.account_type] ?? "Account"} · ${acct.bank_name}`, balances[acct.id]),
        icon: g.icon,
        color: theme.data.accountType[acct.account_type] ?? theme.primary,
      });
    }
    return order.filter((k) => by.has(k)).map((k) => by.get(k)!);
  }, [accounts, balances, theme]);

  return (
    <View className={row ? "" : "mb-4"}>
      {!row && (
        <Text className="text-label font-semibold text-muted-foreground mb-1.5">
          {label}
          {hint ? <Text className="text-label text-primary"> · {hint}</Text> : null}
        </Text>
      )}
      {accounts.length > 0 ? (
        <>
          <FieldButton
            row={row ? { label, color: selectedAccount ? theme.data.accountType[selectedAccount.account_type] ?? theme.primary : theme.primary, tag: hint, divider } : undefined}
            icon="business-outline"
            on={!!selectedAccount}
            text={selectedAccount ? selectedAccount.account_label ?? `${selectedAccount.bank_name} ····${selectedAccount.account_identifier}` : placeholder}
            onPress={onToggle}
            accessibilityLabel={`${label}${selectedAccount ? `, ${selectedAccount.account_label ?? selectedAccount.bank_name}` : ""}`}
          />
          <PickerSheet
            visible={showAccounts}
            onClose={onToggle}
            title={label}
            sections={sections}
            selectedId={accountId}
            onSelect={(id) => onSelect(id)}
            allowNone
            noneLabel="No account"
            searchPlaceholder="Search accounts"
            filters={sections.length > 1 ? sections.map((s) => ({ key: s.key, label: s.title ?? s.key })) : undefined}
            onAdd={() => {
              onToggle();
              router.push("/settings/account-add");
            }}
            addLabel={(t) => `Add an account “${t}”`}
            noun={{ one: "account", many: "accounts" }}
          />
        </>
      ) : (
        <Pressable
          onPress={() => router.push("/settings/account-add")}
          className="flex-row items-center rounded-control border border-dashed border-border bg-card px-4 py-3"
        >
          <Ionicons name="add-circle-outline" size={18} color={theme.mutedForeground} />
          <Text className="flex-1 ml-3 text-meta text-faint-foreground">No accounts yet - tap to add one</Text>
          <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
        </Pressable>
      )}
    </View>
  );
}

/** Shown as one row of the form's card: an icon square, the label over the value, a tag, a chevron. */
export interface FieldRowLook {
  label: string;
  /** The icon square's colour (hex). */
  color: string;
  /** "From merchant" and the like. */
  tag?: string | null;
  divider?: boolean;
}

/** The closed field: what's picked (or the placeholder) and a chevron. Tapping opens the sheet. */
export function FieldButton({
  icon,
  on,
  text,
  onPress,
  accessibilityLabel,
  leading,
  right,
  row,
  trailing,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  on: boolean;
  text: string;
  onPress: () => void;
  accessibilityLabel: string;
  leading?: React.ReactNode;
  right?: string;
  /** Render as a row of the form's card instead of a bordered box. */
  row?: FieldRowLook;
  /** Something before the chevron (a clear button). */
  trailing?: React.ReactNode;
}) {
  const theme = useTheme();
  if (row) {
    return (
      <Pressable
        onPress={onPress}
        className={`flex-row items-center px-3.5 ${row.divider ? "border-t border-border" : ""}`}
        style={{ minHeight: 60, gap: 12 }}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <View className="w-9 h-9 rounded-control items-center justify-center" style={{ backgroundColor: tint(row.color, 0.1) }}>
          <Ionicons name={icon} size={17} color={row.color} />
        </View>
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Text className="text-label text-muted-foreground" numberOfLines={1}>
            {row.label}
          </Text>
          <Text className={`text-body ${on ? "font-semibold text-foreground" : "text-faint-foreground"}`} numberOfLines={1}>
            {text}
          </Text>
        </View>
        {row.tag ? (
          <View className="rounded-pill px-2 justify-center" style={{ height: 24, backgroundColor: theme.alpha("primary", 0.1) }}>
            <Text className="text-label font-semibold text-primary" numberOfLines={1}>
              {row.tag}
            </Text>
          </View>
        ) : null}
        {trailing}
        <Ionicons name="chevron-forward" size={16} color={theme.faintForeground} />
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center rounded-control border px-4"
      style={{
        minHeight: 48,
        gap: 12,
        borderColor: on ? theme.primary : theme.border,
        backgroundColor: on ? theme.alpha("primary", 0.08) : theme.card,
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {leading ?? <Ionicons name={icon} size={18} color={on ? theme.primary : theme.mutedForeground} />}
      <Text className={`flex-1 text-body ${on ? "text-foreground" : "text-faint-foreground"}`} numberOfLines={1}>
        {text}
      </Text>
      {right ? <Text className="text-label text-muted-foreground">{right}</Text> : null}
      {trailing}
      <Ionicons name="chevron-down" size={18} color={theme.mutedForeground} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Date Selector
// ---------------------------------------------------------------------------

interface DateSelectorProps {
  date: string;
  showDatePicker: boolean;
  onToggleDatePicker: () => void;
  onDateShift: (days: number) => void;
  onSetDate: (date: string) => void;
  onCloseDatePicker: () => void;
  dateError?: string;
}

export function DateSelector({
  date,
  showDatePicker,
  onToggleDatePicker,
  onDateShift,
  onSetDate,
  onCloseDatePicker,
  dateError,
}: DateSelectorProps) {
  const { colorScheme } = useColorScheme();
  const theme = useTheme();
  const [showCalendar, setShowCalendar] = useState(false);

  return (
    <View className="mb-4">
      <Text className="text-label font-semibold text-muted-foreground mb-1.5">
        Date
      </Text>
      <View className="flex-row items-center">
        <Pressable
          onPress={() => onDateShift(-1)}
          className="w-10 h-10 rounded-control bg-card items-center justify-center"
        >
          <Ionicons name="chevron-back" size={20} color={theme.mutedForeground} />
        </Pressable>
        <Pressable
          onPress={onToggleDatePicker}
          className="flex-1 mx-2 py-2 px-4 rounded-control border border-border bg-card items-center"
        >
          <Text className="text-body font-medium text-foreground">
            {formatDateForDisplay(date)}
          </Text>
          <Text className="text-label text-muted-foreground">
            {date}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onDateShift(1)}
          className="w-10 h-10 rounded-control bg-card items-center justify-center"
        >
          <Ionicons name="chevron-forward" size={20} color={theme.mutedForeground} />
        </Pressable>
        <Pressable
          onPress={() => setShowCalendar(true)}
          className="ml-2 w-10 h-10 rounded-control items-center justify-center border"
          style={{ backgroundColor: theme.alpha("primary", 0.1), borderColor: theme.alpha("primary", 0.25) }}
        >
          <Ionicons name="calendar-outline" size={20} color={theme.primary} />
        </Pressable>
      </View>
      {/* Quick date buttons */}
      {showDatePicker && (
        <View className="flex-row mt-2">
          <Pressable
            onPress={() => {
              onSetDate(formatDateForStorage(new Date()));
              onCloseDatePicker();
            }}
            className={`flex-1 py-2 rounded-control mr-2 items-center ${
              date === formatDateForStorage(new Date())
                ? ""
                : "bg-card"
            }`}
            style={date === formatDateForStorage(new Date()) ? { backgroundColor: theme.alpha("primary", 0.1) } : undefined}
          >
            <Text className="text-meta font-semibold text-muted-foreground">
              Today
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              const yesterday = new Date();
              yesterday.setDate(yesterday.getDate() - 1);
              onSetDate(formatDateForStorage(yesterday));
              onCloseDatePicker();
            }}
            className="flex-1 py-2 rounded-control items-center bg-card"
          >
            <Text className="text-meta font-semibold text-muted-foreground">
              Yesterday
            </Text>
          </Pressable>
        </View>
      )}
      {dateError && (
        <Text className="text-label text-danger mt-1">{dateError}</Text>
      )}
      <CalendarModal
        visible={showCalendar}
        onClose={() => setShowCalendar(false)}
        value={date}
        onChange={(d) => {
          onSetDate(d);
          onCloseDatePicker();
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Category Picker
// ---------------------------------------------------------------------------

interface CategoryPickerProps {
  categories: Category[];
  categoryId: string | null;
  selectedCategory: Category | undefined;
  showCategories: boolean;
  onToggle: () => void;
  onSelect: (catId: string | null) => void;
  /** When true, shows a "None" option to clear selection (used in edit mode) */
  allowNone?: boolean;
  /** Small note next to the label, e.g. "From merchant". */
  hint?: string | null;
  /** The category usually used with the merchant picked, shown on top. */
  usualId?: string | null;
  /** Show as a row of the form's card. */
  row?: boolean;
  divider?: boolean;
}

export function CategoryPicker({
  categories,
  categoryId,
  selectedCategory: selectedFromForm,
  showCategories,
  onToggle,
  onSelect,
  allowNone = false,
  hint,
  usualId,
  row,
  divider,
}: CategoryPickerProps) {
  const theme = useTheme();
  // Added here: until the form reloads its categories, they're kept in this list.
  const [added, setAdded] = useState<Category[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const allCategories = useMemo(
    () => [...categories, ...added.filter((a) => !categories.some((c) => c.id === a.id))],
    [categories, added],
  );
  const shownCategory = selectedFromForm ?? (categoryId ? added.find((c) => c.id === categoryId) : undefined);
  const sections = useMemo<PickerSheetSection[]>(() => {
    const out: PickerSheetSection[] = [];
    const usual = usualId ? categories.find((c) => c.id === usualId) : undefined;
    if (usual) out.push({ key: "usual", title: "Usually for this merchant", items: [{ id: usual.id, label: usual.name, icon: usual.icon as keyof typeof Ionicons.glyphMap, color: usual.color }] });
    // Each main category, then its sub-categories (095); search finds a sub-category by its parent too.
    for (const { parent, children } of buildCategoryTree(allCategories)) {
      out.push({
        key: parent.id,
        items: [
          { id: parent.id, label: parent.name, icon: parent.icon as keyof typeof Ionicons.glyphMap, color: parent.color, sub: children.length ? `${children.length} sub-categories` : undefined },
          ...children.map((c) => ({ id: c.id, label: c.name, sub: `In ${parent.name}`, keywords: parent.name, icon: c.icon as keyof typeof Ionicons.glyphMap, color: c.color, indent: true })),
        ],
      });
    }
    return out;
  }, [allCategories, categories, usualId]);
  const selectedCategory = shownCategory;

  return (
    <View className={row ? "" : "mb-4"}>
      {!row && (
        <Text className="text-label font-semibold text-muted-foreground mb-1.5">
          Category{hint ? <Text className="text-label text-primary"> · {hint}</Text> : null}
        </Text>
      )}
      <FieldButton
        row={row ? { label: "Category", color: selectedCategory?.color ?? theme.data.series[1], tag: hint, divider } : undefined}
        icon={selectedCategory && row ? (selectedCategory.icon as keyof typeof Ionicons.glyphMap) : "pricetags-outline"}
        on={!!selectedCategory}
        text={selectedCategory ? categoryPath(selectedCategory, new Map(allCategories.map((c) => [c.id, c]))) : "Select category"}
        onPress={onToggle}
        accessibilityLabel={`Category${selectedCategory ? `, ${selectedCategory.name}` : ""}`}
        leading={
          selectedCategory ? (
            <View className="w-7 h-7 rounded-control items-center justify-center" style={{ backgroundColor: tint(selectedCategory.color, 0.1) }}>
              <Ionicons name={selectedCategory.icon as keyof typeof Ionicons.glyphMap} size={15} color={selectedCategory.color} />
            </View>
          ) : undefined
        }
      />
      <PickerSheet
        visible={showCategories}
        onClose={onToggle}
        title="Category"
        sections={sections}
        selectedId={categoryId}
        onSelect={(id) => onSelect(id)}
        allowNone={allowNone}
        searchPlaceholder="Search categories and sub-categories"
        onAdd={(typed) => {
          setAddName(typed);
          onToggle();
          setAddOpen(true);
        }}
        addLabel={(t) => `Add a category “${t}”`}
        addAlways="New category or sub-category"
        noun={{ one: "category", many: "categories" }}
      />
      <QuickAddCategorySheet
        visible={addOpen}
        initialName={addName}
        categories={allCategories}
        onClose={() => setAddOpen(false)}
        onCreated={(cat) => {
          setAdded((list) => (list.some((c) => c.id === cat.id) ? list : [...list, cat]));
          setAddOpen(false);
          onSelect(cat.id);
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Payment Mode Picker
// ---------------------------------------------------------------------------

interface PaymentModePickerProps {
  paymentModes: PaymentMode[];
  paymentModeId: string | null;
  selectedPaymentMode: PaymentMode | undefined;
  showPaymentModes: boolean;
  onToggle: () => void;
  onSelect: (pmId: string | null) => void;
  /** When true, shows a "None" option to clear selection (used in edit mode) */
  allowNone?: boolean;
  /** How often each mode is used, for "Most used" on top. */
  usage?: Map<string, number>;
  hint?: string | null;
  /** The row's label ("Paid by"). */
  label?: string;
  /** Show as a row of the form's card. */
  row?: boolean;
  divider?: boolean;
}

export function PaymentModePicker({
  paymentModes,
  paymentModeId,
  selectedPaymentMode,
  showPaymentModes,
  onToggle,
  onSelect,
  allowNone = false,
  usage,
  hint,
  label = "Payment mode",
  row,
  divider,
}: PaymentModePickerProps) {
  const router = useRouter();
  const theme = useTheme();
  const sections = useMemo<PickerSheetSection[]>(() => {
    const item = (pm: PaymentMode) => ({
      id: pm.id,
      label: pm.name,
      sub: PAYMENT_MODE_TYPE_LABELS[pm.type as PaymentModeType],
      icon: TYPE_ICONS[pm.type as PaymentModeType],
      right: usage?.get(pm.id) ? `${usage.get(pm.id)}×` : undefined,
    });
    const used = usage ? [...paymentModes].filter((p) => (usage.get(p.id) ?? 0) > 0).sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0)) : [];
    const out: PickerSheetSection[] = [];
    if (used.length > 0) out.push({ key: "used", title: "Most used", items: used.slice(0, 5).map(item) });
    out.push({ key: "all", title: used.length > 0 ? "All payment modes" : undefined, items: paymentModes.map(item) });
    return out;
  }, [paymentModes, usage]);

  return (
    <View className={row ? "" : "mb-4"}>
      {!row && (
        <Text className="text-label font-semibold text-muted-foreground mb-1.5">
          {label}
          {hint ? <Text className="text-label text-primary"> · {hint}</Text> : null}
        </Text>
      )}
      <FieldButton
        row={row ? { label, color: theme.data.series[3], tag: hint, divider } : undefined}
        icon={selectedPaymentMode ? TYPE_ICONS[selectedPaymentMode.type as PaymentModeType] : "card-outline"}
        on={!!selectedPaymentMode}
        text={selectedPaymentMode ? selectedPaymentMode.name : "Select payment mode"}
        right={selectedPaymentMode ? PAYMENT_MODE_TYPE_LABELS[selectedPaymentMode.type as PaymentModeType] : undefined}
        onPress={onToggle}
        accessibilityLabel={`Payment mode${selectedPaymentMode ? `, ${selectedPaymentMode.name}` : ""}`}
      />
      <PickerSheet
        visible={showPaymentModes}
        onClose={onToggle}
        title="Payment mode"
        sections={sections}
        selectedId={paymentModeId}
        onSelect={(id) => onSelect(id)}
        allowNone={allowNone}
        searchPlaceholder="Search payment modes"
        onAdd={() => {
          onToggle();
          router.push("/settings/payment-mode-edit");
        }}
        addLabel={(t) => `Add a payment mode “${t}”`}
        noun={{ one: "payment mode", many: "payment modes" }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Merchant Picker (searchable sheet: recent, most used, "+ Add <typed name>")
// ---------------------------------------------------------------------------

interface MerchantPickerProps {
  value: string;
  onChangeText: (text: string) => void;
  merchantNames: string[];
  showSuggestions: boolean;
  onToggleSuggestions: () => void;
  onCloseSuggestions: () => void;
  /** Field label — "Paid to", "Received from". Defaults to "Merchant". */
  label?: string;
  placeholder?: string;
  /** Recent and most-used merchants with their usual category / mode, from services/picker-usage. */
  usage?: { recent: MerchantUsage[]; mostUsed: MerchantUsage[] };
  /** "Food · UPI · 14×" for a merchant's row. */
  describe?: (u: MerchantUsage) => string;
  /** Picked a merchant that has a usual category / account / mode: the form fills them. */
  onPickUsage?: (u: MerchantUsage) => void;
  /** Show as a row of the form's card. */
  row?: boolean;
  divider?: boolean;
}

export function MerchantPicker({
  value,
  onChangeText,
  merchantNames,
  showSuggestions,
  onToggleSuggestions,
  onCloseSuggestions,
  label = "Merchant",
  placeholder = "e.g., Amazon, Swiggy (optional)",
  usage,
  describe,
  onPickUsage,
  row,
  divider,
}: MerchantPickerProps) {
  const theme = useTheme();
  const byName = useMemo(() => {
    const m = new Map<string, MerchantUsage>();
    for (const u of usage?.mostUsed ?? []) m.set(u.name.toLowerCase(), u);
    return m;
  }, [usage]);

  const sections = useMemo<PickerSheetSection[]>(() => {
    const row = (u: MerchantUsage) => ({ id: u.name, label: u.name, sub: describe ? describe(u) : `${u.count}×`, icon: "storefront-outline" as const });
    const out: PickerSheetSection[] = [];
    if (usage && usage.recent.length > 0) out.push({ key: "recent", title: "Recent", items: usage.recent.slice(0, 5).map(row) });
    if (usage && usage.mostUsed.length > 0) out.push({ key: "most", title: "Most used", items: usage.mostUsed.slice(0, 30).map(row) });
    // Every other known name (message names, older merchants).
    const listed = new Set([...(usage?.mostUsed ?? []).map((u) => u.name.toLowerCase())]);
    const rest = merchantNames.filter((n) => !listed.has(n.toLowerCase()));
    if (rest.length > 0)
      out.push({ key: "all", title: usage ? "All merchants" : undefined, items: rest.map((n) => ({ id: n, label: n, icon: "storefront-outline" as const })) });
    return out;
  }, [usage, merchantNames, describe]);

  return (
    <View className={row ? "" : "mb-4"}>
      {row ? (
        <FieldButton
          row={{ label, color: theme.data.series[1], divider }}
          icon="storefront-outline"
          on={value.trim() !== ""}
          text={value.trim() !== "" ? value : placeholder}
          onPress={onToggleSuggestions}
          accessibilityLabel={`${label}${value ? `, ${value}` : ""}`}
          trailing={
            value.trim() !== "" ? (
              <Pressable onPress={() => onChangeText("")} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Clear ${label}`}>
                <Ionicons name="close-circle" size={18} color={theme.faintForeground} />
              </Pressable>
            ) : null
          }
        />
      ) : (
        <>
          <Text className="text-label font-semibold text-muted-foreground mb-1.5">{label}</Text>
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <View className="flex-1">
              <FieldButton
                icon="storefront-outline"
                on={value.trim() !== ""}
                text={value.trim() !== "" ? value : placeholder}
                onPress={onToggleSuggestions}
                accessibilityLabel={`${label}${value ? `, ${value}` : ""}`}
              />
            </View>
            {value.trim() !== "" && (
              <Pressable onPress={() => onChangeText("")} hitSlop={8} className="p-1" accessibilityRole="button" accessibilityLabel={`Clear ${label}`}>
                <Ionicons name="close-circle" size={20} color={theme.mutedForeground} />
              </Pressable>
            )}
          </View>
        </>
      )}
      <PickerSheet
        visible={showSuggestions}
        onClose={onCloseSuggestions}
        title={label}
        sections={sections}
        selectedId={value.trim() || null}
        onSelect={(id) => {
          const name = id ?? "";
          onChangeText(name);
          onCloseSuggestions();
          const u = byName.get(name.toLowerCase());
          if (u && onPickUsage) onPickUsage(u);
        }}
        searchPlaceholder="Search or type a name"
        onAdd={(typed) => {
          onChangeText(typed);
          onCloseSuggestions();
        }}
        addLabel={(t) => `Use “${t}”`}
        noun={{ one: "merchant", many: "merchants" }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Spend Classification Toggle (Unavoidable / Discretionary)
// ---------------------------------------------------------------------------

interface RightSpendToggleProps {
  isRightSpend: boolean;
  onToggle: () => void;
}

export function RightSpendToggle({ isRightSpend, onToggle }: RightSpendToggleProps) {
  const theme = useTheme();
  const isUnavoidable = isRightSpend;
  return (
    <View className="mb-6">
      <Pressable
        onPress={onToggle}
        className="flex-row items-center justify-between rounded-control border border-border bg-card px-4 py-3"
      >
        <View className="flex-row items-center">
          <Ionicons
            name={isUnavoidable ? "lock-closed" : "pricetag-outline"}
            size={22}
            color={isUnavoidable ? theme.primary : theme.warning}
          />
          <View className="ml-3">
            <Text className="text-body font-medium text-foreground">
              {isUnavoidable ? "Unavoidable" : "Discretionary"}
            </Text>
            <Text className="text-label text-muted-foreground">
              {isUnavoidable
                ? "This expense was necessary"
                : "This could have been avoided"}
            </Text>
          </View>
        </View>
        <Switch
          value={isUnavoidable}
          onValueChange={onToggle}
          trackColor={{ false: "#767577", true: theme.primary }}
          thumbColor="#FFFFFF"
        />
      </Pressable>
    </View>
  );
}
