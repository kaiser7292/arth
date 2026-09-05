import { CalendarModal } from "@/components/ui/CalendarModal";
import { Text } from "@/components/ui";
import { TYPE_ICONS } from "@/constants/icons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { Category } from "@/services/category";
import type { FinancialAccount } from "@/services/financial-account";
import type { PaymentMode, PaymentModeType } from "@/services/payment-mode";
import { PAYMENT_MODE_TYPE_LABELS } from "@/services/payment-mode";
import { ac } from "@/utils/accent";
import { formatDateForDisplay, formatDateForStorage } from "@/utils/expense-validation";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Switch, TextInput, View } from "react-native";

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
  const { colors, accent, colorScheme } = useColorScheme();

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(q) || i.subtitle?.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <View className="mt-2 rounded-lg border border-border bg-card overflow-hidden">
      {items.length > 5 && (
        <View className="flex-row items-center px-3 py-2 border-b border-border">
          <Ionicons name="search" size={14} color={colors.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={searchPlaceholder}
            placeholderTextColor={colors.tabIconDefault}
            className="flex-1 ml-2 text-sm text-foreground"
          />
          {query !== "" && (
            <Pressable onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={14} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>
      )}
      <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
        {allowNone && (
          <Pressable
            onPress={() => onSelect(null)}
            className="flex-row items-center px-4 py-3 border-b border-border"
            style={selectedId === null ? { backgroundColor: ac(accent, colorScheme, 50, 700) } : undefined}
          >
            <Ionicons name="remove-circle-outline" size={18} color={colors.textSecondary} />
            <Text className="ml-3 text-sm text-faint-foreground">None</Text>
          </Pressable>
        )}
        {filtered.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => onSelect(item.id)}
            className="flex-row items-center px-4 py-3 border-b border-border"
            style={selectedId === item.id ? { backgroundColor: ac(accent, colorScheme, 50, 700) } : undefined}
          >
            {item.color && (
              <View className="w-6 h-6 rounded-full items-center justify-center mr-2" style={{ backgroundColor: item.color + "14" }}>
                {item.icon && <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={14} color={item.color} />}
              </View>
            )}
            <View className="flex-1">
              <Text className="text-sm text-foreground">{item.label}</Text>
              {item.subtitle && <Text className="text-label text-muted-foreground">{item.subtitle}</Text>}
            </View>
            {selectedId === item.id && (
              <Ionicons name="checkmark" size={16} color={colors.blue} />
            )}
          </Pressable>
        ))}
        {filtered.length === 0 && query !== "" && (
          <Text className="text-xs text-faint-foreground text-center py-4">No matches</Text>
        )}
      </ScrollView>
    </View>
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
}

export function AccountPicker({
  accounts,
  accountId,
  selectedAccount,
  showAccounts,
  onToggle,
  onSelect,
}: AccountPickerProps) {
  const { colors, accent, colorScheme } = useColorScheme();
  const router = useRouter();

  const accentStyles = useMemo(() => ({
    selectedBorder: { borderColor: ac(accent, colorScheme, 400, 800), backgroundColor: ac(accent, colorScheme, 50, 700) },
    highlightBg: { backgroundColor: ac(accent, colorScheme, 50, 700) },
  }), [accent, colorScheme]);

  return (
    <View className="mb-4">
      <Text className="text-sm font-medium text-muted-foreground mb-2">
        Account
      </Text>
      {accounts.length > 0 ? (
        <>
          <Pressable
            onPress={onToggle}
            className={`flex-row items-center rounded-lg border px-4 py-3 ${
              selectedAccount
                ? ""
                : "border-border bg-card"
            }`}
            style={selectedAccount ? accentStyles.selectedBorder : undefined}
          >
            {selectedAccount ? (
              <>
                <Ionicons name="business-outline" size={18} color={colors.blue} />
                <Text className="flex-1 ml-3 text-base text-foreground">
                  {selectedAccount.account_label ??
                    `${selectedAccount.bank_name} ****${selectedAccount.account_identifier}`}
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="business-outline" size={18} color={colors.textSecondary} />
                <Text className="flex-1 ml-3 text-base text-faint-foreground">
                  Select account (optional)
                </Text>
              </>
            )}
            <Ionicons
              name={showAccounts ? "chevron-up" : "chevron-down"}
              size={18}
              color={colors.textSecondary}
            />
          </Pressable>
          {showAccounts && (
            <SearchablePickerList
              items={accounts.map((acct) => ({
                id: acct.id,
                label: acct.account_label ?? `${acct.bank_name} ****${acct.account_identifier}`,
                subtitle: `${acct.account_type === "credit_card" ? "Credit Card" : acct.account_type === "savings" ? "Savings" : acct.account_type === "loan" ? "Loan" : "Wallet"} · ${acct.bank_name}`,
              }))}
              selectedId={accountId}
              onSelect={onSelect}
              allowNone
              searchPlaceholder="Search accounts..."
            />
          )}
        </>
      ) : (
        <Pressable
          onPress={() => router.push("/settings/account-add")}
          className="flex-row items-center rounded-lg border border-dashed border-border bg-card px-4 py-3"
        >
          <Ionicons name="add-circle-outline" size={18} color={colors.textSecondary} />
          <Text className="flex-1 ml-3 text-sm text-faint-foreground">
            No accounts yet - tap to add one
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </Pressable>
      )}
    </View>
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
  const { colors, accent, colorScheme } = useColorScheme();
  const [showCalendar, setShowCalendar] = useState(false);

  return (
    <View className="mb-4">
      <Text className="text-sm font-medium text-muted-foreground mb-2">
        Date
      </Text>
      <View className="flex-row items-center">
        <Pressable
          onPress={() => onDateShift(-1)}
          className="w-10 h-10 rounded-lg bg-card items-center justify-center"
        >
          <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          onPress={onToggleDatePicker}
          className="flex-1 mx-2 py-2 px-4 rounded-lg border border-border bg-card items-center"
        >
          <Text className="text-base font-medium text-foreground">
            {formatDateForDisplay(date)}
          </Text>
          <Text className="text-xs text-muted-foreground">
            {date}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onDateShift(1)}
          className="w-10 h-10 rounded-lg bg-card items-center justify-center"
        >
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          onPress={() => setShowCalendar(true)}
          className="ml-2 w-10 h-10 rounded-lg items-center justify-center border"
          style={{ backgroundColor: ac(accent, colorScheme, 50, 900), borderColor: ac(accent, colorScheme, 200, 700) }}
        >
          <Ionicons name="calendar-outline" size={20} color={colors.blue} />
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
            className={`flex-1 py-2 rounded-lg mr-2 items-center ${
              date === formatDateForStorage(new Date())
                ? ""
                : "bg-card"
            }`}
            style={date === formatDateForStorage(new Date()) ? { backgroundColor: ac(accent, colorScheme, 100, 700) } : undefined}
          >
            <Text className="text-sm font-medium text-muted-foreground">
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
            className="flex-1 py-2 rounded-lg items-center bg-card"
          >
            <Text className="text-sm font-medium text-muted-foreground">
              Yesterday
            </Text>
          </Pressable>
        </View>
      )}
      {dateError && (
        <Text className="text-xs text-danger mt-1">{dateError}</Text>
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
}

export function CategoryPicker({
  categories,
  categoryId,
  selectedCategory,
  showCategories,
  onToggle,
  onSelect,
  allowNone = false,
}: CategoryPickerProps) {
  const { colors, accent, colorScheme } = useColorScheme();

  return (
    <View className="mb-4">
      <Text className="text-sm font-medium text-muted-foreground mb-2">
        Category
      </Text>
      <Pressable
        onPress={onToggle}
        className={`flex-row items-center rounded-lg border px-4 py-3 ${
          selectedCategory
            ? ""
            : "border-border bg-card"
        }`}
        style={selectedCategory ? { borderColor: ac(accent, colorScheme, 400, 800), backgroundColor: ac(accent, colorScheme, 50, 700) } : undefined}
      >
        {selectedCategory ? (
          <>
            <View
              className="w-7 h-7 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: selectedCategory.color + "14" }}
            >
              <Ionicons
                name={selectedCategory.icon as keyof typeof Ionicons.glyphMap}
                size={16}
                color={selectedCategory.color}
              />
            </View>
            <Text className="flex-1 text-base text-foreground">
              {selectedCategory.name}
            </Text>
          </>
        ) : (
          <>
            <Ionicons name="pricetags-outline" size={18} color={colors.textSecondary} />
            <Text className="flex-1 ml-3 text-base text-faint-foreground">
              Select category
            </Text>
          </>
        )}
        <Ionicons
          name={showCategories ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.textSecondary}
        />
      </Pressable>
      {showCategories && (
        <SearchablePickerList
          items={categories.map((cat) => ({
            id: cat.id,
            label: cat.name,
            icon: cat.icon,
            color: cat.color,
          }))}
          selectedId={categoryId}
          onSelect={onSelect}
          allowNone={allowNone}
          searchPlaceholder="Search categories..."
        />
      )}
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
}

export function PaymentModePicker({
  paymentModes,
  paymentModeId,
  selectedPaymentMode,
  showPaymentModes,
  onToggle,
  onSelect,
  allowNone = false,
}: PaymentModePickerProps) {
  const { colors, accent, colorScheme } = useColorScheme();

  return (
    <View className="mb-4">
      <Text className="text-sm font-medium text-muted-foreground mb-2">
        Payment Mode
      </Text>
      <Pressable
        onPress={onToggle}
        className={`flex-row items-center rounded-lg border px-4 py-3 ${
          selectedPaymentMode
            ? ""
            : "border-border bg-card"
        }`}
        style={selectedPaymentMode ? { borderColor: ac(accent, colorScheme, 400, 800), backgroundColor: ac(accent, colorScheme, 50, 700) } : undefined}
      >
        {selectedPaymentMode ? (
          <>
            <Ionicons
              name={TYPE_ICONS[selectedPaymentMode.type as PaymentModeType]}
              size={18}
              color={colors.blue}
            />
            <Text className="flex-1 ml-3 text-base text-foreground">
              {selectedPaymentMode.name}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {PAYMENT_MODE_TYPE_LABELS[selectedPaymentMode.type as PaymentModeType]}
            </Text>
          </>
        ) : (
          <>
            <Ionicons name="card-outline" size={18} color={colors.textSecondary} />
            <Text className="flex-1 ml-3 text-base text-faint-foreground">
              Select payment mode
            </Text>
          </>
        )}
        <Ionicons
          name={showPaymentModes ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.textSecondary}
          style={{ marginLeft: 8 }}
        />
      </Pressable>
      {showPaymentModes && (
        <SearchablePickerList
          items={paymentModes.map((pm) => ({
            id: pm.id,
            label: pm.name,
            subtitle: PAYMENT_MODE_TYPE_LABELS[pm.type as PaymentModeType],
          }))}
          selectedId={paymentModeId}
          onSelect={onSelect}
          allowNone={allowNone}
          searchPlaceholder="Search payment modes..."
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Merchant Picker (autocomplete text input + suggestions dropdown)
// ---------------------------------------------------------------------------

interface MerchantPickerProps {
  value: string;
  onChangeText: (text: string) => void;
  merchantNames: string[];
  showSuggestions: boolean;
  onToggleSuggestions: () => void;
  onCloseSuggestions: () => void;
}

export function MerchantPicker({
  value,
  onChangeText,
  merchantNames,
  showSuggestions,
  onToggleSuggestions,
  onCloseSuggestions,
}: MerchantPickerProps) {
  const { colors, accent, colorScheme } = useColorScheme();

  // Filter suggestions based on current input
  const filtered = value.trim().length > 0
    ? merchantNames.filter((n) =>
        n.toLowerCase().includes(value.trim().toLowerCase()),
      )
    : merchantNames;

  return (
    <View className="mb-4">
      <Text className="text-sm font-medium text-muted-foreground mb-2">
        Merchant
      </Text>
      <View className="flex-row items-center rounded-lg border border-border bg-card overflow-hidden">
        <View className="flex-1 px-4 py-2">
          <TextInput
            value={value}
            onChangeText={(text) => {
              onChangeText(text);
              if (!showSuggestions && text.length > 0) onToggleSuggestions();
            }}
            placeholder="e.g., Amazon, Swiggy (optional)"
            placeholderTextColor={colors.tabIconDefault}
            maxLength={100}
            className="text-base text-foreground"
            onFocus={() => {
              if (merchantNames.length > 0) onToggleSuggestions();
            }}
          />
        </View>
        {merchantNames.length > 0 && (
          <Pressable
            onPress={onToggleSuggestions}
            className="px-3 py-3"
          >
            <Ionicons
              name={showSuggestions ? "chevron-up" : "chevron-down"}
              size={18}
              color={colors.textSecondary}
            />
          </Pressable>
        )}
      </View>
      {showSuggestions && filtered.length > 0 && (
        <View className="mt-1 rounded-lg border border-border bg-card overflow-hidden max-h-48">
          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
            {filtered.slice(0, 20).map((name) => (
              <Pressable
                key={name}
                onPress={() => {
                  onChangeText(name);
                  onCloseSuggestions();
                }}
                className="flex-row items-center px-4 py-3 border-b border-border"
                style={value.toLowerCase() === name.toLowerCase() ? { backgroundColor: ac(accent, colorScheme, 50, 700) } : undefined}
              >
                <Ionicons name="storefront-outline" size={16} color={colors.textSecondary} />
                <Text
                  className="flex-1 ml-3 text-sm text-foreground"
                  numberOfLines={1}
                >
                  {name}
                </Text>
                {value.toLowerCase() === name.toLowerCase() && (
                  <Ionicons name="checkmark" size={16} color={colors.blue} />
                )}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
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
  const isUnavoidable = isRightSpend;
  return (
    <View className="mb-6">
      <Pressable
        onPress={onToggle}
        className="flex-row items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
      >
        <View className="flex-row items-center">
          <Ionicons
            name={isUnavoidable ? "lock-closed" : "pricetag-outline"}
            size={22}
            color={isUnavoidable ? "#3B82F6" : "#D97706"}
          />
          <View className="ml-3">
            <Text className="text-base font-medium text-foreground">
              {isUnavoidable ? "Unavoidable" : "Discretionary"}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {isUnavoidable
                ? "This expense was necessary"
                : "This could have been avoided"}
            </Text>
          </View>
        </View>
        <Switch
          value={isUnavoidable}
          onValueChange={onToggle}
          trackColor={{ false: "#767577", true: "#3B82F6" }}
          thumbColor="#FFFFFF"
        />
      </Pressable>
    </View>
  );
}
