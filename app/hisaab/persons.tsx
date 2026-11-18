/**
 * Hisaab Persons Screen — Task 15.1
 *
 * Person list with running balances, summary card,
 * add/edit person form, navigate to ledger detail.
 */

import { Card, EmptyState, FAB, Input, LoadingState, ScreenContainer, Segmented, Text } from "@/components/ui";
import { StatTile } from "@/components/ui/LinkRow";
import { FoldGroup, FormFooter, FormGroup } from "@/components/ui/FormParts";
import { tint } from "@/constants/brand";
import { DEFAULT_USER_ID } from "@/constants/app";

import { useAlert } from "@/hooks/use-alert";
import { useBackOverride } from "@/hooks/use-back-override";
import type { HisaabPersonWithBalance } from "@/services/hisaab";
import {
    createPerson,
    deactivateHisaabPerson,
    getHisaabSummary,
    getPersonsWithBalances,
    updatePerson,
} from "@/services/hisaab";
import { formatAmount } from "@/utils/expense-validation";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";
import { GroupHeading, ListToolbar } from "@/components/ui";
import { useListTools } from "@/hooks/use-list-tools";
import type { ListField, ListSort } from "@/utils/list-tools";

type ViewMode = "list" | "add_person";

const PEOPLE_FIELDS: ListField<HisaabPersonWithBalance>[] = [
  {
    id: "status",
    label: "Who owes",
    keyOf: (p) => (p.balance > 0 ? "They owe you" : p.balance < 0 ? "You owe" : "All settled"),
    filter: true,
    group: true,
  },
];
const PEOPLE_SORTS: ListSort<HisaabPersonWithBalance>[] = [
  { id: "listed", label: "As listed" },
  { id: "name", label: "Name (A–Z)", compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "owed", label: "Owed to you (most first)", compare: (a, b) => b.balance - a.balance },
  { id: "owe", label: "You owe (most first)", compare: (a, b) => a.balance - b.balance },
  { id: "recent", label: "Latest entry first", compare: (a, b) => (b.lastEntryDate ?? "").localeCompare(a.lastEntryDate ?? "") },
];
const peopleSearch = (p: HisaabPersonWithBalance) => ({ texts: [p.name, p.phone, p.email], amounts: [Math.abs(p.balance)] });

export default function HisaabPersonsScreen() {
  const alert = useAlert();
  const router = useRouter();
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const editOpened = useRef<string | null>(null);
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

  const [loadFailed, setLoadFailed] = useState(false);
  const loadData = useCallback(async () => {
    try {
      const data = await getPersonsWithBalances(DEFAULT_USER_ID);
      const summaryData = await getHisaabSummary(DEFAULT_USER_ID);
      setPersons(data);
      setSummary(summaryData);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
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
      alert("Missing name", "Enter the person's name.");
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
      "Remove person",
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


  const resetForm = () => {
    setFormName("");
    setFormPhone("");
    setFormEmail("");
    setFormInitialBalance("");
    setFormNotes("");
    setEditingId(null);
    setViewMode("list");
  };

  // Arriving from a ledger's Edit pill: open that person's form once the list has loaded.
  useEffect(() => {
    if (!loaded || !edit || editOpened.current === edit) return;
    const p = persons.find((x) => x.id === edit);
    if (p) {
      editOpened.current = edit;
      handleEdit(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, edit, persons]);

  // ─── Loading ───────────────────────────────────────────

  // All / Owe you / You owe: a quick switch over the one list (the filter sheet keeps the full set).
  const [show, setShow] = useState<"all" | "owed" | "owe">("all");
  const shownPersons = show === "all" ? persons : persons.filter((p) => (show === "owed" ? p.balance > 0 : p.balance < 0));
  const owedCount = persons.filter((p) => p.balance > 0).length;
  const oweCount = persons.filter((p) => p.balance < 0).length;

  const tools = useListTools<HisaabPersonWithBalance>({
    screen: "hisaab_people",
    noun: { one: "person", many: "people" },
    rows: shownPersons,
    fields: PEOPLE_FIELDS,
    sorts: PEOPLE_SORTS,
    search: peopleSearch,
    searchPlaceholder: "Search name or >5000",
    amountOf: (p) => p.balance,
  });

  if (!loaded) {
    return (
      <ScreenContainer padTop={false}>
        {loadFailed && <LoadFailedBanner onRetry={loadData} />}
        <LoadingState message="Loading people..." icon="people-outline" />
      </ScreenContainer>
    );
  }

  // ─── Add/Edit Form ─────────────────────────────────────

  if (viewMode === "add_person") {
    return (
      <ScreenContainer padTop={false}>
        <Stack.Screen options={{ title: editingId ? "Edit person" : "Add person" }} />
        {loadFailed && <LoadFailedBanner onRetry={loadData} />}
        <KeyboardAvoidingView behavior="padding" className="flex-1">
          <ScrollView
            ref={scrollRef}
            className="flex-1"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
          >
            <View className="px-4 py-4" style={{ gap: 12 }}>
              <FormGroup icon="person-outline" title="Who" hint="Family or friends you share money with">
                <Input label="Name" value={formName} onChangeText={setFormName} placeholder="e.g. Jane Doe" maxLength={50} />
                <View>
                  <Input
                    label="Opening balance"
                    prefix="₹"
                    value={formInitialBalance}
                    onChangeText={setFormInitialBalance}
                    keyboardType="numeric"
                    formula
                    placeholder="5000 or -2000"
                  />
                  <Text className="text-label text-muted-foreground mt-1.5">Plus if they owe you, minus if you owe them.</Text>
                </View>
              </FormGroup>
              <FoldGroup
                title="Contact and notes"
                sub={
                  [formPhone, formEmail, formNotes].some((v) => v.trim())
                    ? [formPhone.trim(), formEmail.trim(), formNotes.trim() ? "notes" : ""].filter(Boolean).join(" · ")
                    : "Optional · phone, email, notes"
                }
                icon="call-outline"
                defaultOpen={[formPhone, formEmail, formNotes].some((v) => v.trim())}
              >
                <Input label="Phone" value={formPhone} onChangeText={setFormPhone} keyboardType="phone-pad" placeholder="e.g. 9876543210" />
                <Input
                  label="Email"
                  value={formEmail}
                  onChangeText={setFormEmail}
                  keyboardType="email-address"
                  placeholder="e.g. tarun@example.com"
                  maxLength={100}
                />
                <Input label="Notes" value={formNotes} onChangeText={setFormNotes} placeholder="e.g. College friend, roommate" maxLength={300} />
              </FoldGroup>
            </View>
          </ScrollView>
          <FormFooter primary={editingId ? "Save person" : "Add person"} onPrimary={handleSave} onCancel={resetForm} />
        </KeyboardAvoidingView>
      </ScreenContainer>
    );
  }

  // ─── Main List ─────────────────────────────────────────

  return (
    <ScreenContainer padTop={false}>
      {loadFailed && <LoadFailedBanner onRetry={loadData} />}
      {persons.length > 0 && (
        <View className="px-4 pt-3" style={{ gap: 10 }}>
          {/* Owed to you / You owe */}
          <View className="flex-row" style={{ gap: 8 }}>
            <StatTile
              label="Owed to you"
              value={formatAmount(summary.totalOwedToYou)}
              valueColor={summary.totalOwedToYou > 0 ? theme.success : undefined}
              sub={`${owedCount} ${owedCount === 1 ? "person" : "people"}`}
              onPress={() => setShow(show === "owed" ? "all" : "owed")}
            />
            <StatTile
              label="You owe"
              value={formatAmount(summary.totalYouOwe)}
              sub={`${oweCount} ${oweCount === 1 ? "person" : "people"}`}
              onPress={() => setShow(show === "owe" ? "all" : "owe")}
            />
          </View>
          <Text className="text-meta text-muted-foreground px-1">
            Net {summary.netBalance >= 0 ? "owed to you" : "you owe"}: {formatAmount(Math.abs(summary.netBalance))}
          </Text>
        </View>
      )}
      {persons.length > 0 && <ListToolbar {...tools.toolbar} />}
      {tools.filterSheet}
      {persons.length > 0 && (
        <Segmented<"all" | "owed" | "owe">
          className="mx-4 mt-2 mb-2"
          options={[
            { value: "all", label: "All" },
            { value: "owed", label: "Owe you" },
            { value: "owe", label: "You owe" },
          ]}
          value={show}
          onChange={setShow}
        />
      )}
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 96 }}>
        <View className="px-4 py-3">
          {persons.length === 0 && (
            <Card className="mb-4">
              <EmptyState icon="people-outline" title="No people yet" subtitle="Add family members or friends to track shared expenses" fillScreen={false} />
            </Card>
          )}

          {tools.rows.length === 0 && (tools.narrowed || show !== "all") && persons.length > 0 && (
            <Text className="text-meta text-muted-foreground text-center py-8">Nothing matches.</Text>
          )}

          <View className="rounded-card bg-card border border-border overflow-hidden" style={{ display: tools.rows.length > 0 ? "flex" : "none" }}>
            {tools.grouped.map((row, i) => {
              if (row.type === "heading")
                return (
                  <View key={`group-${row.key}`} className="px-3.5 pt-2">
                    <GroupHeading label={row.label} count={row.count} total={row.total} inset={false} open={row.open} onToggle={row.onToggle} noun={row.noun} />
                  </View>
                );
              const p = row.item;
              return (
                <PersonRow
                  key={p.id}
                  person={p}
                  divider={i > 0}
                  onPress={() => router.push({ pathname: "/hisaab/ledger", params: { personId: p.id, personName: p.name } })}
                  onLongPress={() => handleDeactivate(p)}
                  onEdit={() => handleEdit(p)}
                />
              );
            })}
          </View>

          {persons.length > 0 && (
            <Text className="text-label text-faint-foreground text-center mt-3">Tap to open the ledger. Long-press to remove.</Text>
          )}
        </View>
      </ScrollView>

      <FAB icon="add" label="Person" onPress={() => setViewMode("add_person")} />
    </ScreenContainer>
  );
}

/**
 * `2026-08-28` is six characters longer than it needs to be, and it was what pushed the meta
 * line onto a second row. The year is dropped when it is the current one - on a ledger you
 * are looking at now, it is noise.
 */
function prettyDay(iso: string): string {
  const parts = iso.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return iso;
  const [y, m, d] = parts;
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// ─── Person row ─────────────────────────────────────────

function PersonRow({
  person,
  divider,
  onPress,
  onLongPress,
  onEdit,
}: {
  person: HisaabPersonWithBalance;
  divider: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onEdit: () => void;
}) {
  const theme = useTheme();
  const balance = person.balance ?? 0;
  const dir = balance > 0 ? "owes you" : balance < 0 ? "you owe" : "settled";
  const avatar = theme.data.series[(person.name.charCodeAt(0) || 0) % theme.data.series.length];
  // Contact details: phone leads because it is what you reach for when settling up.
  const contact = [person.phone, person.email].filter(Boolean).join(" · ");
  const meta = [
    `${person.entryCount} ${person.entryCount === 1 ? "entry" : "entries"}${person.lastEntryDate ? ` · ${prettyDay(person.lastEntryDate)}` : ""}`,
    contact,
    person.notes ?? "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className={`flex-row items-center px-3.5 ${divider ? "border-t border-border" : ""}`}
      style={{ minHeight: 64, gap: 12 }}
      accessibilityRole="button"
      accessibilityLabel={`${person.name}, ${formatAmount(Math.abs(balance))} ${dir}`}
      accessibilityHint="Long-press to remove"
    >
      <View className="w-10 h-10 rounded-pill items-center justify-center" style={{ backgroundColor: balance === 0 ? theme.alpha("foreground", 0.06) : tint(avatar, 0.1) }}>
        <Text className="text-meta font-bold" style={{ color: balance === 0 ? theme.mutedForeground : avatar }}>
          {initials(person.name)}
        </Text>
      </View>
      <View className="flex-1" style={{ minWidth: 0 }}>
        <Text className="text-body font-semibold text-foreground" numberOfLines={1}>
          {person.name}
        </Text>
        <Text className="text-meta text-muted-foreground" numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <View className="items-end">
        <Text
          className="text-body font-bold"
          style={{ color: balance > 0 ? theme.success : balance < 0 ? theme.foreground : theme.mutedForeground, fontVariant: ["tabular-nums"] }}
        >
          {formatAmount(Math.abs(balance))}
        </Text>
        <Text className="text-label text-muted-foreground">{dir}</Text>
      </View>
      <Pressable onPress={onEdit} hitSlop={8} className="p-1" accessibilityRole="button" accessibilityLabel={`Edit ${person.name}`}>
        <Ionicons name="create-outline" size={18} color={theme.mutedForeground} />
      </Pressable>
    </Pressable>
  );
}
