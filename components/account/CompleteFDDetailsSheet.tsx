import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Pressable, ScrollView, FlatList } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Input, Sheet, Text } from "@/components/ui";
import { CalendarModal } from "@/components/ui/CalendarModal";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import {
  completeFDDetails,
  updateFDDetails,
  setFDMaturityOverride,
  linkFDToBucket,
  unlinkFDFromBucket,
  type InvestmentProduct,
} from "@/services/investment-accounts";
import { computeFDMaturityValue, type CompoundingFreq, type InterestMethod } from "@/services/investment-engine";
import { getSelectableInvestmentBuckets, type InvestmentBucket } from "@/services/yearly-plan";
import { getCurrentFY, getFYLabel } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";
import { formatDate } from "@/utils/date";
import { formatError } from "@/utils/error-message";
import { useTheme } from "@/hooks/use-theme";

const COMPOUNDING_OPTIONS: { value: CompoundingFreq; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annually", label: "Annually" },
];

interface CompleteFDDetailsSheetProps {
  visible: boolean;
  product: InvestmentProduct;
  /** False once any schedule entry has materialised — rate/maturity become read-only, only the bucket link and the maturity override stay editable. */
  editable: boolean;
  onDone: () => void;
  onClose: () => void;
}

/**
 * Fills in (first time) or edits (afterwards) an FD's interest rate,
 * method, compounding, and maturity date, plus its optional investment-bucket
 * link and a manual maturity-amount correction.
 *
 * First-time completion (product.interest_rate_pa == null, from
 * createFDAccountShell's "Mark as Fixed Deposit" quick-create) calls
 * completeFDDetails. Editing an already-completed FD calls updateFDDetails
 * instead, which regenerates the schedule — blocked once `editable` is false
 * (a schedule entry has already materialised, i.e. money has moved).
 */
export function CompleteFDDetailsSheet({
  visible,
  product,
  editable,
  onDone,
  onClose,
}: CompleteFDDetailsSheetProps) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  const alert = useAlert();

  const isFirstTime = product.interest_rate_pa == null;

  const [interestRate, setInterestRate] = useState("");
  const [interestMethod, setInterestMethod] = useState<InterestMethod>("compound");
  const [compoundingFreq, setCompoundingFreq] = useState<CompoundingFreq>("quarterly");
  const [maturityDate, setMaturityDate] = useState("");
  const [showMaturityPicker, setShowMaturityPicker] = useState(false);
  const [maturityOverride, setMaturityOverride] = useState("");
  const [buckets, setBuckets] = useState<InvestmentBucket[]>([]);
  const [bucketId, setBucketId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setInterestRate(product.interest_rate_pa != null ? String(product.interest_rate_pa) : "");
    setInterestMethod(product.interest_method ?? "compound");
    setCompoundingFreq(product.compounding_freq ?? "quarterly");
    setMaturityDate(product.maturity_date ?? "");
    setMaturityOverride(product.maturity_amount_override != null ? String(product.maturity_amount_override) : "");
    setBucketId(product.investment_bucket_id);
  }, [visible, product]);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        const startMonth = getFYStartMonth();
        const currentFY = String(getCurrentFY(startMonth));
        // Current-FY-onward only — a past-FY bucket's target has already
        // closed out, so it's not a valid destination for a new link.
        // Exception: if this FD is already linked to a past-FY bucket, keep
        // that one in the list too (as the only option pre-selected) so the
        // existing link is visible and can still be explicitly unlinked,
        // rather than silently vanishing from the picker.
        const list = await getSelectableInvestmentBuckets(DEFAULT_USER_ID);
        if (product.investment_bucket_id && !list.some((b) => b.id === product.investment_bucket_id)) {
          const { getInvestmentBucketById } = await import("@/services/yearly-plan");
          const linked = await getInvestmentBucketById(product.investment_bucket_id);
          if (linked) list.unshift(linked);
        }
        // Current-FY first — buckets across years can share a name (e.g. a
        // recurring "Tax saver" bucket every year), so without this a user
        // can't tell which year's bucket they're about to link to.
        list.sort((a, b) => {
          const aCur = a.financial_year === currentFY ? 1 : 0;
          const bCur = b.financial_year === currentFY ? 1 : 0;
          if (aCur !== bCur) return bCur - aCur;
          return (b.financial_year ?? "").localeCompare(a.financial_year ?? "");
        });
        setBuckets(list);
      } catch {
        setBuckets([]);
      }
    })();
  }, [visible, product.investment_bucket_id]);

  const handleClose = useCallback(() => onClose(), [onClose]);

  const computedMaturity = useMemo(() => {
    const r = parseFloat(interestRate);
    if (!(r > 0) || !maturityDate || product.principal == null || !product.start_date) return null;
    return computeFDMaturityValue({
      principal: product.principal,
      interest_rate_pa: r,
      start_date: product.start_date,
      maturity_date: maturityDate,
      interest_method: interestMethod,
      compounding_freq: compoundingFreq,
    });
  }, [interestRate, maturityDate, interestMethod, compoundingFreq, product.principal, product.start_date]);

  const handleSave = useCallback(async () => {
    const errors: string[] = [];
    const r = parseFloat(interestRate);
    if (editable) {
      if (!(r > 0)) errors.push("Interest rate must be a positive number.");
      if (!maturityDate) errors.push("Maturity date is required.");
      else if (product.start_date && maturityDate <= product.start_date) errors.push("Maturity date must be after the start date.");
      if (interestMethod === "compound" && !compoundingFreq) errors.push("Compounding frequency is required for compound interest.");
    }
    const overrideTrimmed = maturityOverride.trim();
    const overrideValue = overrideTrimmed ? parseFloat(overrideTrimmed) : null;
    if (overrideTrimmed && !(overrideValue! > 0)) errors.push("Corrected maturity amount must be a positive number.");

    if (errors.length > 0) {
      alert("Fix these fields", errors.join("\n"));
      return;
    }

    setSaving(true);
    try {
      if (editable) {
        const details = {
          interest_rate_pa: r,
          interest_method: interestMethod,
          compounding_freq: interestMethod === "compound" ? compoundingFreq : undefined,
          maturity_date: maturityDate,
        };
        if (isFirstTime) {
          await completeFDDetails(product.financial_account_id, details);
        } else {
          await updateFDDetails(product.financial_account_id, details);
        }
      }

      await setFDMaturityOverride(product.financial_account_id, overrideValue);

      if (bucketId !== product.investment_bucket_id) {
        if (product.investment_bucket_id) {
          await unlinkFDFromBucket(product.financial_account_id);
        }
        if (bucketId) {
          await linkFDToBucket(product.financial_account_id, bucketId);
        }
      }

      onDone();
    } catch (e) {
      alert("Couldn't save", formatError("Fixed deposit details", e));
    } finally {
      setSaving(false);
    }
  }, [
    editable, isFirstTime, interestRate, maturityDate, interestMethod, compoundingFreq, maturityOverride,
    bucketId, product, alert, onDone,
  ]);

  if (!visible) return null;

  return (
    <Sheet visible={visible} onClose={handleClose}>
      <View className="px-5 pb-3">
        <Text className="text-base font-bold" style={{ color: colors.text }}>
          {isFirstTime ? "Complete Fixed Deposit Details" : "Edit Fixed Deposit"}
        </Text>
        <Text className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>
          {product.start_date ? `Started ${formatDate(product.start_date)}. ` : ""}
          {editable ? "Update the rate and maturity date to recompute its schedule." : "This FD has matured — rate and maturity are locked, but you can still correct the amount or the bucket link."}
        </Text>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
        <View className="px-5">
          <Input
            label="Interest rate (% per year)"
            value={interestRate}
            onChangeText={setInterestRate}
            placeholder="e.g. 7.1"
            keyboardType="numeric"
            editable={editable}
            containerClassName="mb-3"
          />

          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Interest type
          </Text>
          <View className="flex-row gap-2 mb-3">
            {([{ value: "compound", label: "Compound" }, { value: "simple", label: "Simple" }] as const).map((opt) => {
              const active = interestMethod === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => editable && setInterestMethod(opt.value)}
                  className="flex-1 py-2.5 rounded-xl items-center border"
                  style={{
                    backgroundColor: active ? theme.primary + "20" : colors.surface,
                    borderColor: active ? theme.primary : colors.border,
                    opacity: editable ? 1 : 0.6,
                  }}
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
              <View className="flex-row gap-2 mb-3">
                {COMPOUNDING_OPTIONS.map((opt) => {
                  const active = compoundingFreq === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => editable && setCompoundingFreq(opt.value)}
                      className="flex-1 py-2.5 rounded-xl items-center border"
                      style={{
                        backgroundColor: active ? theme.primary + "20" : colors.surface,
                        borderColor: active ? theme.primary : colors.border,
                        opacity: editable ? 1 : 0.6,
                      }}
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

          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Matures
          </Text>
          <Pressable
            onPress={() => editable && setShowMaturityPicker(true)}
            className="flex-row items-center justify-between border border-border rounded-lg px-3 py-3 mb-3"
            style={{ opacity: editable ? 1 : 0.6 }}
          >
            <Text className="text-sm" style={{ color: maturityDate ? colors.text : colors.textSecondary }}>
              {maturityDate ? formatDate(maturityDate) : "Select maturity date"}
            </Text>
            <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
          </Pressable>

          {computedMaturity != null && (
            <View className="rounded-xl px-4 py-3 mb-3" style={{ backgroundColor: theme.alpha("primary", 0.08) }}>
              <View className="flex-row justify-between">
                <Text className="text-xs" style={{ color: colors.textSecondary }}>Computed maturity amount</Text>
                <Text className="text-sm font-bold" style={{ color: colors.text }}>{formatAmount(computedMaturity)}</Text>
              </View>
              {product.principal != null && (
                <Text className="text-xs mt-1" style={{ color: colors.textSecondary }}>
                  Interest: {formatAmount(computedMaturity - product.principal)}
                </Text>
              )}
            </View>
          )}

          <Input
            label="Correct maturity amount (optional)"
            value={maturityOverride}
            onChangeText={setMaturityOverride}
            placeholder="Use if your bank's actual figure differs"
            keyboardType="numeric"
            containerClassName="mb-3"
          />

          {buckets.length > 0 && (
            <View className="mt-1 mb-3">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Investment bucket (optional)
              </Text>
              <Pressable
                onPress={() => setBucketId(null)}
                className="flex-row items-center py-2 px-2 rounded-md"
                style={{ backgroundColor: bucketId === null ? theme.primary + "1A" : "transparent" }}
              >
                <Ionicons name="close-circle-outline" size={16} color={bucketId === null ? theme.primary : colors.textSecondary} />
                <Text className="flex-1 ml-2 text-sm" style={{ color: colors.text, fontWeight: bucketId === null ? "600" : "400" }}>
                  Don't link
                </Text>
                {bucketId === null && <Ionicons name="checkmark" size={16} color={theme.primary} />}
              </Pressable>
              <FlatList
                data={buckets}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
                renderItem={({ item }) => {
                  const active = bucketId === item.id;
                  const fyNum = parseInt(item.financial_year ?? "0", 10);
                  const fyLabel = fyNum > 0 ? getFYLabel(fyNum, getFYStartMonth()) : "No FY";
                  return (
                    <Pressable
                      onPress={() => setBucketId(item.id)}
                      className="flex-row items-center py-2 px-2 rounded-md"
                      style={{ backgroundColor: active ? theme.primary + "1A" : "transparent" }}
                    >
                      <Ionicons name="bookmark-outline" size={16} color={active ? theme.primary : colors.textSecondary} />
                      <View className="flex-1 ml-2">
                        <Text className="text-sm" style={{ color: colors.text, fontWeight: active ? "600" : "400" }} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text className="text-label" style={{ color: colors.textSecondary }}>{fyLabel}</Text>
                      </View>
                      <Text className="text-xs" style={{ color: colors.textSecondary }}>
                        {formatAmount(item.current_contributed)} / {formatAmount(item.annual_target)}
                      </Text>
                    </Pressable>
                  );
                }}
              />
            </View>
          )}
        </View>
      </ScrollView>

      <View className="flex-row px-5 pt-3 pb-1 gap-3">
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          className="flex-1 py-3 rounded-xl items-center"
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
        >
          <Text className="text-sm font-semibold" style={{ color: colors.textSecondary }}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          accessibilityRole="button"
          className="flex-1 py-3 rounded-xl items-center"
          style={{ backgroundColor: theme.primary, opacity: saving ? 0.6 : 1 }}
        >
          <Text className="text-sm font-semibold text-primary-foreground">{saving ? "Saving…" : "Save"}</Text>
        </Pressable>
      </View>

      <CalendarModal
        visible={showMaturityPicker}
        onClose={() => setShowMaturityPicker(false)}
        value={maturityDate || product.start_date || ""}
        onChange={(d) => {
          setMaturityDate(d);
          setShowMaturityPicker(false);
        }}
        maximumDate={null}
      />
    </Sheet>
  );
}
