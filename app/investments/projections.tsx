import { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
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
  loadAssumptions,
  projectInvestment,
  saveAssumption,
  type ProjectionAssumption,
} from "@/services/investment-projections";
import { getCurrentMonth } from "@/services/budget";
import { formatMonthLabel } from "@/utils/date";
import { formatAmount } from "@/utils/expense-validation";

const HORIZONS = [1, 3, 5, 10, 15, 20, 30];

interface Line {
  id: string;
  name: string;
  value: number;
  fallback: number;
}

/** Where your investments could get to, on returns and additions you choose for each one. */
export default function ProjectionsScreen() {
  const theme = useTheme();
  const [lines, setLines] = useState<Line[] | null>(null);
  const [assumptions, setAssumptions] = useState(loadAssumptions);
  const [years, setYears] = useState(10);
  const [editing, setEditing] = useState<Line | null>(null);
  const [returnText, setReturnText] = useState("");
  const [monthlyText, setMonthlyText] = useState("");
  const [lumps, setLumps] = useState<ProjectionAssumption["lumpSums"]>([]);
  const [lumpAmount, setLumpAmount] = useState("");
  const [lumpMonth, setLumpMonth] = useState(getCurrentMonth());

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
  const total = useMemo(() => combineProjections(projections.map((p) => p.points)), [projections]);
  const end = total[total.length - 1];
  const yearly = useMemo(() => total.filter((p) => p.month > 0 && p.month % 12 === 0), [total]);
  const shown = useMemo(() => {
    const step = Math.max(1, Math.ceil(yearly.length / 10));
    return yearly.filter((p, i) => (yearly.length - 1 - i) % step === 0);
  }, [yearly]);
  const tallest = Math.max(1, ...shown.map((p) => p.value));

  const open = (l: Line) => {
    const a = assumptionFor(l);
    setReturnText(String(a.returnPct));
    setMonthlyText(a.monthly > 0 ? String(a.monthly) : "");
    setLumps(a.lumpSums);
    setLumpAmount("");
    setLumpMonth(startMonth);
    setEditing(l);
  };

  const save = () => {
    if (!editing) return;
    const next: ProjectionAssumption = {
      returnPct: Math.max(0, parseFloat(returnText) || 0),
      monthly: Math.max(0, parseFloat(monthlyText.replace(/,/g, "")) || 0),
      lumpSums: lumps,
    };
    saveAssumption(editing.id, next);
    setAssumptions(loadAssumptions());
    setEditing(null);
  };

  const addLump = () => {
    const amount = parseFloat(lumpAmount.replace(/,/g, ""));
    if (!(amount > 0)) return;
    setLumps((p) => [...p, { month: lumpMonth, amount }]);
    setLumpAmount("");
  };

  if (!lines) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Working it out..." icon="trending-up-outline" />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {lines.length === 0 ? (
          <Card>
            <Text className="text-sm text-muted-foreground">Add an investment to see where it could get to.</Text>
          </Card>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3" style={{ flexGrow: 0 }}>
              {HORIZONS.map((y) => {
                const on = y === years;
                return (
                  <Pressable
                    key={y}
                    onPress={() => setYears(y)}
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

            {end && (
              <Card className="mb-3">
                <Text className="text-xs text-muted-foreground">Could reach, in {years} {years === 1 ? "year" : "years"}</Text>
                <Text className="text-title font-bold text-foreground mt-0.5">{formatAmount(Math.round(end.value))}</Text>
                <View className="flex-row justify-between mt-2">
                  <View>
                    <Text className="text-label text-muted-foreground">Today and what you add</Text>
                    <Text className="text-sm font-semibold text-foreground">{formatAmount(Math.round(end.putIn))}</Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-label text-muted-foreground">Assumed growth</Text>
                    <Text className="text-sm font-semibold" style={{ color: theme.success }}>{formatAmount(Math.round(end.value - end.putIn))}</Text>
                  </View>
                </View>

                {/* A bar for each year: the solid part is your money, the rest is assumed growth. */}
                <View className="flex-row items-end mt-4" style={{ height: 110, gap: 4 }}>
                  {shown.map((p) => (
                    <View key={p.month} className="flex-1 rounded-t overflow-hidden justify-end" style={{ height: `${(p.value / tallest) * 100}%`, backgroundColor: theme.alpha("success", 0.35) }}>
                      <View style={{ height: `${p.value > 0 ? (p.putIn / p.value) * 100 : 0}%`, backgroundColor: theme.primary }} />
                    </View>
                  ))}
                </View>
                <View className="flex-row mt-1" style={{ gap: 4 }}>
                  {shown.map((p) => (
                    <Text key={p.month} className="flex-1 text-label text-muted-foreground text-center" numberOfLines={1}>{p.month / 12}y</Text>
                  ))}
                </View>
              </Card>
            )}

            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 mt-1">Each investment</Text>
            {projections.map(({ line, points }) => {
              const a = assumptionFor(line);
              const last = points[points.length - 1];
              const extras = [`${a.returnPct}% a year`, a.monthly > 0 ? `${formatAmount(a.monthly)} a month` : null, a.lumpSums.length > 0 ? `${a.lumpSums.length} lump ${a.lumpSums.length === 1 ? "sum" : "sums"}` : null].filter(Boolean);
              return (
                <Pressable key={line.id} onPress={() => open(line)} accessibilityRole="button" accessibilityLabel={`Change assumptions for ${line.name}`}>
                  <Card className="mb-2">
                    <View className="flex-row items-center">
                      <View className="flex-1 mr-2">
                        <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>{line.name}</Text>
                        <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>Now {formatAmount(Math.round(line.value))} · {extras.join(" · ")}</Text>
                      </View>
                      <Text className="text-sm font-bold text-foreground">{formatAmount(Math.round(last.value))}</Text>
                      <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} style={{ marginLeft: 4 }} />
                    </View>
                  </Card>
                </Pressable>
              );
            })}
            <Text className="text-xs text-muted-foreground mt-2">
              These are your own assumptions worked forward, not a forecast or financial advice. Real returns go up and down, and tax isn't taken off.
            </Text>
          </>
        )}
      </ScrollView>

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <Pressable
          onPress={() => setEditing(null)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-start", paddingTop: 70, paddingHorizontal: 16 }}
        >
          <Pressable onPress={() => {}}>
            <Card>
              <Text className="text-base font-semibold text-foreground mb-3" numberOfLines={1}>{editing?.name}</Text>
              <Input label="Return you want to assume (% a year)" value={returnText} onChangeText={setReturnText} keyboardType="decimal-pad" containerClassName="mb-3" />
              <Input label="Add each month (SIP)" value={monthlyText} onChangeText={setMonthlyText} keyboardType="numeric" formula placeholder="0" containerClassName="mb-3" />

              <Text className="text-xs font-semibold text-muted-foreground mb-1">Lump sums</Text>
              {lumps.map((l, i) => (
                <View key={`${l.month}-${i}`} className="flex-row items-center py-1">
                  <Text className="text-sm text-foreground flex-1">{formatMonthLabel(l.month)}: {formatAmount(l.amount)}</Text>
                  <Pressable onPress={() => setLumps((p) => p.filter((_, x) => x !== i))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove lump sum">
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
                <Pressable onPress={() => setEditing(null)} className="flex-1 py-2.5 rounded-lg items-center mr-2 border border-border">
                  <Text className="text-sm font-semibold text-muted-foreground">Cancel</Text>
                </Pressable>
                <Pressable onPress={save} className="flex-1 py-2.5 rounded-lg items-center" style={{ backgroundColor: theme.primary }}>
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
