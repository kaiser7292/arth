/**
 * Hisaab Persons Screen — Task 15.1
 *
 * Person list with running balances, summary card,
 * add/edit person form, navigate to ledger detail.
 */

import { ExportFormatPicker } from "@/components/hisaab/ExportFormatPicker";
import { Button, Card, EmptyState, FAB, Input, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";

import { useAlert } from "@/hooks/use-alert";
import { useBackOverride } from "@/hooks/use-back-override";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { HisaabPersonWithBalance } from "@/services/hisaab";
import {
    createPerson,
    deactivateHisaabPerson,
    getHisaabSummary,
    getPersonsWithBalances,
    updatePerson,
} from "@/services/hisaab";
import { formatAmount } from "@/utils/expense-validation";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";

type ViewMode = "list" | "add_person";

export default function HisaabPersonsScreen() {
  const alert = useAlert();
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [persons, setPersons] = useState<HisaabPersonWithBalance[]>([]);
  const [summary, setSummary] = useState({
    totalOwedToYou: 0,
    totalYouOwe: 0,
    netBalance: 0,
  });
  const [loaded, setLoaded] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const backToList = useCallback(() => setViewMode("list"), []);
  useBackOverride(viewMode !== "list", backToList);

  // Export picker state
  const [showExportPicker, setShowExportPicker] = useState(false);
  const [exportPersonId, setExportPersonId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formInitialBalance, setFormInitialBalance] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    });
    return () => sub.remove();
  }, []);

  const loadData = useCallback(async () => {
    try {
      const data = await getPersonsWithBalances(DEFAULT_USER_ID);
      const summaryData = await getHisaabSummary(DEFAULT_USER_ID);
      setPersons(data);
      setSummary(summaryData);
    } catch {
      // DB not ready
    }
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  // ─── Actions ───────────────────────────────────────────

  const handleSave = async () => {
    const name = formName.trim();
    if (!name) {
      alert("Missing Name", "Enter the person's name.");
      return;
    }

    const initialBalance = parseFloat(formInitialBalance) || 0;

    if (editingId) {
      await updatePerson(editingId, {
        name,
        phone: formPhone.trim() || null,
        email: formEmail.trim() || null,
        initial_balance: initialBalance,
        notes: formNotes.trim() || null,
      });
    } else {
      await createPerson({
        owner_user_id: DEFAULT_USER_ID,
        name,
        phone: formPhone.trim() || undefined,
        email: formEmail.trim() || undefined,
        initial_balance: initialBalance,
        notes: formNotes.trim() || undefined,
      });
    }

    resetForm();
    await loadData();
  };

  const handleDeactivate = (p: HisaabPersonWithBalance) => {
    alert(
      "Remove Person",
      `Remove "${p.name}" from your hisaab? Their records will be preserved.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await deactivateHisaabPerson(p.id);
            await loadData();
          },
        },
      ],
    );
  };

  const handleEdit = (p: HisaabPersonWithBalance) => {
    setEditingId(p.id);
    setFormName(p.name);
    setFormPhone(p.phone ?? "");
    setFormEmail(p.email ?? "");
    setFormInitialBalance(
      p.initial_balance !== 0 ? String(p.initial_balance) : "",
    );
    setFormNotes(p.notes ?? "");
    setViewMode("add_person");
  };

  const handleExportPerson = (pid: string) => {
    setExportPersonId(pid);
    setShowExportPicker(true);
  };

  const resetForm = () => {
    setFormName("");
    setFormPhone("");
    setFormEmail("");
    setFormInitialBalance("");
    setFormNotes("");
    setEditingId(null);
    setViewMode("list");
  };

  // ─── Loading ───────────────────────────────────────────

  if (!loaded) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Loading people..." icon="people-outline" />
      </ScreenContainer>
    );
  }

  // ─── Add/Edit Form ─────────────────────────────────────

  if (viewMode === "add_person") {
    return (
      <ScreenContainer padTop={false}>
        <KeyboardAvoidingView
          behavior="padding"
          className="flex-1"
        >
          <ScrollView
            ref={scrollRef}
            className="flex-1"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
          >
            <View className="px-4 py-4">
              <Card
                title={editingId ? "Edit Person" : "Add Person"}
                className="mb-4"
              >
                <Input
                  label="Name"
                  value={formName}
                  onChangeText={setFormName}
                  placeholder="e.g. Tarun"
                  maxLength={50}
                  containerClassName="mb-3"
                />
                <Input
                  label="Phone (optional)"
                  value={formPhone}
                  onChangeText={setFormPhone}
                  keyboardType="phone-pad"
                  placeholder="e.g. 9876543210"
                  containerClassName="mb-3"
                />
                <Input
                  label="Email (optional)"
                  value={formEmail}
                  onChangeText={setFormEmail}
                  keyboardType="email-address"
                  placeholder="e.g. tarun@example.com"
                  maxLength={100}
                  containerClassName="mb-3"
                />
                <Input
                  label="Initial Balance (Rs, +ve = they owe you)"
                  value={formInitialBalance}
                  onChangeText={setFormInitialBalance}
                  keyboardType="numeric"
                  placeholder="e.g. 5000 or -2000"
                  containerClassName="mb-3"
                />
                <Input
                  label="Notes (optional)"
                  value={formNotes}
                  onChangeText={setFormNotes}
                  placeholder="e.g. College friend, roommate"
                  maxLength={300}
                  containerClassName="mb-4"
                />
                <View className="flex-row">
                  <View className="flex-1 mr-2">
                    <Button
                      title="Cancel"
                      variant="outline"
                      onPress={resetForm}
                    />
                  </View>
                  <View className="flex-1">
                    <Button
                      title={editingId ? "Update" : "Add Person"}
                      onPress={handleSave}
                    />
                  </View>
                </View>
              </Card>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </ScreenContainer>
    );
  }

  // ─── Main List ─────────────────────────────────────────

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        <View className="px-4 py-4">
          {/* Summary Card */}
          {persons.length > 0 && (
            <Card className="mb-4">
              <View className="flex-row mb-2">
                <View className="flex-1">
                  <Text className="text-xs text-muted-foreground">
                    Owed to You
                  </Text>
                  <Text className="text-base font-bold text-success">
                    {formatAmount(summary.totalOwedToYou)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-muted-foreground">
                    You Owe
                  </Text>
                  <Text className="text-base font-bold text-danger">
                    {formatAmount(summary.totalYouOwe)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-muted-foreground">
                    Net
                  </Text>
                  <Text
                    className={`text-base font-bold ${summary.netBalance >= 0 ? "text-success" : "text-danger"}`}
                  >
                    {summary.netBalance >= 0 ? "+" : ""}
                    {formatAmount(summary.netBalance)}
                  </Text>
                </View>
              </View>
            </Card>
          )}


          {/* Empty State */}
          {persons.length === 0 && (
            <Card className="mb-4">
              <EmptyState
                icon="people-outline"
                title="No people yet"
                subtitle="Add family members or friends to track shared expenses"
                fillScreen={false}
              />
            </Card>
          )}

          {/* Person Cards */}
          {persons.map((p) => (
            <PersonCard
              key={p.id}
              person={p}
              onPress={() =>
                router.push({
                  pathname: "/hisaab/ledger",
                  params: { personId: p.id, personName: p.name },
                })
              }
              onLongPress={() => handleDeactivate(p)}
              onEdit={() => handleEdit(p)}
              onExport={() => handleExportPerson(p.id)}
            />
          ))}

          {persons.length > 0 && (
            <Text className="text-xs text-faint-foreground text-center mt-2 mb-4">
              Tap to view ledger. Long-press to remove.
            </Text>
          )}
        </View>
      </ScrollView>

      {/* FAB */}
      <FAB icon="person-add-outline" onPress={() => setViewMode("add_person")} />

      {/* Export Format Picker */}
      {exportPersonId && (
        <ExportFormatPicker
          visible={showExportPicker}
          onClose={() => {
            setShowExportPicker(false);
            setExportPersonId(null);
          }}
          target={{ type: "person", personId: exportPersonId, userId: DEFAULT_USER_ID }}
        />
      )}
    </ScreenContainer>
  );
}

// ─── Person Card Component ──────────────────────────────

function PersonCard({
  person,
  onPress,
  onLongPress,
  onEdit,
  onExport,
}: {
  person: HisaabPersonWithBalance;
  onPress: () => void;
  onLongPress: () => void;
  onEdit: () => void;
  onExport: () => void;
}) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  const balance = person.balance ?? 0;
  const isPositive = balance >= 0;

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress}>
      <Card className="mb-3">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center flex-1">
            {/* Avatar */}
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3"
              style={{
                backgroundColor: isPositive
                  ? theme.alpha("success", 0.08)
                  : theme.alpha("danger", 0.08),
              }}
            >
              <Text
                className="text-base font-bold"
                style={{ color: isPositive ? theme.success : theme.danger }}
              >
                {person.name.charAt(0).toUpperCase()}
              </Text>
            </View>

            {/* Name + metadata */}
            <View className="flex-1">
              <Text
                className="text-sm font-medium text-foreground"
                numberOfLines={1}
              >
                {person.name}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {person.entryCount} entries
                {person.lastEntryDate
                  ? ` · Last: ${person.lastEntryDate}`
                  : ""}
              </Text>
            </View>
          </View>

          {/* Balance + edit */}
          <View className="flex-row items-center">
            <View className="items-end mr-2">
              <Text
                className={`text-base font-bold ${isPositive ? "text-success" : "text-danger"}`}
              >
                {isPositive ? "+" : ""}
                {formatAmount(balance)}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {isPositive
                  ? balance === 0
                    ? "Settled"
                    : "owes you"
                  : "you owe"}
              </Text>
            </View>
            <Pressable onPress={onExport} hitSlop={8} className="mr-2">
              <Ionicons name="download-outline" size={16} color={colors.textSecondary} />
            </Pressable>
            <Pressable onPress={onEdit} hitSlop={8}>
              <Ionicons name="create-outline" size={16} color={colors.blue} />
            </Pressable>
          </View>
        </View>

        {/* Notes */}
        {person.notes && (
          <Text
            className="text-xs text-faint-foreground mt-2"
            numberOfLines={1}
          >
            {person.notes}
          </Text>
        )}
      </Card>
    </Pressable>
  );
}
