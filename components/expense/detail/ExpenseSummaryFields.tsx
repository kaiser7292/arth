import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { Text } from "@/components/ui";
import { TYPE_ICONS } from "@/constants/icons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import type { Category } from "@/services/category";
import type { Expense } from "@/services/expense";
import type { FinancialAccount } from "@/services/financial-account";
import type { PaymentMode, PaymentModeType } from "@/services/payment-mode";

interface ExpenseSummaryFieldsProps {
  expense: Expense;
  /** Undefined while the expense itself is still loading; null when genuinely unset. */
  account: FinancialAccount | null | undefined;
  category: Category | null | undefined;
  paymentMode: PaymentMode | null | undefined;
}

/** One label/value line. Every row in this card is the same shape. */
function Field({
  icon,
  iconColor,
  label,
  children,
  last = false,
  alignTop = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  label: string;
  children: React.ReactNode;
  last?: boolean;
  alignTop?: boolean;
}) {
  const { colors } = useColorScheme();
  return (
    <View
      className={`flex-row ${alignTop ? "items-start" : "items-center"} px-4 py-3 ${
        last ? "" : "border-b border-border"
      }`}
    >
      <Ionicons name={icon} size={16} color={iconColor ?? colors.textSecondary} />
      <Text className="text-xs text-muted-foreground ml-3 w-20">{label}</Text>
      {children}
    </View>
  );
}

function NotSet({ label = "Not set" }: { label?: string }) {
  return <Text className="text-sm text-muted-foreground flex-1 text-right">{label}</Text>;
}

/**
 * The read-only summary rows on expense detail: account, category, merchant, payment mode,
 * spend classification and notes.
 *
 * Split out of app/expense/[id].tsx, which was 3,362 lines. This block is pure presentation - it
 * reads the expense and three lookups and owns no state - so it was among the safest to lift out,
 * and the six near-identical rows collapse into one Field once they are somewhere they can share
 * a helper.
 */
export function ExpenseSummaryFields({
  expense,
  account,
  category,
  paymentMode,
}: ExpenseSummaryFieldsProps) {
  const { colors } = useColorScheme();
  const theme = useTheme();

  return (
    <View className="mx-4 mt-3 rounded-xl bg-card">
      <Field icon="business-outline" label="Account">
        {account ? (
          <Text className="text-sm font-medium text-foreground flex-1 text-right" numberOfLines={1}>
            {account.account_label ||
              `${account.bank_name} ****${account.account_identifier}`}
          </Text>
        ) : (
          <NotSet />
        )}
      </Field>

      <Field icon="pricetags-outline" label="Category">
        {category ? (
          <View className="flex-row items-center flex-1 justify-end">
            <View
              className="w-5 h-5 rounded-full items-center justify-center mr-1.5"
              style={{ backgroundColor: category.color + "14" }}
            >
              <Ionicons
                name={category.icon as keyof typeof Ionicons.glyphMap}
                size={10}
                color={category.color}
              />
            </View>
            <Text className="text-sm font-medium text-foreground">{category.name}</Text>
          </View>
        ) : (
          <NotSet label="Uncategorized" />
        )}
      </Field>

      <Field icon="storefront-outline" label="Merchant">
        {expense.merchant_name ? (
          <Text className="text-sm font-medium text-foreground flex-1 text-right">
            {expense.merchant_name}
          </Text>
        ) : (
          <NotSet />
        )}
      </Field>

      <Field icon="card-outline" label="Payment">
        {paymentMode ? (
          <View className="flex-row items-center flex-1 justify-end">
            <Ionicons
              name={TYPE_ICONS[paymentMode.type as PaymentModeType]}
              size={14}
              color={colors.textSecondary}
            />
            <Text className="text-sm font-medium text-foreground ml-1.5">{paymentMode.name}</Text>
          </View>
        ) : (
          <NotSet />
        )}
      </Field>

      {/* Spend classification - hidden for credits, where it does not apply to income. */}
      {expense.nature !== "credit" && (
        <Field
          icon={expense.is_right_spend !== 0 ? "lock-closed" : "pricetag-outline"}
          iconColor={expense.is_right_spend !== 0 ? colors.blue : theme.warning}
          label="Spend"
        >
          <Text className="text-sm font-medium text-foreground flex-1 text-right">
            {expense.is_right_spend !== 0 ? "Unavoidable" : "Discretionary"}
          </Text>
        </Field>
      )}

      {expense.description && (
        <Field icon="document-text-outline" label="Notes" last alignTop>
          <Text className="text-sm text-foreground flex-1 text-right" numberOfLines={3}>
            {expense.description}
          </Text>
        </Field>
      )}
    </View>
  );
}
