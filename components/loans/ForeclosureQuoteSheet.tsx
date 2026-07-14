import { useCallback, useEffect, useMemo } from "react";
import { View, Text, Pressable, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { Button } from "@/components/ui";
import { formatAmount } from "@/utils/format";
import {
  type LoanAccount,
  type LoanScheduleEntry,
  type LoanPrepaymentRow,
  loanToParams,
  loanToTerms,
} from "@/services/loan-accounts";
import { computeForeclosureQuote } from "@/services/loan-engine";

/**
 * ForeclosureQuoteSheet (v17.1.0)
 *
 * Non-binding quote. Shows the full cost of closing the loan today:
 * principal outstanding + accrued interest + charge + GST, minus what the
 * user would've paid if they ran to term.
 *
 * If the user wants to actually foreclose, they tap "Record foreclosure" —
 * the parent records it as a prepayment with kind='foreclosure'.
 */

interface Props {
  visible: boolean;
  loan: LoanAccount;
  schedule: LoanScheduleEntry[];
  prepayments: LoanPrepaymentRow[];
  onForeclose: (payload: {
    prepayment_date: string;
    amount: number;
    prepayment_charge: number;
    gst_on_charge: number;
  }) => void;
  onClose: () => void;
}

export function ForeclosureQuoteSheet({
  visible,
  loan,
  schedule,
  prepayments,
  onForeclose,
  onClose,
}: Props) {
  const { colors } = useColorScheme();
  const insets = useSafeAreaInsets();
  const slideAnim = useSharedValue(500);
  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    if (visible) slideAnim.value = withTiming(0, { duration: 250 });
  }, [visible, slideAnim]);

  const handleClose = useCallback(() => {
    slideAnim.value = withTiming(500, { duration: 200 }, () => {
      runOnJS(onClose)();
    });
  }, [slideAnim, onClose]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: slideAnim.value }],
  }));

  const quote = useMemo(() => {
    try {
      return computeForeclosureQuote(
        { ...loanToParams(loan), ...loanToTerms(loan) },
        schedule.map((e) => ({
          id: e.id,
          installment_num: e.installment_num,
          due_date: e.due_date,
          opening_principal: e.opening_principal,
          emi_amount: e.emi_amount,
          principal_component: e.principal_component,
          interest_component: e.interest_component,
          closing_principal: e.closing_principal,
          status: e.status,
        })),
        prepayments.map((p) => ({
          prepayment_date: p.prepayment_date,
          amount: p.amount,
          prepayment_charge: p.prepayment_charge,
          gst_on_charge: p.gst_on_charge,
          kind: p.kind,
          strategy: p.strategy ?? undefined,
        })),
        today,
      );
    } catch {
      return null;
    }
  }, [loan, schedule, prepayments, today]);

  const formatMoney = (n: number) =>
    loan.currency === "INR"
      ? formatAmount(n)
      : `${loan.currency} ${n.toLocaleString()}`;

  if (!visible || !quote) return null;

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={handleClose}>
      <Pressable
        className="flex-1 bg-black/40"
        onPress={handleClose}
        accessibilityLabel="Close"
        accessibilityRole="button"
      />
      <Animated.View
        style={[
          animStyle,
          {
            backgroundColor: colors.surface,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: "80%",
            paddingBottom: Math.max(insets.bottom, 8),
          },
        ]}
      >
        <View className="items-center pt-3 pb-1">
          <View className="w-10 h-1 rounded-full bg-border-light dark:bg-border-dark" />
        </View>
        <View className="px-5 pb-3">
          <Text className="text-base font-bold" style={{ color: colors.text }}>
            Foreclosure Quote
          </Text>
          <Text className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>
            Close this loan today. Quote valid for {today}.
          </Text>
        </View>
        <View className="px-5">
          <View
            className="p-4 rounded-xl"
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
          >
            <Row label="Principal outstanding" value={formatMoney(quote.principalOutstanding)} />
            <Row label="Interest accrued (from last EMI)" value={formatMoney(quote.interestAccruedToDate)} />
            <Row
              label="Prepayment charge"
              value={quote.prepaymentCharge > 0 ? formatMoney(quote.prepaymentCharge) : "- waived"}
              color={quote.prepaymentCharge === 0 ? "success" : undefined}
            />
            {quote.gst > 0 && <Row label="GST" value={formatMoney(quote.gst)} />}
            <View className="border-t border-border-light dark:border-border-dark my-2" />
            <Row
              label="Total to pay"
              value={formatMoney(quote.totalToPay)}
              bold
              color="danger"
            />
            <View className="border-t border-border-light dark:border-border-dark my-2" />
            <Row
              label="Interest saved vs running to term"
              value={formatMoney(quote.interestSavedVsTerm)}
              color="success"
            />
            <Row label="Months saved" value={`${quote.monthsSaved}`} color="success" />
          </View>
        </View>
        <View className="px-5 pt-3 flex-row gap-2">
          <View className="flex-1">
            <Button title="Close" variant="outline" onPress={handleClose} />
          </View>
          <View className="flex-1">
            <Button
              title="Record Foreclosure"
              onPress={() =>
                onForeclose({
                  prepayment_date: today,
                  amount: quote.principalOutstanding + quote.interestAccruedToDate,
                  prepayment_charge: quote.prepaymentCharge,
                  gst_on_charge: quote.gst,
                })
              }
            />
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

function Row({
  label,
  value,
  color,
  bold,
}: {
  label: string;
  value: string;
  color?: "success" | "danger";
  bold?: boolean;
}) {
  const { colors, colorScheme } = useColorScheme();
  const valueColor =
    color === "success"
      ? StatusColors[colorScheme].success
      : color === "danger"
        ? StatusColors[colorScheme].danger
        : colors.text;
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <Text className="text-sm" style={{ color: colors.textSecondary }}>
        {label}
      </Text>
      <Text
        className={`text-sm ${bold ? "font-bold text-lg" : "font-medium"}`}
        style={{ color: valueColor }}
      >
        {value}
      </Text>
    </View>
  );
}
