import { useCallback, useMemo, useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SegmentedControl } from "@/components/motion";
import { Card, Input, LoadingState, PeriodNavigator, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getActiveAccounts } from "@/services/financial-account";
import {
  batchInvestmentProducts,
  getUnifiedInvestmentValues,
  isDematLikeAccount,
  isPensionLikeAccount,
  withoutFinishedInvestments,
} from "@/services/investment-accounts";
import {
  combineProjections,
  defaultReturnPct,
  inTodaysMoney,
  loadAssumptions,
  loadProjectionPlan,
  projectInvestment,
  saveAssumption,
  saveProjectionPlan,
  type ProjectionAssumption,
  type StepUp,
} from "@/services/investment-projections";
import { getCurrentMonth } from "@/services/budget";
import { formatMonthLabel } from "@/utils/date";
import { formatAmount } from "@/utils/expense-validation";

const HORIZONS = [1, 3, 5, 10, 15, 20, 30];
/** What the edit box is open for when it's the extra money, not an investment you already have. */
const EXTRA = "extra";

interface Line {
  id: string;
  name: string;
  value: number;
  fallback: number;
}

const amountOf = (text: string) => Math.max(0, parseFloat(text.replace(/,/g, "")) || 0);

/** "₹10,000 a month, rising 10% a year · 1 lump sum · 12% a year", shortest form that's still clear. */
function describe(a: ProjectionAssumption, withReturn: boolean): string {
  const parts: string[] = [];
  if (a.monthly > 0) {
    const rise = a.stepUp && a.stepUp.value > 0 ? (a.stepUp.kind === "pct" ? `, rising ${a.stepUp.value}% a year` : `, rising ${formatAmount(a.stepUp.value)} a year`) : "";
    parts.push(`${formatAmount(a.monthly)} a month${rise}`);
  }
  if (a.lumpSums.length > 0) parts.push(`${a.lumpSums.length} lump ${a.lumpSums.length === 1 ? "sum" : "sums"}`);
  if (withReturn) parts.push(`${a.returnPct}% a year`);
  return parts.join(" · ");
}

/** Where your investments could get to, with more money going in, in the future's rupees and today's. */
export default function ProjectionsScreen() {
  const theme = useTheme();
  const [lines, setLines] = useState<Line[] | null>(null);
  const [assumptions, setAssumptions] = useState(loadAssumptions);
  const [plan, setPlan] = useState(loadProjectionPlan);
  const [years, setYears] = useState(10);
  /** A bar that's been tapped, as months from now. Null shows the end of the period. */
  const [picked, setPicked] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [returnText, setReturnText] = useState("");
  const [monthlyText, setMonthlyText] = useState("");
  const [stepKind, setStepKind] = useState<StepUp["kind"]>("pct");
  const [stepText, setStepText] = useState("");
  const [lumps, setLumps] = useState<ProjectionAssumption["lumpSums"]>([]);
  const [lumpAmount, setLumpAmount] = useState("");
  const [lumpMonth, setLumpMonth] = useState(getCurrentMonth());
  const [inflationOpen, setInflationOpen] = useState(false);
  const [inflationText, setInflationText] = useState("");

  useDataRefresh(
    useCallback(async () => {
      const all = await getActiveAccounts(DEFAULT_USER_ID);
      const like = all.filter((a) => a.account_type === "investment" || a.account_type === "demat" || a.account_type === "pension");
      const products = await batchInvestmentProducts(like.filter((a) => a.account_type === "investment").map((a) => a.id));
      const accounts = withoutFinishedInvestments(like, products);
      const values = await getUnifiedInvestmentValues(DEFAULT_USER_ID, accounts, products);
      setLines(
        accounts.map((a) => {
          const product = products.get(a.id);
          const kind = isDematLikeAccount(a, product) ? "market" : isPensionLikeAccount(a, product) ? "pension" : "fd";
          return {
            id: a.id,
            name: a.account_label || a.bank_name,
            value: values.get(a.id) ?? 0,
            fallback: defaultReturnPct(kind, product?.interest_rate_pa),
          };
        }),
      );
    }, []),
  );

  const startMonth = getCurrentMonth();
  const assumptionFor = useCallback(
    (l: Line): ProjectionAssumption => assumptions[l.id] ?? { returnPct: l.fallback, monthly: 0, lumpSums: [] },
    [assumptions],
  );

  const projections = useMemo(
    () => (lines ?? []).map((l) => ({ line: l, points: projectInvestment(l.value, assumptionFor(l), years * 12, startMonth) })),
    [lines, assumptionFor, years, startMonth],
  );
  const extra = useMemo(() => projectInvestment(0, plan.extra, years * 12, startMonth), [plan.extra, years, startMonth]);
  const total = useMemo(() => combineProjections([...projections.map((p) => p.points), extra]), [projections, extra]);
  const shownPoint = (picked != null ? total[picked] : null) ?? total[total.length - 1];
  const shownMonth = shownPoint?.month ?? 0;
  const shownYears = shownMonth / 12;
  const extraAdds = extra[shownMonth]?.value ?? 0;
  const yearly = useMemo(() => total.filter((p) => p.month > 0 && p.month % 12 === 0), [total]);
  const shown = useMemo(() => {
    const step = Math.max(1, Math.ceil(yearly.length / 10));
    return yearly.filter((p, i) => (yearly.length - 1 - i) % step === 0);
  }, [yearly]);
  const tallest = Math.max(1, ...shown.map((p) => p.value));

  const open = (id: string, name: string, a: ProjectionAssumption) => {
    setReturnText(String(a.returnPct));
    setMonthlyText(a.monthly > 0 ? String(a.monthly) : "");
    setStepKind(a.stepUp?.kind ?? "pct");
    setStepText(a.stepUp && a.stepUp.value > 0 ? String(a.stepUp.value) : "");
    setLumps(a.lumpSums);
    setLumpAmount("");
    setLumpMonth(startMonth);
    setEditing({ id, name });
  };

  const save = () => {
    if (!editing) return;
    const stepValue = amountOf(stepText);
    const next: ProjectionAssumption = {
      returnPct: amountOf(returnText),
      monthly: amountOf(monthlyText),
      lumpSums: lumps,
      ...(stepValue > 0 ? { stepUp: { kind: stepKind, value: stepValue } } : {}),
    };
    if (editing.id === EXTRA) {
      const nextPlan = { ...plan, extra: next };
      saveProjectionPlan(nextPlan);
      setPlan(nextPlan);
    } else {
      saveAssumption(editing.id, next);
      setAssumptions(loadAssumptions());
    }
    setEditing(null);
  };

  const addLump = () => {
    const amount = amountOf(lumpAmount);
    if (!(amount > 0)) return;
    setLumps((p) => [...p, { month: lumpMonth, amount }]);
    setLumpAmount("");
  };

  const clearExtra = () => {
    const nextPlan = { ...plan, extra: { returnPct: plan.extra.returnPct, monthly: 0, lumpSums: [] } };
    saveProjectionPlan(nextPlan);
    setPlan(nextPlan);
  };

  const saveInflation = () => {
    const nextPlan = { ...plan, inflationPct: amountOf(inflationText) };
    saveProjectionPlan(nextPlan);
    setPlan(nextPlan);
    setInflationOpen(false);
  };

  if (!lines) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Working it out..." icon="trending-up-outline" />
      </ScreenContainer>
    );
  }

  const hasExtra = plan.extra.monthly > 0 || plan.extra.lumpSums.length > 0;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3" style={{ flexGrow: 0 }}>
          {HORIZONS.map((y) => {
            const on = y === years;
            return (
              <Pressable
                key={y}
                onPress={() => {
                  setYears(y);
                  setPicked(null);
                }}
                className="px-3.5 py-1.5 rounded-full mr-2 border"
                style={{ borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.alpha("primary", 0.1) : "transparent" }}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
              >
                <Text className="text-xs font-medium" style={{ color: on ? theme.primary : theme.mutedForeground }}>
                  {y} {y === 1 ? "year" : "years"}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {shownPoint && (
          <Card className="mb-3">
            <Text className="text-xs text-muted-foreground">Projected value, in {shownYears} {shownYears === 1 ? "year" : "years"}</Text>
            <Text className="text-title font-bold text-foreground mt-0.5">{formatAmount(Math.round(shownPoint.value))}</Text>
            <Pressable
              onPress={() => {
                setInflationText(String(plan.inflationPct));
                setInflationOpen(true);
              }}
              className="flex-row items-center mt-0.5"
              accessibilityRole="button"
              accessibilityLabel={`Worth ${formatAmount(Math.round(inTodaysMoney(shownPoint.value, shownMonth, plan.inflationPct)))} in today's money at ${plan.inflationPct} percent inflation. Change inflation`}
            >
              <Text className="text-sm text-foreground">
                {formatAmount(Math.round(inTodaysMoney(shownPoint.value, shownMonth, plan.inflationPct)))} in today's money
              </Text>
              <Text className="text-xs ml-1.5" style={{ color: theme.primary }}>at {plan.inflationPct}% inflation</Text>
              <Ionicons name="pencil-outline" size={11} color={theme.primary} style={{ marginLeft: 3 }} />
            </Pressable>

            <View className="flex-row justify-between mt-3">
              <View>
                <Text className="text-label text-muted-foreground">Invested</Text>
                <Text className="text-sm font-semibold text-foreground">{formatAmount(Math.round(shownPoint.putIn))}</Text>
              </View>
              <View className="items-end">
                <Text className="text-label text-muted-foreground">Assumed growth</Text>
                <Text className="text-sm font-semibold" style={{ color: theme.success }}>{formatAmount(Math.round(shownPoint.value - shownPoint.putIn))}</Text>
              </View>
            </View>

            {/* A bar for each year: the solid part is your money, the rest is assumed growth. Tap one to read it. */}
            <View className="flex-row items-end mt-4" style={{ height: 110, gap: 4 }}>
              {shown.map((p) => (
                <Pressable
                  key={p.month}
                  onPress={() => setPicked(p.month)}
                  className="flex-1 rounded-t overflow-hidden justify-end"
                  style={{
                    height: `${(p.value / tallest) * 100}%`,
                    backgroundColor: theme.alpha("primary", p.month === shownMonth ? 0.45 : 0.22),
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`In ${p.month / 12} years, ${formatAmount(Math.round(p.value))}`}
                >
                  <View style={{ height: `${p.value > 0 ? (p.putIn / p.value) * 100 : 0}%`, backgroundColor: theme.primary, opacity: p.month === shownMonth ? 1 : 0.7 }} />
                </Pressable>
              ))}
            </View>
            <View className="flex-row mt-1" style={{ gap: 4 }}>
              {shown.map((p) => (
                <Text key={p.month} className="flex-1 text-label text-muted-foreground text-center" numberOfLines={1}>{p.month / 12}y</Text>
              ))}
            </View>
          </Card>
        )}

        {hasExtra ? (
          <Card className="mb-3">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-sm font-semibold text-foreground">Your extra investment</Text>
              <View className="flex-row items-center">
                <Pressable onPress={clearExtra} hitSlop={8} className="mr-4" accessibilityRole="button" accessibilityLabel="Remove your extra investment">
                  <Text className="text-xs font-medium text-muted-foreground">Remove</Text>
                </Pressable>
                <Pressable onPress={() => open(EXTRA, "Invest more", plan.extra)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Edit your extra investment">
                  <Text className="text-xs font-semibold" style={{ color: theme.primary }}>Edit</Text>
                </Pressable>
              </View>
            </View>
            {plan.extra.monthly > 0 && <ExtraRow label="Monthly SIP" value={formatAmount(plan.extra.monthly)} />}
            {plan.extra.monthly > 0 && plan.extra.stepUp && plan.extra.stepUp.value > 0 && (
              <ExtraRow
                label="Step-up every year"
                value={plan.extra.stepUp.kind === "pct" ? `${plan.extra.stepUp.value}%` : `${formatAmount(plan.extra.stepUp.value)} a month`}
              />
            )}
            {plan.extra.lumpSums.map((l, i) => (
              <ExtraRow key={`${l.month}-${i}`} label={`One-time, ${formatMonthLabel(l.month)}`} value={formatAmount(l.amount)} />
            ))}
            <ExtraRow label="Assumed return" value={`${plan.extra.returnPct}% a year`} />
            <View className="pt-2 mt-1.5 border-t border-border">
              <ExtraRow label={`You'd put in, over ${shownYears} ${shownYears === 1 ? "year" : "years"}`} value={formatAmount(Math.round(extra[shownMonth]?.putIn ?? 0))} />
              <View className="flex-row justify-between items-center py-0.5">
                <Text className="text-xs font-semibold text-muted-foreground">Adds to your projected value</Text>
                <Text className="text-sm font-bold" style={{ color: theme.success }}>+{formatAmount(Math.round(extraAdds))}</Text>
              </View>
            </View>
          </Card>
        ) : (
          <Pressable onPress={() => open(EXTRA, "Invest more", plan.extra)} accessibilityRole="button" accessibilityLabel="Invest more. See what a SIP, a step-up or a one-time amount could add">
            <Card className="mb-3">
              <View className="flex-row items-center">
                <View className="w-9 h-9 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                  <Ionicons name="add" size={20} color={theme.primary} />
                </View>
                <View className="flex-1 mr-2">
                  <Text className="text-sm font-semibold text-foreground">Invest more</Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">See what a SIP, a step-up or a one-time amount could add</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
              </View>
            </Card>
          </Pressable>
        )}

        {lines.length > 0 && <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 mt-1">Each investment</Text>}
        {projections.map(({ line, points }) => {
          const a = assumptionFor(line);
          const last = points[shownMonth] ?? points[points.length - 1];
          return (
            <Pressable key={line.id} onPress={() => open(line.id, line.name, a)} accessibilityRole="button" accessibilityLabel={`Change assumptions for ${line.name}`}>
              <Card className="mb-2">
                <View className="flex-row items-center">
                  <View className="flex-1 mr-2">
                    <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>{line.name}</Text>
                    <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>Now {formatAmount(Math.round(line.value))} · {describe(a, true)}</Text>
                  </View>
                  <Text className="text-sm font-bold text-foreground">{formatAmount(Math.round(last.value))}</Text>
                  <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} style={{ marginLeft: 4 }} />
                </View>
              </Card>
            </Pressable>
          );
        })}
        <Text className="text-xs text-muted-foreground mt-2">
          These are your own assumptions worked forward, not a forecast or financial advice. Real returns go up and down, and tax isn't taken off. A 12% return here means exactly 12% a year; many online calculators use 1% a month, which works out to 12.68%, so they show a little more.
        </Text>
      </ScrollView>

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable
          onPress={() => setEditing(null)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-start", paddingTop: 50, paddingHorizontal: 16, paddingBottom: 16 }}
        >
          <Pressable onPress={() => {}} style={{ flexShrink: 1 }}>
            <Card className="shrink">
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Text className="text-base font-semibold text-foreground mb-3" numberOfLines={1}>{editing?.name}</Text>
                <Input label="Add each month (SIP)" value={monthlyText} onChangeText={setMonthlyText} keyboardType="numeric" formula placeholder="0" containerClassName="mb-3" />
                {amountOf(monthlyText) > 0 && (
                  <>
                    <Text className="text-xs font-semibold text-muted-foreground mb-1">Raise it every year (step-up)</Text>
                    <SegmentedControl
                      className="mb-2"
                      accessibilityLabel="Step-up by"
                      options={[{ value: "pct" as const, label: "By %" }, { value: "amount" as const, label: "By ₹" }]}
                      value={stepKind}
                      onChange={setStepKind}
                    />
                    <Input
                      label={stepKind === "pct" ? "Percent more each year" : "Rupees more a month, each year"}
                      value={stepText}
                      onChangeText={setStepText}
                      keyboardType={stepKind === "pct" ? "decimal-pad" : "numeric"}
                      placeholder={stepKind === "pct" ? "10" : "1000"}
                      containerClassName="mb-3"
                    />
                  </>
                )}
                <Input label="Return you want to assume (% a year)" value={returnText} onChangeText={setReturnText} keyboardType="decimal-pad" containerClassName="mb-3" />

                <Text className="text-xs font-semibold text-muted-foreground mb-1">One-time amounts</Text>
                {lumps.map((l, i) => (
                  <View key={`${l.month}-${i}`} className="flex-row items-center py-1">
                    <Text className="text-sm text-foreground flex-1">{formatMonthLabel(l.month)}: {formatAmount(l.amount)}</Text>
                    <Pressable onPress={() => setLumps((p) => p.filter((_, x) => x !== i))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove this amount">
                      <Ionicons name="close-circle-outline" size={18} color={theme.mutedForeground} />
                    </Pressable>
                  </View>
                ))}
                <PeriodNavigator mode="month" value={lumpMonth} onChange={setLumpMonth} variant="inline" />
                <View className="flex-row items-end mt-1 mb-3">
                  <Input label="Amount" value={lumpAmount} onChangeText={setLumpAmount} keyboardType="numeric" formula placeholder="50000" containerClassName="flex-1 mr-2" />
                  <Pressable onPress={addLump} className="px-4 py-3 rounded-lg border border-border" accessibilityRole="button">
                    <Text className="text-sm font-semibold" style={{ color: theme.primary }}>Add</Text>
                  </Pressable>
                </View>

                <View className="flex-row">
                  <Pressable onPress={() => setEditing(null)} className="flex-1 py-2.5 rounded-lg items-center mr-2 border border-border" accessibilityRole="button">
                    <Text className="text-sm font-semibold text-muted-foreground">Cancel</Text>
                  </Pressable>
                  <Pressable onPress={save} className="flex-1 py-2.5 rounded-lg items-center" style={{ backgroundColor: theme.primary }} accessibilityRole="button">
                    <Text className="text-sm font-semibold text-primary-foreground">Save</Text>
                  </Pressable>
                </View>
              </ScrollView>
            </Card>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={inflationOpen} transparent animationType="fade" onRequestClose={() => setInflationOpen(false)}>
        <Pressable
          onPress={() => setInflationOpen(false)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-start", paddingTop: 90, paddingHorizontal: 16 }}
        >
          <Pressable onPress={() => {}}>
            <Card>
              <Text className="text-base font-semibold text-foreground">Inflation</Text>
              <Text className="text-xs text-muted-foreground mt-1 mb-3">How fast prices rise each year. Today's money shows what a future amount could really buy.</Text>
              <Input label="Percent a year" value={inflationText} onChangeText={setInflationText} keyboardType="decimal-pad" containerClassName="mb-3" />
              <View className="flex-row">
                <Pressable onPress={() => setInflationOpen(false)} className="flex-1 py-2.5 rounded-lg items-center mr-2 border border-border" accessibilityRole="button">
                  <Text className="text-sm font-semibold text-muted-foreground">Cancel</Text>
                </Pressable>
                <Pressable onPress={saveInflation} className="flex-1 py-2.5 rounded-lg items-center" style={{ backgroundColor: theme.primary }} accessibilityRole="button">
                  <Text className="text-sm font-semibold text-primary-foreground">Save</Text>
                </Pressable>
              </View>
            </Card>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenContainer>
  );
}

function ExtraRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between items-center py-0.5">
      <Text className="text-xs text-muted-foreground flex-1 mr-3" numberOfLines={1}>{label}</Text>
      <Text className="text-sm font-semibold text-foreground">{value}</Text>
    </View>
  );
}
