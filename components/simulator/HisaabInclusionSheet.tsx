import { useState, useEffect, useCallback, useMemo } from "react";
import { Text } from "@/components/ui";
import { View, Pressable, Modal, TextInput, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";


import { formatAmount } from "@/utils/format";
import {
  listHisaabInclusionCandidates,
  upsertHisaabInclusion,
  removeHisaabInclusion,
  type HisaabInclusionCandidate,
} from "@/services/simulator";
import { useTheme } from "@/hooks/use-theme";

/**
 * v16.0.5 — per-scenario hisaab inclusion sheet.
 *
 * Lists every hisaab person with a non-zero balance. For each one the user
 * can:
 *   - Toggle inclusion on/off
 *   - Enter either a percentage (0–100) OR an absolute rupee amount
 *     (capped by the person's current balance). The two inputs are linked;
 *     editing one updates the other.
 *
 * Positive-balance persons contribute to "Money available". Negative-balance
 * persons contribute to "Money owed". The sign is captured per-row at
 * write time so a later flip on the underlying hisaab ledger doesn't
 * silently reclassify the inclusion.
 */

interface Props {
  visible: boolean;
  scenarioId: string;
  userId: string;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}

type RowState = {
  personId: string;
  personName: string;
  currentBalance: number; // signed
  included: boolean;
  pct: string; // 0–100
  amt: string; // absolute rupees
};

function toRowState(c: HisaabInclusionCandidate): RowState {
  const absBal = Math.abs(c.currentBalance);
  if (c.inclusion && c.inclusion.included === 1) {
    const amt = c.inclusion.amount;
    const pct = absBal > 0 ? Math.round((amt / absBal) * 1000) / 10 : 0;
    return {
      personId: c.personId,
      personName: c.personName,
      currentBalance: c.currentBalance,
      included: true,
      pct: String(pct),
      amt: String(Math.round(amt)),
    };
  }
  // Default unchecked — seed pct=100, amt=absBal so a quick toggle on
  // gives the whole balance. Off-row state is preserved even if user
  // types a value but leaves unchecked (lets them pre-fill + commit
  // later).
  return {
    personId: c.personId,
    personName: c.personName,
    currentBalance: c.currentBalance,
    included: false,
    pct: "100",
    amt: String(Math.round(absBal)),
  };
}

function roundPaise(n: number): number {
  return Math.round(n * 100) / 100;
}

export function HisaabInclusionSheet({
  visible,
  scenarioId,
  userId,
  onSaved,
  onClose,
}: Props) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const slideAnim = useSharedValue(400);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<RowState[]>([]);

  useEffect(() => {
    if (!visible) return;
    slideAnim.value = withTiming(0, { duration: 240 });
    setLoading(true);
    (async () => {
      try {
        const candidates = await listHisaabInclusionCandidates(scenarioId, userId);
        setRows(candidates.map(toRowState));
      } finally {
        setLoading(false);
      }
    })();
  }, [visible, scenarioId, userId, slideAnim]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: slideAnim.value }],
  }));

  const handleClose = useCallback(() => {
    slideAnim.value = withTiming(400, { duration: 180 }, () => {
      runOnJS(onClose)();
    });
  }, [slideAnim, onClose]);

  const updateRow = useCallback(
    (idx: number, patch: Partial<RowState>) => {
      setRows((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], ...patch };
        return next;
      });
    },
    [],
  );

  const handleToggle = useCallback(
    (idx: number, on: boolean) => updateRow(idx, { included: on }),
    [updateRow],
  );

  const handlePctChange = useCallback(
    (idx: number, val: string) => {
      // Allow empty / partial during typing. Only recompute rupee side when
      // parseable.
      const numericOnly = val.replace(/[^0-9.]/g, "");
      const clamped = numericOnly;
      const row = rows[idx];
      const parsed = parseFloat(clamped);
      if (Number.isFinite(parsed)) {
        const safe = Math.max(0, Math.min(100, parsed));
        const absBal = Math.abs(row.currentBalance);
        const newAmt = Math.round((safe / 100) * absBal);
        updateRow(idx, { pct: clamped, amt: String(newAmt) });
      } else {
        updateRow(idx, { pct: clamped });
      }
    },
    [rows, updateRow],
  );

  const handleAmtChange = useCallback(
    (idx: number, val: string) => {
      const numericOnly = val.replace(/[^0-9.]/g, "");
      const row = rows[idx];
      const parsed = parseFloat(numericOnly);
      if (Number.isFinite(parsed)) {
        const absBal = Math.abs(row.currentBalance);
        const safe = Math.max(0, Math.min(absBal, parsed));
        const newPct = absBal > 0 ? Math.round((safe / absBal) * 1000) / 10 : 0;
        updateRow(idx, { amt: numericOnly, pct: String(newPct) });
      } else {
        updateRow(idx, { amt: numericOnly });
      }
    },
    [rows, updateRow],
  );

  const totalAvailable = useMemo(() => {
    return rows.reduce((s, r) => {
      if (!r.included) return s;
      if (r.currentBalance <= 0) return s;
      const amt = parseFloat(r.amt);
      return Number.isFinite(amt) ? s + amt : s;
    }, 0);
  }, [rows]);

  const totalOwed = useMemo(() => {
    return rows.reduce((s, r) => {
      if (!r.included) return s;
      if (r.currentBalance >= 0) return s;
      const amt = parseFloat(r.amt);
      return Number.isFinite(amt) ? s + amt : s;
    }, 0);
  }, [rows]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      for (const r of rows) {
        // Uncheck = remove. Simpler mental model than "keep inactive row
        // with last-typed value". User can always re-include and re-type.
        if (!r.included) {
          await removeHisaabInclusion(scenarioId, r.personId);
          continue;
        }
        const absBal = Math.abs(r.currentBalance);
        const parsedAmt = parseFloat(r.amt);
        const amt = Number.isFinite(parsedAmt) ? Math.max(0, Math.min(absBal, parsedAmt)) : 0;
        if (amt === 0) {
          // Edge case — user included but typed 0. Treat as a remove.
          await removeHisaabInclusion(scenarioId, r.personId);
          continue;
        }
        const sign = r.currentBalance >= 0 ? "positive" : "negative";
        await upsertHisaabInclusion({
          scenarioId,
          personId: r.personId,
          included: true,
          amount: roundPaise(amt),
          sign,
        });
      }
      await onSaved();
      slideAnim.value = withTiming(400, { duration: 180 }, () => {
        runOnJS(onClose)();
      });
    } finally {
      setSaving(false);
    }
  }, [rows, scenarioId, onSaved, slideAnim, onClose]);

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={handleClose}>
      <Pressable
        className="flex-1 bg-black/40"
        onPress={handleClose}
        accessibilityLabel="Close"
        accessibilityRole="button"
      />
      <KeyboardAvoidingView
        // v16.0.6 — `padding` on both platforms avoids the "lost cursor
        // on first tap" Android bug that `height` causes by re-laying
        // out the container on focus.
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
      >
        <Animated.View
          style={[
            animStyle,
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              maxHeight: "92%",
              paddingBottom: Math.max(insets.bottom, 8),
            },
          ]}
        >
          <View className="items-center pt-3 pb-1">
            <View className="w-10 h-1 rounded-full bg-border" />
          </View>

          <View className="px-5 pb-3">
            <Text className="text-base font-bold" style={{ color: colors.text }}>
              Include hisaab
            </Text>
            <Text className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>
              Add what people owe you (or what you owe them) to the starting balance for this scenario.
            </Text>
          </View>

          {loading ? (
            <View className="items-center py-8">
              <ActivityIndicator color={colors.textSecondary} />
            </View>
          ) : rows.length === 0 ? (
            <View className="items-center py-8 px-6">
              <Ionicons name="people-outline" size={28} color={colors.textSecondary} />
              <Text className="text-sm font-semibold text-center mt-3" style={{ color: colors.text }}>
                No hisaab balances to include
              </Text>
              <Text className="text-xs text-center mt-1" style={{ color: colors.textSecondary }}>
                Add hisaab entries from the Hisaab tab to track people who owe you money or whom you owe.
              </Text>
            </View>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 12 }}
            >
              {/* Running totals — only if anything's included */}
              {(totalAvailable > 0 || totalOwed > 0) && (
                <View className="mx-5 mb-3 py-2.5 px-3 rounded-lg" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                  {totalAvailable > 0 && (
                    <View className="flex-row items-center justify-between">
                      <Text className="text-xs" style={{ color: colors.textSecondary }}>
                        Added to money available
                      </Text>
                      <Text className="text-sm font-bold" style={{ color: theme.success }}>
                        +{formatAmount(totalAvailable)}
                      </Text>
                    </View>
                  )}
                  {totalOwed > 0 && (
                    <View className="flex-row items-center justify-between mt-1">
                      <Text className="text-xs" style={{ color: colors.textSecondary }}>
                        Added to money owed
                      </Text>
                      <Text className="text-sm font-bold" style={{ color: theme.danger }}>
                        {formatAmount(totalOwed)}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {rows.map((r, idx) => {
                const isPositive = r.currentBalance >= 0;
                const balanceLabel = isPositive
                  ? `Owes you ${formatAmount(Math.abs(r.currentBalance))}`
                  : `You owe ${formatAmount(Math.abs(r.currentBalance))}`;
                const sideColor = isPositive ? theme.success : theme.danger;
                return (
                  <View
                    key={r.personId}
                    className="mx-5 mb-2 p-3 rounded-xl"
                    style={{
                      borderWidth: 1,
                      borderColor: r.included ? sideColor + "55" : colors.border,
                      backgroundColor: r.included ? sideColor + "0A" : "transparent",
                    }}
                  >
                    <Pressable
                      onPress={() => handleToggle(idx, !r.included)}
                      className="flex-row items-center"
                      accessibilityRole="switch"
                      accessibilityState={{ checked: r.included }}
                      accessibilityLabel={`${r.included ? "Exclude" : "Include"} ${r.personName}`}
                    >
                      <View
                        className="w-5 h-5 rounded items-center justify-center"
                        style={{
                          backgroundColor: r.included ? sideColor : "transparent",
                          borderWidth: 1.5,
                          borderColor: r.included ? sideColor : colors.border,
                        }}
                      >
                        {r.included && <Ionicons name="checkmark" size={14} color="#fff" />}
                      </View>
                      <View className="flex-1 ml-3">
                        <Text className="text-sm font-semibold" style={{ color: colors.text }} numberOfLines={1}>
                          {r.personName}
                        </Text>
                        <Text className="text-xs mt-0.5" style={{ color: sideColor }}>
                          {balanceLabel}
                        </Text>
                      </View>
                    </Pressable>

                    {r.included && (
                      <View className="mt-3 flex-row items-center gap-2">
                        <View className="flex-1">
                          <Text className="text-label font-semibold uppercase tracking-wider mb-1" style={{ color: colors.textSecondary }}>
                            Percent
                          </Text>
                          <View
                            className="flex-row items-center border rounded-lg px-2.5 py-2"
                            style={{ borderColor: colors.border }}
                          >
                            <TextInput
                              value={r.pct}
                              onChangeText={(v) => handlePctChange(idx, v)}
                              keyboardType="numeric"
                              className="flex-1 text-sm"
                              style={{ color: colors.text }}
                              placeholder="0"
                              placeholderTextColor={colors.textSecondary}
                            />
                            <Text className="text-sm" style={{ color: colors.textSecondary }}>%</Text>
                          </View>
                        </View>
                        <View className="flex-1">
                          <Text className="text-label font-semibold uppercase tracking-wider mb-1" style={{ color: colors.textSecondary }}>
                            Amount (₹)
                          </Text>
                          <View
                            className="flex-row items-center border rounded-lg px-2.5 py-2"
                            style={{ borderColor: colors.border }}
                          >
                            <Text className="text-sm mr-1" style={{ color: colors.textSecondary }}>₹</Text>
                            <TextInput
                              value={r.amt}
                              onChangeText={(v) => handleAmtChange(idx, v)}
                              keyboardType="numeric"
                              className="flex-1 text-sm"
                              style={{ color: colors.text }}
                              placeholder="0"
                              placeholderTextColor={colors.textSecondary}
                            />
                          </View>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}

          <View className="flex-row px-5 pt-3 gap-3">
            <Pressable
              onPress={handleClose}
              className="flex-1 py-3 rounded-xl items-center"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text className="text-sm font-semibold" style={{ color: colors.textSecondary }}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={saving || loading}
              className="flex-1 py-3 rounded-xl items-center"
              style={{ backgroundColor: theme.primary, opacity: saving || loading ? 0.5 : 1 }}
              accessibilityRole="button"
              accessibilityLabel="Save hisaab inclusion"
            >
              <Text className="text-sm font-semibold text-white">
                {saving ? "Saving…" : "Save"}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
