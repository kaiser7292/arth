/**
 * SplitSheet — Splitwise-inspired split bottom sheet.
 *
 * Flow: Who paid? → How to split? → With whom? → Preview & Confirm
 * Used from: expense add, expense detail, review queue.
 */

import { useState, useEffect, useCallback } from "react";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { getPersonsWithBalances, createPerson } from "@/services/hisaab";
import { computeSplitAmounts } from "@/services/expense";
import type { HisaabPersonWithBalance } from "@/services/hisaab";
import type { SplitConfig, SplitMode } from "@/services/expense";
import { formatAmount } from "@/utils/format";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { ac } from "@/utils/accent";

interface SplitSheetProps {
  visible: boolean;
  onClose: () => void;
  totalAmount: number;
  onConfirm: (config: SplitConfig) => void;
  /** Pre-select a person (for "Paid for Family" flow) */
  preselectedPersonId?: string;
  /** Lock to a specific mode (for "Paid for Family" = they_owe_full) */
  lockedMode?: SplitMode;
}

const SPLIT_MODES: { mode: SplitMode; label: string; icon: string; description: string }[] = [
  { mode: "equal", label: "Split equally", icon: "git-compare-outline", description: "50/50" },
  { mode: "they_owe_full", label: "They owe full", icon: "arrow-forward-outline", description: "₹0 in my budget" },
  { mode: "i_owe_full", label: "I owe full", icon: "arrow-back-outline", description: "Full in my budget" },
  { mode: "exact", label: "By amount", icon: "calculator-outline", description: "Enter exact amounts" },
  { mode: "percentage", label: "By percentage", icon: "pie-chart-outline", description: "Set % split" },
];

export function SplitSheet({
  visible,
  onClose,
  totalAmount,
  onConfirm,
  preselectedPersonId,
  lockedMode,
}: SplitSheetProps) {
  // State
  const [step, setStep] = useState<"paidBy" | "mode" | "person" | "preview">("paidBy");
  const [paidBy, setPaidBy] = useState<"me" | string>("me");
  const [splitMode, setSplitMode] = useState<SplitMode>(lockedMode ?? "equal");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(preselectedPersonId ?? null);
  const [persons, setPersons] = useState<HisaabPersonWithBalance[]>([]);
  const [exactAmount, setExactAmount] = useState("");
  const [percentage, setPercentage] = useState("50");
  const [newPersonName, setNewPersonName] = useState("");
  const [showAddPerson, setShowAddPerson] = useState(false);

  const { accent, colorScheme, colors } = useColorScheme();

  // Animation
  const slideAnim = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - slideAnim.value) * 600 }],
    opacity: slideAnim.value,
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: slideAnim.value * 0.5,
  }));

  // Load persons + reset state on open
  useEffect(() => {
    if (visible) {
      getPersonsWithBalances(DEFAULT_USER_ID).then(setPersons);
      slideAnim.value = withTiming(1, { duration: 250 });

      // Skip steps if locked mode or preselected person
      if (lockedMode) {
        setSplitMode(lockedMode);
        setStep(preselectedPersonId ? "preview" : "person");
        setPaidBy("me");
      } else {
        setStep("paidBy");
        setPaidBy("me");
        setSplitMode("equal");
      }

      setSelectedPersonId(preselectedPersonId ?? null);
      setExactAmount("");
      setPercentage("50");
      setShowAddPerson(false);
      setNewPersonName("");
    } else {
      slideAnim.value = withTiming(0, { duration: 200 });
    }
  }, [visible, lockedMode, preselectedPersonId, slideAnim]);

  const handleClose = useCallback(() => {
    slideAnim.value = withTiming(0, { duration: 200 }, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  }, [slideAnim, onClose]);

  const handleConfirm = useCallback(() => {
    if (!selectedPersonId) return;

    const config: SplitConfig = {
      paidBy,
      splitMode,
      personId: selectedPersonId,
      exactAmount: splitMode === "exact" ? parseFloat(exactAmount) || 0 : undefined,
      percentage: splitMode === "percentage" ? parseFloat(percentage) || 0 : undefined,
    };

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onConfirm(config);
    handleClose();
  }, [selectedPersonId, paidBy, splitMode, exactAmount, percentage, onConfirm, handleClose]);

  const handleAddPerson = useCallback(async () => {
    if (!newPersonName.trim()) return;
    const id = await createPerson({
      owner_user_id: DEFAULT_USER_ID,
      name: newPersonName.trim(),
    });
    const updated = await getPersonsWithBalances(DEFAULT_USER_ID);
    setPersons(updated);
    setSelectedPersonId(id);
    setNewPersonName("");
    setShowAddPerson(false);
    setStep("preview");
  }, [newPersonName]);

  const selectPerson = useCallback(
    (personId: string) => {
      setSelectedPersonId(personId);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setStep("preview");
    },
    [],
  );

  // Compute preview
  const selectedPerson = persons.find((p) => p.id === selectedPersonId);
  const preview = selectedPersonId
    ? computeSplitAmounts(totalAmount, {
        paidBy,
        splitMode,
        personId: selectedPersonId,
        exactAmount: splitMode === "exact" ? parseFloat(exactAmount) || 0 : undefined,
        percentage: splitMode === "percentage" ? parseFloat(percentage) || 0 : undefined,
      })
    : null;


  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior="padding"
        className="flex-1"
      >
        {/* Backdrop */}
        <Pressable onPress={handleClose} className="flex-1">
          <Animated.View
            style={backdropStyle}
            className="flex-1 bg-black"
          />
        </Pressable>

        {/* Sheet */}
        <Animated.View
          style={animatedStyle}
          className="bg-white dark:bg-surface-dark-alt rounded-t-3xl px-5 pb-8 pt-3"
        >
          {/* Handle */}
          <View className="items-center mb-4">
            <View className="w-10 h-1 rounded-full bg-border-light dark:bg-border-dark" />
          </View>

          {/* Header */}
          <View className="flex-row items-center justify-between mb-5">
            <Text className="text-lg font-bold text-text-primary dark:text-text-dark-primary">
              {step === "paidBy" && "Who paid?"}
              {step === "mode" && "How to split?"}
              {step === "person" && "With whom?"}
              {step === "preview" && "Split Preview"}
            </Text>
            <Pressable onPress={handleClose} className="p-1">
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} className="max-h-96">
            {/* ──── Step 1: Who Paid? ──── */}
            {step === "paidBy" && (
              <View className="gap-3">
                <Pressable
                  onPress={() => {
                    setPaidBy("me");
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setStep("mode");
                  }}
                  className={`flex-row items-center p-4 rounded-xl border ${
                    paidBy === "me"
                      ? ""
                      : "border-border-light dark:border-border-dark"
                  }`}
                  style={paidBy === "me" ? { borderColor: accent[500], backgroundColor: ac(accent, colorScheme, 50, 900) } : undefined}
                >
                  <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: ac(accent, colorScheme, 100, 800) }}>
                    <Ionicons name="person" size={20} color={accent[500]} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary">
                      I paid
                    </Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                      I paid {formatAmount(totalAmount)} and want to split
                    </Text>
                  </View>
                </Pressable>

                {persons.map((person) => (
                  <Pressable
                    key={person.id}
                    onPress={() => {
                      setPaidBy(person.id);
                      setSelectedPersonId(person.id);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setStep("mode");
                    }}
                    className="flex-row items-center p-4 rounded-xl border border-border-light dark:border-border-dark"
                  >
                    <View className="w-10 h-10 rounded-full bg-surface-light-alt dark:bg-surface-dark items-center justify-center mr-3">
                      <Text className="text-base font-bold text-text-secondary dark:text-text-dark-secondary">
                        {person.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary">
                        {person.name} paid
                      </Text>
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                        {person.name} paid and I owe my share
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {/* ──── Step 2: How to Split? ──── */}
            {step === "mode" && (
              <View className="gap-2">
                {SPLIT_MODES.filter((m) => {
                  // Hide irrelevant modes based on who paid
                  if (paidBy === "me") return m.mode !== "i_owe_full";
                  return m.mode !== "they_owe_full";
                }).map((item) => (
                  <Pressable
                    key={item.mode}
                    onPress={() => {
                      setSplitMode(item.mode);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      if (item.mode === "exact" || item.mode === "percentage") {
                        // Need amount input — stay on mode step with input
                      }
                      if (selectedPersonId) {
                        setStep("preview");
                      } else {
                        setStep("person");
                      }
                    }}
                    className={`flex-row items-center p-4 rounded-xl border ${
                      splitMode === item.mode
                        ? ""
                        : "border-border-light dark:border-border-dark"
                    }`}
                    style={splitMode === item.mode ? { borderColor: accent[500], backgroundColor: ac(accent, colorScheme, 50, 900) } : undefined}
                  >
                    <View className="w-9 h-9 rounded-lg bg-surface-light-alt dark:bg-surface-dark items-center justify-center mr-3">
                      <Ionicons
                        name={item.icon as keyof typeof Ionicons.glyphMap}
                        size={18}
                        color={colors.textSecondary}
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                        {item.label}
                      </Text>
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                        {item.description}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {/* ──── Step 3: Pick Person ──── */}
            {step === "person" && (
              <View className="gap-3">
                {persons.length === 0 && !showAddPerson && (
                  <View className="items-center py-6">
                    <Ionicons name="people-outline" size={48} color={colors.textSecondary} />
                    <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-2 text-center">
                      No people in your family ledger yet.
                    </Text>
                  </View>
                )}

                {persons
                  .filter((p) => paidBy !== p.id) // Don't show the payer as a split option
                  .map((person) => (
                    <Pressable
                      key={person.id}
                      onPress={() => selectPerson(person.id)}
                      className={`flex-row items-center p-4 rounded-xl border ${
                        selectedPersonId === person.id
                          ? ""
                          : "border-border-light dark:border-border-dark"
                      }`}
                      style={selectedPersonId === person.id ? { borderColor: accent[500], backgroundColor: ac(accent, colorScheme, 50, 900) } : undefined}
                    >
                      <View className="w-10 h-10 rounded-full bg-surface-light-alt dark:bg-surface-dark items-center justify-center mr-3">
                        <Text className="text-base font-bold text-text-secondary dark:text-text-dark-secondary">
                          {person.name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View className="flex-1">
                        <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                          {person.name}
                        </Text>
                        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                          Balance: {formatAmount(Math.abs(person.balance))}{" "}
                          {person.balance > 0 ? "owes you" : person.balance < 0 ? "you owe" : "settled"}
                        </Text>
                      </View>
                    </Pressable>
                  ))}

                {/* Add new person */}
                {showAddPerson ? (
                  <View className="flex-row items-center gap-2">
                    <TextInput
                      className="flex-1 border border-border-light dark:border-border-dark rounded-xl px-4 py-3 text-text-primary dark:text-text-dark-primary"
                      placeholder="Person name"
                      placeholderTextColor={colors.tabIconDefault}
                      value={newPersonName}
                      onChangeText={setNewPersonName}
                      autoFocus
                    />
                    <Pressable
                      onPress={handleAddPerson}
                      className="rounded-xl px-4 py-3"
                      style={{ backgroundColor: accent[500] }}
                    >
                      <Text className="text-white font-semibold">Add</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => setShowAddPerson(true)}
                    className="flex-row items-center p-4 rounded-xl border border-dashed"
                    style={{ borderColor: ac(accent, colorScheme, 300, 700) }}
                  >
                    <Ionicons name="add-circle-outline" size={20} color={accent[500]} />
                    <Text className="text-sm font-medium ml-2" style={{ color: ac(accent, colorScheme, 500, 300) }}>
                      Add new person
                    </Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* ──── Step 4: Preview ──── */}
            {step === "preview" && preview && (
              <View className="gap-4">
                {/* Exact amount / percentage input */}
                {splitMode === "exact" && (
                  <View>
                    <Text className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary mb-1">
                      {paidBy === "me" ? "How much do they owe?" : "How much do you owe?"}
                    </Text>
                    <TextInput
                      className="border border-border-light dark:border-border-dark rounded-xl px-4 py-3 text-text-primary dark:text-text-dark-primary text-lg"
                      placeholder="0"
                      placeholderTextColor={colors.tabIconDefault}
                      keyboardType="decimal-pad"
                      value={exactAmount}
                      onChangeText={setExactAmount}
                    />
                  </View>
                )}
                {splitMode === "percentage" && (
                  <View>
                    <Text className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary mb-1">
                      {paidBy === "me" ? "Their share %" : "Your share %"}
                    </Text>
                    <View className="flex-row items-center gap-2">
                      {["25", "50", "75"].map((pct) => (
                        <Pressable
                          key={pct}
                          onPress={() => setPercentage(pct)}
                          className={`flex-1 items-center py-2 rounded-lg ${
                            percentage === pct
                              ? ""
                              : "bg-surface-light-alt dark:bg-surface-dark"
                          }`}
                          style={percentage === pct ? { backgroundColor: accent[500] } : undefined}
                        >
                          <Text
                            className={`text-sm font-semibold ${
                              percentage === pct
                                ? "text-white"
                                : "text-text-primary dark:text-text-dark-primary"
                            }`}
                          >
                            {pct}%
                          </Text>
                        </Pressable>
                      ))}
                      <TextInput
                        className="flex-1 border border-border-light dark:border-border-dark rounded-lg px-3 py-2 text-center text-text-primary dark:text-text-dark-primary"
                        placeholder="%"
                        placeholderTextColor={colors.tabIconDefault}
                        keyboardType="number-pad"
                        value={percentage}
                        onChangeText={(v) => {
                          const num = parseInt(v, 10);
                          if (!v) setPercentage("");
                          else if (num >= 0 && num <= 100) setPercentage(String(num));
                        }}
                        maxLength={3}
                      />
                    </View>
                  </View>
                )}

                {/* Summary card */}
                <View className="bg-surface-light-alt dark:bg-surface-dark rounded-2xl p-4 gap-3">
                  <Text className="text-xs font-semibold tracking-wider uppercase text-text-secondary dark:text-text-dark-secondary">
                    Split Summary
                  </Text>

                  <View className="flex-row justify-between items-center">
                    <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
                      Total
                    </Text>
                    <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                      {formatAmount(totalAmount)}
                    </Text>
                  </View>

                  <View className="h-px bg-border-light dark:bg-border-dark" />

                  <View className="flex-row justify-between items-center">
                    <View className="flex-row items-center">
                      <View className="w-6 h-6 rounded-full items-center justify-center mr-2" style={{ backgroundColor: ac(accent, colorScheme, 100, 800) }}>
                        <Ionicons name="person" size={12} color={accent[500]} />
                      </View>
                      <Text className="text-sm text-text-primary dark:text-text-dark-primary">
                        My budget
                      </Text>
                    </View>
                    <Text className="text-base font-bold" style={{ color: ac(accent, colorScheme, 600, 300) }}>
                      {formatAmount(preview.myBudgetAmount)}
                    </Text>
                  </View>

                  <View className="flex-row justify-between items-center">
                    <View className="flex-row items-center">
                      <View className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900 items-center justify-center mr-2">
                        <Ionicons name="people" size={12} color={StatusColors[colorScheme].warning} />
                      </View>
                      <Text className="text-sm text-text-primary dark:text-text-dark-primary">
                        {selectedPerson?.name ?? "Person"}
                        {preview.hisaabType === "debit" ? " owes you" : " — you owe"}
                      </Text>
                    </View>
                    <Text className="text-base font-bold text-orange-600 dark:text-orange-300">
                      {formatAmount(preview.hisaabAmount)}
                    </Text>
                  </View>
                </View>

                {/* Change selections */}
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => setStep("paidBy")}
                    className="flex-1 items-center py-2 rounded-lg bg-surface-light-alt dark:bg-surface-dark"
                  >
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                      {paidBy === "me" ? "I paid" : `${selectedPerson?.name} paid`}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setStep("mode")}
                    className="flex-1 items-center py-2 rounded-lg bg-surface-light-alt dark:bg-surface-dark"
                  >
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                      {SPLIT_MODES.find((m) => m.mode === splitMode)?.label}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setStep("person")}
                    className="flex-1 items-center py-2 rounded-lg bg-surface-light-alt dark:bg-surface-dark"
                  >
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                      {selectedPerson?.name ?? "Pick person"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Confirm button (only on preview step) */}
          {step === "preview" && (
            <Pressable
              onPress={handleConfirm}
              disabled={!selectedPersonId || (splitMode === "exact" && !exactAmount)}
              className={`mt-4 items-center py-4 rounded-2xl ${
                !selectedPersonId || (splitMode === "exact" && !exactAmount)
                  ? "bg-gray-300 dark:bg-gray-700"
                  : ""
              }`}
              style={!selectedPersonId || (splitMode === "exact" && !exactAmount) ? undefined : { backgroundColor: accent[500] }}
            >
              <Text className="text-base font-bold text-white">Confirm Split</Text>
            </Pressable>
          )}

          {/* Back button (on non-first steps) */}
          {step !== "paidBy" && !lockedMode && (
            <Pressable
              onPress={() => {
                if (step === "mode") setStep("paidBy");
                else if (step === "person") setStep("mode");
                else if (step === "preview") {
                  if (splitMode === "exact" || splitMode === "percentage") setStep("preview");
                  else setStep(selectedPersonId ? "mode" : "person");
                }
              }}
              className="mt-2 items-center py-2"
            >
              <Text className="text-sm font-medium text-text-secondary dark:text-text-dark-secondary">
                ← Back
              </Text>
            </Pressable>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
