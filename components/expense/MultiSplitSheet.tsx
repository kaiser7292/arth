import { useState, useEffect, useCallback } from "react";
import { Sheet, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { View, Pressable,  ScrollView, TextInput,  Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { getPersonsWithBalances, createPerson } from "@/services/hisaab";
import type { HisaabPersonWithBalance } from "@/services/hisaab";
import type { MultiSplitConfig, MultiSplitEntry } from "@/services/expense-multi-split";
import { formatAmount } from "@/utils/format";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { useTheme } from "@/hooks/use-theme";

interface MultiSplitSheetProps {
  visible: boolean;
  onClose: () => void;
  totalAmount: number;
  onConfirm: (config: MultiSplitConfig) => void | Promise<void>;
  initialSplits?: MultiSplitEntry[];
  initialFeeAbsorbed?: boolean;
}

export function MultiSplitSheet({
  visible,
  onClose,
  totalAmount,
  onConfirm,
  initialSplits,
  initialFeeAbsorbed,
}: MultiSplitSheetProps) {
  const [splits, setSplits] = useState<MultiSplitEntry[]>(initialSplits ?? []);
  // Raw string buffers for each split's amount input so "." and partial
  // decimals (e.g. "3.") don't get stripped by parseFloat during typing.
  const [amountDrafts, setAmountDrafts] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    (initialSplits ?? []).forEach((s, i) => {
      init[i] = s.amount > 0 ? String(s.amount) : "";
    });
    return init;
  });
  const [feeAbsorbed, setFeeAbsorbed] = useState(initialFeeAbsorbed ?? true);
  const [persons, setPersons] = useState<HisaabPersonWithBalance[]>([]);
  const [showPersonPicker, setShowPersonPicker] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [newPersonName, setNewPersonName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [showAddPerson, setShowAddPerson] = useState(false);

  const { colors } = useColorScheme();
  const theme = useTheme();

  useEffect(() => {
    if (visible) {
      setConfirming(false);
      getPersonsWithBalances(DEFAULT_USER_ID).then(setPersons);

      if (initialSplits && initialSplits.length > 0) {
        setSplits(initialSplits);
      }
      if (initialFeeAbsorbed !== undefined) {
        setFeeAbsorbed(initialFeeAbsorbed);
      }
    }
  }, [visible, initialSplits, initialFeeAbsorbed]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const totalSplitAmount = splits.reduce((sum, s) => sum + s.amount, 0);
  const convenienceFee = Math.max(0, Math.round((totalAmount - totalSplitAmount) * 100) / 100);
  const feePerSplit = !feeAbsorbed && splits.length > 0
    ? Math.round((convenienceFee / splits.length) * 100) / 100
    : 0;
  const othersTotal = splits.reduce((sum, s) => sum + s.amount + (feeAbsorbed ? 0 : feePerSplit), 0);
  const myShare = Math.round((totalAmount - othersTotal) * 100) / 100;

  const handleAddSplit = useCallback(() => {
    setEditingIndex(splits.length);
    setShowPersonPicker(true);
  }, [splits.length]);

  const handleSelectPerson = useCallback((personId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    setSplits((prev) => {
      const updated = [...prev];
      if (editingIndex !== null && editingIndex >= prev.length) {
        updated.push({ personId, description: "", amount: 0 });
      } else if (editingIndex !== null) {
        updated[editingIndex] = { ...updated[editingIndex], personId };
      }
      return updated;
    });
    setShowPersonPicker(false);
    setShowAddPerson(false);
  }, [editingIndex]);

  const handleAddPerson = useCallback(async () => {
    if (!newPersonName.trim()) return;
    const id = await createPerson({
      owner_user_id: DEFAULT_USER_ID,
      name: newPersonName.trim(),
    });
    const updated = await getPersonsWithBalances(DEFAULT_USER_ID);
    setPersons(updated);
    setNewPersonName("");
    setShowAddPerson(false);
    handleSelectPerson(id);
  }, [newPersonName, handleSelectPerson]);

  const handleUpdateSplitAmount = useCallback((index: number, value: string) => {
    // Accept only digits + a single dot with up to 2 decimals.
    // Reject anything else silently so the draft buffer never holds junk.
    if (value !== "" && !/^\d*\.?\d{0,2}$/.test(value)) return;
    setAmountDrafts((prev) => ({ ...prev, [index]: value }));
    const num = parseFloat(value);
    setSplits((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], amount: Number.isFinite(num) ? num : 0 };
      return updated;
    });
  }, []);

  const handleUpdateSplitDescription = useCallback((index: number, value: string) => {
    setSplits((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], description: value };
      return updated;
    });
  }, []);

  const handleRemoveSplit = useCallback((index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSplits((prev) => prev.filter((_, i) => i !== index));
    // Shift draft keys to match new indices after removal.
    setAmountDrafts((prev) => {
      const next: Record<number, string> = {};
      Object.entries(prev).forEach(([key, val]) => {
        const k = Number(key);
        if (k < index) next[k] = val;
        else if (k > index) next[k - 1] = val;
      });
      return next;
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (confirming) return;
    const validSplits = splits.filter((s) => s.amount > 0 && s.personId);
    if (validSplits.length === 0) return;
    setConfirming(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await onConfirm({ splits: validSplits, feeAbsorbed });
    onClose();
  }, [splits, feeAbsorbed, onConfirm, onClose, confirming]);

  const getPersonName = (personId: string) =>
    persons.find((p) => p.id === personId)?.name ?? "Unknown";

  const canConfirm = splits.some((s) => s.amount > 0 && s.personId);

  return (
    <Sheet visible={visible} onClose={handleClose}>
      <View className="px-5 pt-1">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-lg font-bold text-foreground">
            {showPersonPicker ? "Pick Person" : "Split Expense"}
          </Text>
          <Pressable onPress={handleClose} className="p-1">
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>
  
        <ScrollView showsVerticalScrollIndicator={false} className="max-h-[420px]">
          {showPersonPicker ? (
            <View className="gap-3">
              {persons.map((person) => (
                <Pressable
                  key={person.id}
                  onPress={() => handleSelectPerson(person.id)}
                  className="flex-row items-center p-4 rounded-xl border border-border"
                >
                  <View className="w-10 h-10 rounded-full bg-background items-center justify-center mr-3">
                    <Text className="text-base font-bold text-muted-foreground">
                      {person.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">
                      {person.name}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      Balance: {formatAmount(Math.abs(person.balance))}{" "}
                      {person.balance > 0 ? "owes you" : person.balance < 0 ? "you owe" : "settled"}
                    </Text>
                  </View>
                </Pressable>
              ))}
  
              {showAddPerson ? (
                <View className="flex-row items-center gap-2">
                  <TextInput
                    className="flex-1 border border-border rounded-xl px-4 py-3 text-foreground"
                    placeholder="Person name"
                    placeholderTextColor={colors.tabIconDefault}
                    value={newPersonName}
                    onChangeText={setNewPersonName}
                    autoFocus
                  />
                  <Pressable
                    onPress={handleAddPerson}
                    className="rounded-xl px-4 py-3"
                    style={{ backgroundColor: theme.primary }}
                  >
                    <Text className="text-primary-foreground font-semibold">Add</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => setShowAddPerson(true)}
                  className="flex-row items-center p-4 rounded-xl border border-dashed"
                  style={{ borderColor: theme.alpha("primary", 0.25) }}
                >
                  <Ionicons name="add-circle-outline" size={20} color={theme.primary} />
                  <Text className="text-sm font-medium ml-2" style={{ color: theme.primary }}>
                    Add new person
                  </Text>
                </Pressable>
              )}
  
              <Pressable
                onPress={() => setShowPersonPicker(false)}
                className="items-center py-2"
              >
                <Text className="text-sm font-medium text-muted-foreground">
                  ← Back
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="gap-3">
              {/* Total amount header */}
              <View className="flex-row items-center justify-between px-1 mb-1">
                <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Total: {formatAmount(totalAmount)}
                </Text>
              </View>
  
              {/* Hint when empty */}
              {splits.length === 0 && (
                <Text className="text-xs text-muted-foreground px-1 mb-1">
                  Add people and their share amounts
                </Text>
              )}
  
              {/* Split entries */}
              {splits.map((split, index) => (
                <View
                  key={index}
                  className="rounded-xl border border-border p-3"
                >
                  <View className="flex-row items-center mb-2">
                    <View className="w-7 h-7 rounded-full items-center justify-center mr-2" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                      <Text className="text-xs font-bold" style={{ color: theme.primary }}>
                        {getPersonName(split.personId).charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => {
                        setEditingIndex(index);
                        setShowPersonPicker(true);
                      }}
                      className="flex-1"
                    >
                      <Text className="text-sm font-semibold text-foreground">
                        {getPersonName(split.personId)}
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => handleRemoveSplit(index)} hitSlop={8}>
                      <Ionicons name="close-circle" size={20} color={theme.danger} />
                    </Pressable>
                  </View>
                  <View className="flex-row gap-2">
                    <TextInput
                      className="flex-1 border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                      placeholder="What for? (e.g. Electricity)"
                      placeholderTextColor={colors.tabIconDefault}
                      value={split.description}
                      onChangeText={(v) => handleUpdateSplitDescription(index, v)}
                    />
                    <TextInput
                      className="w-24 border border-border rounded-lg px-3 py-2 text-sm text-foreground text-right"
                      placeholder="₹0"
                      placeholderTextColor={colors.tabIconDefault}
                      keyboardType="decimal-pad"
                      value={amountDrafts[index] ?? (split.amount > 0 ? String(split.amount) : "")}
                      onChangeText={(v) => handleUpdateSplitAmount(index, v)}
                    />
                  </View>
                </View>
              ))}
  
              {/* Add split button */}
              <Pressable
                onPress={handleAddSplit}
                className="flex-row items-center justify-center py-3 rounded-xl border border-dashed"
                style={{ borderColor: theme.alpha("primary", 0.25) }}
              >
                <Ionicons name="add-circle-outline" size={18} color={theme.primary} />
                <Text className="text-sm font-medium ml-2" style={{ color: theme.primary }}>
                  Add Split
                </Text>
              </Pressable>
  
              {/* Summary */}
              {splits.length > 0 && (
                <View className="bg-background rounded-2xl p-4 gap-2 mt-1">
                  <View className="flex-row justify-between">
                    <Text className="text-xs text-muted-foreground">Total splits</Text>
                    <Text className="text-xs font-semibold text-foreground">
                      {formatAmount(totalSplitAmount)}
                    </Text>
                  </View>
  
                  {convenienceFee > 0 && (
                    <>
                      <View className="flex-row justify-between">
                        <Text className="text-xs text-muted-foreground">My share</Text>
                        <Text className="text-xs font-semibold" style={{ color: theme.warning }}>
                          {formatAmount(convenienceFee)}
                        </Text>
                      </View>
  
                      <View className="flex-row mt-1 mb-1">
                        <Pressable
                          onPress={() => setFeeAbsorbed(true)}
                          className="flex-1 py-2 items-center rounded-l-lg border"
                          style={feeAbsorbed
                            ? { borderColor: theme.primary, backgroundColor: theme.alpha("primary", 0.08) }
                            : { borderColor: colors.border }
                          }
                        >
                          <Text
                            className="text-xs font-medium"
                            style={{ color: feeAbsorbed ? theme.primary : colors.textSecondary }}
                          >
                            I absorb
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setFeeAbsorbed(false)}
                          className="flex-1 py-2 items-center rounded-r-lg border border-l-0"
                          style={!feeAbsorbed
                            ? { borderColor: theme.primary, backgroundColor: theme.alpha("primary", 0.08) }
                            : { borderColor: colors.border }
                          }
                        >
                          <Text
                            className="text-xs font-medium"
                            style={{ color: !feeAbsorbed ? theme.primary : colors.textSecondary }}
                          >
                            Split fee
                          </Text>
                        </Pressable>
                      </View>
                    </>
                  )}
  
                  <View className="h-px bg-border" />
  
                  <View className="flex-row justify-between">
                    <Text className="text-sm font-semibold text-foreground">My budget</Text>
                    <Text className="text-sm font-bold" style={{ color: theme.primary }}>
                      {formatAmount(myShare)}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          )}
        </ScrollView>
  
        {/* Confirm button */}
        {!showPersonPicker && (
          <Pressable
            onPress={handleConfirm}
            disabled={!canConfirm}
            className={`mt-4 items-center py-4 rounded-2xl ${!canConfirm ? "bg-border" : ""}`}
            style={canConfirm ? { backgroundColor: theme.primary } : undefined}
          >
            <Text className="text-base font-bold text-primary-foreground">Confirm Split</Text>
          </Pressable>
        )}
      </View>
    </Sheet>
  );
}
