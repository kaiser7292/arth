import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { Button, FilterChip, Input, Sheet, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useAlert } from "@/hooks/use-alert";
import { useTheme } from "@/hooks/use-theme";
import { getActiveAccounts } from "@/services/financial-account";
import { INSTRUMENT_LABELS } from "@/services/investment-accounts";
import {
  QUICK_ADD_INSTRUMENTS,
  getWithdrawableInvestments,
  recordInvestmentWithdrawal,
  type QuickAddInvestmentInput,
  type RecordWithdrawalResult,
  type WithdrawableInvestment,
} from "@/services/investment-withdrawal";
import { getSelectableInvestmentBuckets, type InvestmentBucket } from "@/services/yearly-plan";
import { formatError } from "@/utils/error-message";
import { formatAmount } from "@/utils/format";

interface InvestmentWithdrawalSheetProps {
  visible: boolean;
  creditId: string;
  /** What arrived in the bank. */
  amount: number;
  /** Payer from the SMS, to pre-fill a new investment's name. */
  suggestedName: string;
  onDone: (result: RecordWithdrawalResult) => void;
  onClose: () => void;
}

const NEW = "__new__";

/**
 * "Money back from an investment": pick the investment (or add it), say how much of the
 * credit came out of it (the rest is gain), optionally lower a bucket, optionally close it.
 * See services/investment-withdrawal.ts for what gets written.
 */
export function InvestmentWithdrawalSheet({
  visible,
  creditId,
  amount,
  suggestedName,
  onDone,
  onClose,
}: InvestmentWithdrawalSheetProps) {
  const theme = useTheme();
  const alert = useAlert();

  const [investments, setInvestments] = useState<WithdrawableInvestment[]>([]);
  const [buckets, setBuckets] = useState<InvestmentBucket[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [withdrawn, setWithdrawn] = useState("");
  const [closeIt, setCloseIt] = useState(false);
  const [bucketId, setBucketId] = useState<string | null>(null);
  const [bucketsOpen, setBucketsOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newInstrument, setNewInstrument] = useState<QuickAddInvestmentInput["instrument"]>("mutual_fund");
  const [leftAfter, setLeftAfter] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setWithdrawn(String(amount));
    setCloseIt(false);
    setBucketId(null);
    setBucketsOpen(false);
    setNewName(suggestedName);
    setNewInstrument("mutual_fund");
    setLeftAfter("");
    let live = true;
    (async () => {
      const [accts, bks] = await Promise.all([
        getActiveAccounts(DEFAULT_USER_ID),
        getSelectableInvestmentBuckets(DEFAULT_USER_ID),
      ]);
      const list = (await getWithdrawableInvestments(accts)).filter((i) => !i.isFd);
      if (!live) return;
      setInvestments(list);
      setBuckets(bks.filter((b) => b.bucket_type !== "debt_payoff"));
      setSelected(list.length === 1 ? list[0].account.id : list.length === 0 ? NEW : null);
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [visible, amount, suggestedName]);

  const withdrawnNum = Number(withdrawn);
  const gain = Number.isFinite(withdrawnNum) ? Math.round((amount - withdrawnNum) * 100) / 100 : 0;
  const amountError =
    withdrawn.trim() === "" || !Number.isFinite(withdrawnNum) || withdrawnNum <= 0
      ? "Enter an amount"
      : withdrawnNum > amount
        ? `Can't be more than ${formatAmount(amount)}`
        : undefined;
  const selectedInvestment = useMemo(
    () => investments.find((i) => i.account.id === selected) ?? null,
    [investments, selected],
  );
  const bucket = buckets.find((b) => b.id === bucketId);

  const save = useCallback(async () => {
    if (!selected) {
      alert("Pick the investment", "Choose where this money came from, or add it.");
      return;
    }
    if (amountError) return;
    const isNew = selected === NEW;
    if (isNew && !newName.trim()) {
      alert("Name it", "Give the investment a name, like the fund or app it's in.");
      return;
    }
    setSaving(true);
    try {
      const result = await recordInvestmentWithdrawal({
        creditId,
        investmentAccountId: isNew ? null : selected,
        quickAdd: isNew
          ? { name: newName, instrument: newInstrument, leftAfter: Number(leftAfter) || 0 }
          : undefined,
        withdrawnAmount: withdrawnNum,
        bucketId,
        closeInvestment: !isNew && closeIt,
      });
      onDone(result);
    } catch (e) {
      alert("Couldn't save", formatError("Record withdrawal", e));
    } finally {
      setSaving(false);
    }
  }, [selected, amountError, newName, newInstrument, leftAfter, creditId, withdrawnNum, bucketId, closeIt, alert, onDone]);

  const row = (key: string, icon: keyof typeof Ionicons.glyphMap, title: string, sub: string | null) => {
    const active = selected === key;
    return (
      <Pressable
        key={key}
        onPress={() => setSelected(key)}
        className="flex-row items-center py-3 px-3 rounded-xl mb-1.5 border"
        style={{
          borderColor: active ? theme.primary : theme.border,
          backgroundColor: active ? theme.alpha("primary", 0.08) : "transparent",
        }}
        accessibilityRole="radio"
        accessibilityState={{ selected: active }}
      >
        <Ionicons name={icon} size={18} color={active ? theme.primary : theme.mutedForeground} />
        <View className="flex-1 ml-3">
          <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>{title}</Text>
          {sub ? <Text className="text-xs text-muted-foreground mt-0.5">{sub}</Text> : null}
        </View>
        {active && <Ionicons name="checkmark-circle" size={18} color={theme.primary} />}
      </Pressable>
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose} maxHeightPct={90}>
      <ScrollView className="px-4" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
        <Text className="text-lg font-bold text-foreground">Money back from an investment</Text>
        <Text className="text-sm text-muted-foreground mt-1 mb-4">
          {`${formatAmount(amount)} came in. It's recorded as coming out of the investment, so it doesn't count as income.`}
        </Text>

        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Which investment?</Text>
        {investments.map((i) =>
          row(i.account.id, i.isMarket ? "trending-up-outline" : "shield-checkmark-outline", i.label, i.kindLabel),
        )}
        {row(NEW, "add-circle-outline", "Not in Arth yet", "Add it now")}

        {selected === NEW && (
          <View className="mt-2">
            <Input label="Name" value={newName} onChangeText={setNewName} placeholder="Parag Parikh Flexi Cap, Zerodha, PPF" containerClassName="mb-3" />
            <Text className="text-sm font-medium text-muted-foreground mb-2">Type</Text>
            <View className="flex-row flex-wrap mb-3">
              {QUICK_ADD_INSTRUMENTS.map((s) => (
                <View key={s.instrument} className="mb-2">
                  <FilterChip
                    label={INSTRUMENT_LABELS[s.instrument]}
                    active={newInstrument === s.instrument}
                    onPress={() => setNewInstrument(s.instrument)}
                  />
                </View>
              ))}
            </View>
            <Input
              label="Still in it after this (optional)"
              value={leftAfter}
              onChangeText={setLeftAfter}
              keyboardType="numeric"
              placeholder="0 if you took everything out"
              containerClassName="mb-1"
            />
            <Text className="text-xs text-muted-foreground mb-2">Left at 0, the investment is added as closed.</Text>
          </View>
        )}

        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-4 mb-2">Amount</Text>
        <Input
          label="Taken out of the investment"
          value={withdrawn}
          onChangeText={setWithdrawn}
          keyboardType="numeric"
          error={amountError}
          formula
          containerClassName="mb-1"
        />
        <Text className="text-xs text-muted-foreground mb-3">
          {!amountError && gain > 0
            ? `${formatAmount(gain)} is recorded as investment gain and counts as income.`
            : "The whole amount is assumed to come out of the investment. Lower it if part of this was gain."}
        </Text>

        {buckets.length > 0 && (
          <View className="mb-3">
            <Pressable
              onPress={() => setBucketsOpen((v) => !v)}
              className="flex-row items-center py-3"
              accessibilityRole="button"
            >
              <Ionicons name="bookmark-outline" size={18} color={theme.mutedForeground} />
              <View className="flex-1 ml-3">
                <Text className="text-sm font-semibold text-foreground">Take it out of a bucket</Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  {bucket ? `${bucket.name} goes down by ${amountError ? "this amount" : formatAmount(withdrawnNum)}` : "Optional - leaves your yearly plan as it is"}
                </Text>
              </View>
              <Ionicons name={bucketsOpen ? "chevron-up" : "chevron-down"} size={16} color={theme.mutedForeground} />
            </Pressable>
            {bucketsOpen && (
              <View>
                {[{ id: null as string | null, name: "No bucket" }, ...buckets].map((b) => {
                  const active = bucketId === b.id;
                  return (
                    <Pressable
                      key={b.id ?? "none"}
                      onPress={() => {
                        setBucketId(b.id);
                        setBucketsOpen(false);
                      }}
                      className="flex-row items-center py-2.5 px-3 rounded-lg"
                      style={{ backgroundColor: active ? theme.alpha("primary", 0.08) : "transparent" }}
                    >
                      <Text className="flex-1 text-sm text-foreground" style={{ fontWeight: active ? "600" : "400" }}>
                        {b.name}
                      </Text>
                      {active && <Ionicons name="checkmark" size={16} color={theme.primary} />}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {selectedInvestment && (
          <View className="flex-row items-center py-2 mb-2">
            <View className="flex-1 mr-3">
              <Text className="text-sm font-semibold text-foreground">Fully withdrawn</Text>
              <Text className="text-xs text-muted-foreground mt-0.5">Close {selectedInvestment.label}. It stops counting in your net worth.</Text>
            </View>
            <Switch
              value={closeIt}
              onValueChange={setCloseIt}
              trackColor={{ true: theme.primary, false: theme.border }}
              accessibilityLabel="Fully withdrawn, close this investment"
            />
          </View>
        )}
        {selectedInvestment?.isMarket && (
          <Text className="text-xs text-muted-foreground mb-2">
            {`${selectedInvestment.label}'s cash balance goes down by the amount taken out.`}
          </Text>
        )}
      </ScrollView>

      <View className="flex-row px-4 pt-3 pb-1 gap-3">
        <View className="flex-1">
          <Button title="Cancel" variant="outline" onPress={onClose} />
        </View>
        <View className="flex-1">
          <Button title="Save" onPress={() => void save()} loading={saving} disabled={!selected || !!amountError} />
        </View>
      </View>
    </Sheet>
  );
}
