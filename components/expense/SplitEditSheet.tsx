import { useEffect, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, FormulaTextInput, Sheet, Text, SearchField } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import { createPerson, getPersonsWithBalances, type HisaabPersonWithBalance } from "@/services/hisaab";
import { draftShares, emptyDraft, type DraftMode, type SplitDraft } from "@/services/split-draft";
import { formatAmount } from "@/utils/format";

interface Props {
  visible: boolean;
  onClose: () => void;
  totalAmount: number;
  /** The split as it stands; null to start a new one. */
  initial: SplitDraft | null;
  onSave: (draft: SplitDraft) => void | Promise<void>;
  onRemove?: () => void;
  /** The add form saves one person with the new expense; more can be added on the saved expense. */
  onePersonOnly?: boolean;
}

/** One sheet for every split: who paid, how it's divided, with whom. Opens filled in with the current split. */
export function SplitEditSheet({ visible, onClose, totalAmount, initial, onSave, onRemove, onePersonOnly }: Props) {
  const theme = useTheme();
  const [draft, setDraft] = useState<SplitDraft>(initial ?? emptyDraft());
  const [persons, setPersons] = useState<HisaabPersonWithBalance[]>([]);
  const [picking, setPicking] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDraft(initial ?? emptyDraft());
    setPicking(!initial || initial.people.length === 0);
    setNewName("");
    setSaving(false);
    getPersonsWithBalances(DEFAULT_USER_ID).then(setPersons).catch(() => setPersons([]));
  }, [visible, initial]);

  const nameOf = (id: string) => persons.find((p) => p.id === id)?.name ?? "Someone";
  const { me, people: shares, error } = draftShares(totalAmount, draft);
  const single = draft.people.length === 1;
  const canAddMore = !onePersonOnly && draft.paidBy === "me";

  const setValue = (index: number, patch: { value?: string; description?: string }) =>
    setDraft((d) => ({ ...d, people: d.people.map((p, i) => (i === index ? { ...p, ...patch } : p)) }));

  const addPerson = (personId: string) => {
    setDraft((d) => (d.people.some((p) => p.personId === personId) ? d : { ...d, people: [...d.people, { personId, value: "", description: "" }] }));
    setPicking(false);
  };

  const removePerson = (personId: string) =>
    setDraft((d) => ({
      ...d,
      paidBy: d.paidBy === personId ? "me" : d.paidBy,
      people: d.people.filter((p) => p.personId !== personId),
    }));

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    const id = await createPerson({ owner_user_id: DEFAULT_USER_ID, name });
    setPersons(await getPersonsWithBalances(DEFAULT_USER_ID));
    setNewName("");
    addPerson(id);
  };

  const save = async () => {
    if (error || saving) return;
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const modes: { mode: DraftMode; label: string }[] = [
    { mode: "equal", label: "Equal" },
    { mode: "percent", label: "Percent" },
    { mode: "amount", label: "Amount" },
    { mode: "full", label: draft.paidBy === "me" ? "They owe all" : "You owe all" },
  ];

  // Most used first (by entries), then by name; the search filters as you type.
  const choosable = persons
    .filter((p) => !draft.people.some((x) => x.personId === p.id))
    .sort((a, b) => (b.entryCount ?? 0) - (a.entryCount ?? 0) || a.name.localeCompare(b.name));
  const shownPeople = newName.trim()
    ? choosable.filter((p) => p.name.toLowerCase().includes(newName.trim().toLowerCase()))
    : choosable;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="px-5 pt-1">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-heading font-bold text-foreground">{picking ? "With whom?" : `Split ${formatAmount(totalAmount)}`}</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={theme.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} className="max-h-[440px]" keyboardShouldPersistTaps="handled">
          {picking ? (
            <View className="pb-2">
              <SearchField value={newName} onChangeText={setNewName} placeholder="Search people or type a new name" autoFocus accessibilityLabel="Search people" />
              <Text className="text-label text-muted-foreground mt-2 mb-1">
                {newName.trim()
                  ? `${shownPeople.length} of ${choosable.length}`
                  : `${choosable.length} ${choosable.length === 1 ? "person" : "people"} · most used first`}
              </Text>
              {newName.trim() !== "" && !choosable.some((p) => p.name.trim().toLowerCase() === newName.trim().toLowerCase()) && (
                <Pressable
                  onPress={() => void createAndAdd()}
                  className="flex-row items-center px-3.5 rounded-control border border-dashed my-1"
                  style={{ minHeight: 48, gap: 10, borderColor: theme.primary }}
                  accessibilityRole="button"
                >
                  <Ionicons name="add" size={18} color={theme.primary} />
                  <Text className="flex-1 text-body font-semibold" style={{ color: theme.primary }} numberOfLines={1}>
                    Add “{newName.trim()}”
                  </Text>
                </Pressable>
              )}
              {shownPeople.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    setNewName("");
                    addPerson(p.id);
                  }}
                  className="flex-row items-center py-3 border-b border-border"
                  style={{ gap: 10 }}
                  accessibilityRole="button"
                >
                  <Text className="text-body text-foreground flex-1" numberOfLines={1}>{p.name}</Text>
                  <Text className="text-meta text-muted-foreground">
                    {p.balance > 0 ? `owes you ${formatAmount(p.balance)}` : p.balance < 0 ? `you owe ${formatAmount(-p.balance)}` : "settled"}
                  </Text>
                </Pressable>
              ))}
              {draft.people.length > 0 && (
                <Pressable onPress={() => setPicking(false)} className="items-center py-3" accessibilityRole="button">
                  <Text className="text-body font-medium text-muted-foreground">Back</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View className="pb-2">
              <Label>Paid by</Label>
              <View className="flex-row flex-wrap mb-3" style={{ gap: 6 }}>
                <Chip label="You" on={draft.paidBy === "me"} onPress={() => setDraft((d) => ({ ...d, paidBy: "me" }))} />
                {single && (
                  <Chip
                    label={nameOf(draft.people[0].personId)}
                    on={draft.paidBy === draft.people[0].personId}
                    onPress={() => setDraft((d) => ({ ...d, paidBy: d.people[0].personId }))}
                  />
                )}
              </View>

              <Label>Split by</Label>
              <View className="flex-row flex-wrap mb-3" style={{ gap: 6 }}>
                {modes.map((m) => (
                  <Chip key={m.mode} label={m.label} on={draft.mode === m.mode} onPress={() => setDraft((d) => ({ ...d, mode: m.mode }))} />
                ))}
              </View>

              <Label>Shares</Label>
              <View className="flex-row items-center justify-between py-2 border-b border-border">
                <Text className="text-meta text-foreground">You</Text>
                <Text className="text-body font-semibold text-foreground">{formatAmount(me)}</Text>
              </View>
              {draft.people.map((p, i) => (
                <View key={p.personId} className="py-2 border-b border-border">
                  <View className="flex-row items-center">
                    <Pressable onPress={() => removePerson(p.personId)} hitSlop={8} className="mr-2" accessibilityRole="button" accessibilityLabel={`Remove ${nameOf(p.personId)}`}>
                      <Ionicons name="close-circle-outline" size={18} color={theme.mutedForeground} />
                    </Pressable>
                    <Text className="text-meta text-foreground flex-1 mr-2" numberOfLines={1}>{nameOf(p.personId)}</Text>
                    {draft.mode === "percent" ? (
                      <View className="flex-row items-center">
                        <TextInput
                          className="w-14 border border-border rounded-control px-2 py-1.5 text-meta text-foreground text-right"
                          keyboardType="number-pad"
                          maxLength={3}
                          placeholder="0"
                          placeholderTextColor={theme.faintForeground}
                          value={p.value}
                          onChangeText={(v) => setValue(i, { value: v.replace(/[^0-9]/g, "") })}
                          accessibilityLabel={`${nameOf(p.personId)}'s percentage`}
                        />
                        <Text className="text-meta text-muted-foreground ml-1 mr-2">%</Text>
                        <Text className="text-body font-semibold text-foreground">{formatAmount(shares[i] ?? 0)}</Text>
                      </View>
                    ) : draft.mode === "amount" ? (
                      <FormulaTextInput
                        className="w-28 border border-border rounded-control px-2 py-1.5 text-meta text-foreground text-right"
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={theme.faintForeground}
                        value={p.value}
                        onChangeText={(v: string) => setValue(i, { value: v })}
                        accessibilityLabel={`${nameOf(p.personId)}'s amount`}
                      />
                    ) : (
                      <Text className="text-body font-semibold text-foreground">{formatAmount(shares[i] ?? 0)}</Text>
                    )}
                  </View>
                  {draft.people.length > 1 && (
                    <TextInput
                      className="text-label text-foreground mt-1.5 ml-6 py-1"
                      placeholder="What for? (optional)"
                      placeholderTextColor={theme.faintForeground}
                      value={p.description}
                      onChangeText={(v) => setValue(i, { description: v })}
                    />
                  )}
                </View>
              ))}
              {canAddMore || draft.people.length === 0 ? (
                <Pressable onPress={() => setPicking(true)} className="flex-row items-center py-3" accessibilityRole="button">
                  <Ionicons name="add" size={16} color={theme.primary} />
                  <Text className="text-body font-medium ml-1" style={{ color: theme.primary }}>Add person</Text>
                </Pressable>
              ) : null}
              {error && draft.people.length > 0 ? <Text className="text-label mt-1" style={{ color: theme.danger }}>{error}</Text> : null}
            </View>
          )}
        </ScrollView>

        {!picking && (
          <View className="flex-row items-center mt-3" style={{ gap: 12 }}>
            {onRemove && (
              <Pressable onPress={onRemove} hitSlop={8} accessibilityRole="button">
                <Text className="text-body font-medium" style={{ color: theme.danger }}>Remove split</Text>
              </Pressable>
            )}
            <Button title="Save" className="flex-1" onPress={() => void save()} disabled={!!error} loading={saving} />
          </View>
        )}
      </View>
    </Sheet>
  );
}

function Label({ children }: { children: string }) {
  return <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{children}</Text>;
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="px-3 py-1.5 rounded-full border"
      style={on ? { borderColor: theme.primary, backgroundColor: theme.alpha("primary", 0.1) } : { borderColor: theme.border }}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
    >
      <Text className="text-meta" style={{ color: on ? theme.primary : theme.mutedForeground }}>{label}</Text>
    </Pressable>
  );
}
