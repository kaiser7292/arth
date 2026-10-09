import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, FilterChip, Input, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount } from "@/utils/expense-validation";
import { formatDate, todayIso } from "@/utils/date";
import type {
  AdvanceTaxPlan,
  BusinessIncomeCalculation,
  BusinessScheme,
} from "@/services/tax-engine";
import { Toggle, BreakdownRow } from "./salary-helpers";

// ─── Shared note row ──────────────────────────────────────

/** Small tinted note inside a card. `tone` picks the semantic colour. */
export function InlineNote({
  tone = "primary",
  icon = "information-circle-outline",
  children,
  className = "mb-3",
}: {
  tone?: "primary" | "warning" | "success" | "danger";
  icon?: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
  className?: string;
}) {
  const theme = useTheme();
  return (
    <View
      className={`flex-row items-start px-3 py-2.5 rounded-lg ${className}`}
      style={{ backgroundColor: theme.alpha(tone, 0.08) }}
    >
      <Ionicons name={icon} size={16} color={theme[tone]} />
      <Text className="text-xs text-muted-foreground ml-2 flex-1">{children}</Text>
    </View>
  );
}

// ─── Scheme copy ──────────────────────────────────────────

const SCHEME_HELP: Record<BusinessScheme, string> = {
  presumptive_profession:
    "Presumptive (44ADA): tax on 50% of receipts, no books needed. For doctors, lawyers, consultants, designers, developers and other professionals.",
  presumptive_business:
    "Presumptive (44AD): tax on 6% of digital and 8% of cash turnover, no books needed. For traders, shops, contractors and small businesses.",
  regular:
    "Regular books: tax on actual profit (receipts minus business expenses). Use this if you keep accounts or earn above the presumptive limits.",
};

// ─── Inputs ───────────────────────────────────────────────

export interface BusinessInputsProps {
  scheme: BusinessScheme;
  onSchemeChange: (v: BusinessScheme) => void;
  receipts: string;
  onReceiptsChange: (v: string) => void;
  digitalPct: string;
  onDigitalPctChange: (v: string) => void;
  expenses: string;
  onExpensesChange: (v: string) => void;
  tdsPct: string;
  onTdsPctChange: (v: string) => void;
  gstPct: string;
  onGstPctChange: (v: string) => void;
}

/** The business / freelance fields. Used for primary business income and for a side business. */
export function BusinessInputs({
  scheme,
  onSchemeChange,
  receipts,
  onReceiptsChange,
  digitalPct,
  onDigitalPctChange,
  expenses,
  onExpensesChange,
  tdsPct,
  onTdsPctChange,
  gstPct,
  onGstPctChange,
}: BusinessInputsProps) {
  return (
    <View>
      <Toggle
        label="How Is Profit Taxed?"
        options={[
          { label: "Professional", value: "presumptive_profession" },
          { label: "Business", value: "presumptive_business" },
          { label: "Full Books", value: "regular" },
        ]}
        value={scheme}
        onChange={(v) => onSchemeChange(v as BusinessScheme)}
      />
      <InlineNote>{SCHEME_HELP[scheme]}</InlineNote>

      <Input
        label="Expected Annual Receipts (excluding GST)"
        value={receipts}
        onChangeText={onReceiptsChange}
        keyboardType="numeric"
        placeholder="e.g. 1800000"
        containerClassName="mb-3"
      />
      <Input
        label={scheme === "regular" ? "Business Expenses (Annual)" : "Business Expenses (Annual, for in-hand only)"}
        value={expenses}
        onChangeText={onExpensesChange}
        keyboardType="numeric"
        placeholder="0"
        containerClassName="mb-3"
      />
      <View className="flex-row">
        <View className="flex-1 mr-2">
          <Input
            label="Digital Receipts %"
            value={digitalPct}
            onChangeText={onDigitalPctChange}
            keyboardType="numeric"
            placeholder="100"
          />
        </View>
        <View className="flex-1 mr-2">
          <Input
            label="TDS by Clients %"
            value={tdsPct}
            onChangeText={onTdsPctChange}
            keyboardType="numeric"
            placeholder="0"
          />
        </View>
        <View className="flex-1">
          <Input
            label="GST Charged %"
            value={gstPct}
            onChangeText={onGstPctChange}
            keyboardType="numeric"
            placeholder="0"
          />
        </View>
      </View>
      <Text className="text-xs text-faint-foreground mt-2">
        Digital = UPI, bank transfer, cheque or card. TDS is usually 10% on professional fees and
        1–2% on contracts. GST is only used to read your bank credits correctly - it is never income.
      </Text>
    </View>
  );
}

// ─── Warnings ─────────────────────────────────────────────

export function BusinessWarnings({ business }: { business: BusinessIncomeCalculation }) {
  return (
    <>
      {business.exceedsPresumptiveLimit && business.presumptiveLimit !== null && (
        <InlineNote tone="warning" icon="alert-circle-outline">
          Receipts are above the {formatAmount(business.presumptiveLimit)} limit for the presumptive
          scheme, so tax is worked out on actual profit instead. A tax audit may apply - check with
          your CA.
        </InlineNote>
      )}
      {business.actualBelowDeemed && (
        <InlineNote tone="warning" icon="alert-circle-outline">
          Your actual profit ({formatAmount(business.actualProfit)}) is below the presumptive profit
          ({formatAmount(business.taxableProfit)}). Declaring less than the presumptive figure needs
          a tax audit, so this estimate uses the presumptive profit.
        </InlineNote>
      )}
    </>
  );
}

// ─── Results ──────────────────────────────────────────────

export function BusinessResults({
  business,
  receipts,
  expenses,
}: {
  business: BusinessIncomeCalculation;
  receipts: number;
  expenses: number;
}) {
  const theme = useTheme();
  const tax =
    business.selectedRegime === "new" ? business.newRegimeTax.totalTax : business.oldRegimeTax.totalTax;

  return (
    <>
      <Card className="mb-4">
        <View className="items-center py-2">
          <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground mb-1">
            Monthly In-Hand
          </Text>
          <Text className="text-3xl font-bold text-success">{formatAmount(business.monthlyInHand)}</Text>
          <Text className="text-sm text-muted-foreground mt-0.5">
            {formatAmount(business.annualInHand)} / year
          </Text>
          <View className="mt-2 px-3 py-1 rounded-full" style={{ backgroundColor: theme.alpha("primary", 0.08) }}>
            <Text className="text-xs" style={{ color: theme.primary }}>
              Best regime: {business.selectedRegime === "new" ? "New" : "Old"} Tax Regime
            </Text>
          </View>
        </View>
      </Card>

      <Card title="Business Income" className="mb-4">
        <BusinessWarnings business={business} />
        <BreakdownRow label="Receipts" annual={receipts} monthly={receipts / 12} />
        <BreakdownRow label="Business Expenses" annual={-expenses} />
        {business.professionalTaxAnnual > 0 && (
          <BreakdownRow label="Professional Tax" annual={-business.professionalTaxAnnual} />
        )}
        <BreakdownRow label="Income Tax" annual={-tax} />
        <View className="border-t border-border my-1" />
        <BreakdownRow label="In-Hand" annual={business.annualInHand} monthly={business.monthlyInHand} highlight />
        <View className="border-t border-border my-1" />
        <BreakdownRow
          label={business.appliedScheme === "regular" ? "Taxable Profit" : "Presumptive Profit"}
          annual={business.taxableProfit}
        />
        {business.tdsCredit > 0 && (
          <BreakdownRow label="TDS Withheld by Clients" annual={business.tdsCredit} />
        )}
      </Card>
    </>
  );
}

// ─── Advance Tax ──────────────────────────────────────────

export function AdvanceTaxCard({
  plan,
  title = "Advance Tax",
  footnote,
}: {
  plan: AdvanceTaxPlan;
  title?: string;
  footnote?: string;
}) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  const today = todayIso();

  return (
    <Card title={title} className="mb-4">
      <BreakdownRow label="Income Tax for the Year" annual={plan.totalTax} />
      {plan.tdsCredit > 0 && <BreakdownRow label="Less: TDS by Clients" annual={-plan.tdsCredit} />}
      <View className="border-t border-border my-1" />
      <BreakdownRow label="You Pay Yourself" annual={plan.netPayable} highlight />

      {plan.refundExpected > 0 && (
        <InlineNote tone="success" icon="arrow-undo-outline" className="mt-2">
          TDS is {formatAmount(plan.refundExpected)} more than your tax. It comes back as a refund
          after you file your return.
        </InlineNote>
      )}

      {!plan.required && plan.refundExpected === 0 && (
        <InlineNote className="mt-2">
          No advance tax needed - it only applies when the tax left after TDS is ₹10,000 or more.
          Pay any balance when you file your return.
        </InlineNote>
      )}

      {plan.required && (
        <View className="mt-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Instalments
          </Text>
          {plan.instalments.map((inst) => {
            const past = inst.dueDate < today;
            return (
              <View key={inst.dueDate} className="flex-row items-center py-1.5">
                <Ionicons
                  name={past ? "checkmark-circle-outline" : "calendar-outline"}
                  size={14}
                  color={past ? colors.textSecondary : theme.primary}
                />
                <Text className={`text-sm ml-2 flex-1 ${past ? "text-muted-foreground" : "text-foreground"}`}>
                  {formatDate(inst.dueDate)}
                  <Text className="text-xs text-faint-foreground">  ({inst.cumulativePct}% by then)</Text>
                </Text>
                <Text className="text-sm font-medium text-foreground">{formatAmount(inst.amount)}</Text>
              </View>
            );
          })}
          <Text className="text-xs text-faint-foreground mt-1">
            {plan.instalments.length === 1
              ? "Presumptive scheme: the whole amount can be paid by 15 March. Late payment costs 1% a month interest."
              : "Late or short payment costs 1% a month interest."}
          </Text>
        </View>
      )}

      {footnote ? <Text className="text-xs text-faint-foreground mt-2">{footnote}</Text> : null}
    </Card>
  );
}

// ─── Actual receipts vs expected (Phase 3) ────────────────

export interface ReceiptAccountOption {
  id: string;
  label: string;
}

export interface ReceiptsTrackerProps {
  accounts: ReceiptAccountOption[];
  selectedIds: string[];
  onToggleAccount: (id: string) => void;
  /** Bank credits into the selected accounts, FY start → today. Null while loading. */
  bankCredits: number | null;
  creditCount: number;
  /** Bank credits turned back into receipts (GST and TDS undone). */
  receiptsSoFar: number;
  /** Expected receipts pro-rated to today. */
  expectedSoFar: number;
  /** Share of the FY elapsed, 0–1. */
  fyFraction: number;
  /** Full-year receipts at the current pace. Null until enough of the year has passed. */
  projectedAnnual: number | null;
  /** Tax for the year at the projected pace, and how much advance tax is due by today. */
  projectedTax: number | null;
  projectedDueByNow: number | null;
  onUseProjected: () => void;
}

export function ReceiptsTracker({
  accounts,
  selectedIds,
  onToggleAccount,
  bankCredits,
  creditCount,
  receiptsSoFar,
  expectedSoFar,
  fyFraction,
  projectedAnnual,
  projectedTax,
  projectedDueByNow,
  onUseProjected,
}: ReceiptsTrackerProps) {
  const theme = useTheme();
  const gap = receiptsSoFar - expectedSoFar;
  const ahead = gap >= 0;

  return (
    <Card title="Actual Receipts This Year" className="mb-4">
      <Text className="text-xs text-muted-foreground mb-2">
        Pick the accounts your clients pay into. Arth adds up credits there (not refunds, transfers
        between your own accounts, or family settlements) and compares them with your estimate.
      </Text>
      {accounts.length === 0 ? (
        <InlineNote>Add a bank account in Settings → Accounts to track receipts.</InlineNote>
      ) : (
        <View className="flex-row flex-wrap mb-2">
          {accounts.map((a) => (
            <View key={a.id} className="mb-2">
              <FilterChip
                label={a.label}
                active={selectedIds.includes(a.id)}
                onPress={() => onToggleAccount(a.id)}
              />
            </View>
          ))}
        </View>
      )}

      {selectedIds.length > 0 && bankCredits !== null && (
        <>
          <BreakdownRow label={`Bank Credits (${creditCount})`} annual={bankCredits} />
          <BreakdownRow label="Receipts So Far (excl. GST, before TDS)" annual={receiptsSoFar} highlight />
          <BreakdownRow label={`Expected by Now (${Math.round(fyFraction * 100)}% of year)`} annual={expectedSoFar} />
          <View
            className="flex-row items-center px-3 py-2 rounded-lg mt-2"
            style={{ backgroundColor: theme.alpha(ahead ? "success" : "warning", 0.08) }}
          >
            <Ionicons
              name={ahead ? "trending-up-outline" : "trending-down-outline"}
              size={16}
              color={ahead ? theme.success : theme.warning}
            />
            <Text className="text-xs ml-2 flex-1" style={{ color: ahead ? theme.success : theme.warning }}>
              {ahead ? "Ahead of" : "Behind"} your estimate by {formatAmount(Math.abs(gap))}
            </Text>
          </View>

          {projectedAnnual !== null ? (
            <View className="mt-3">
              <BreakdownRow label="Full Year at This Pace" annual={projectedAnnual} highlight />
              {projectedTax !== null && <BreakdownRow label="Tax at This Pace" annual={projectedTax} />}
              {projectedDueByNow !== null && projectedDueByNow > 0 && (
                <BreakdownRow label="Advance Tax Due by Now" annual={projectedDueByNow} />
              )}
              <View className="mt-2">
                <Button title="Use This as My Estimate" variant="outline" onPress={onUseProjected} />
              </View>
            </View>
          ) : (
            <Text className="text-xs text-faint-foreground mt-2">
              A full-year projection appears once about a month of the year has passed.
            </Text>
          )}
        </>
      )}
    </Card>
  );
}
