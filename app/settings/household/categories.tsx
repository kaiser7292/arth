import { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, Input, ScreenContainer, SelectSheet, Text, useToast } from "@/components/ui";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { categoriesRemapped, saveHouseholdCategories } from "@/services/household/household";
import { getActiveHousehold, getCategoryMap, getHouseholdCategories, setCategoryMapping } from "@/services/household/store";
import type { Household, HouseholdCategory } from "@/services/household/types";
import { createFromTheirs, getTheirCategories, mapTheirCategory, type TheirCategory } from "@/services/household/their-categories";
import { formatError } from "@/utils/error-message";

const NOT_SHARED = "__none__";

/**
 * Household categories (the household's short list, set by whoever started it) and which of my own
 * categories count as each. Spends in a mapped category are household spending; the rest stay personal.
 */
export default function HouseholdCategoriesScreen() {
  const toast = useToast();
  const theme = useTheme();
  const [h, setH] = useState<Household | null>(null);
  const [hcats, setHcats] = useState<HouseholdCategory[]>([]);
  const [mine, setMine] = useState<{ id: string; name: string }[]>([]);
  const [map, setMap] = useState<Map<string, string>>(new Map());
  const [picking, setPicking] = useState<{ id: string; name: string } | null>(null);
  const [ruleFor, setRuleFor] = useState<HouseholdCategory | null>(null);
  const [newName, setNewName] = useState("");
  const [theirs, setTheirs] = useState<TheirCategory[]>([]);
  const [mappingTheirs, setMappingTheirs] = useState<TheirCategory | null>(null);

  const load = useCallback(async () => {
    const hh = await getActiveHousehold();
    setH(hh);
    if (!hh) return;
    const [c, m, own] = await Promise.all([
      getHouseholdCategories(hh.id),
      getCategoryMap(hh.id),
      getDatabase().getAllAsync<{ id: string; name: string }>(
        "SELECT id, name FROM categories WHERE user_id = ? AND is_active = 1 ORDER BY sort_order, name;",
        DEFAULT_USER_ID,
      ),
    ]);
    setHcats(c);
    setMap(m);
    setMine(own);
    setTheirs(await getTheirCategories(hh).catch(() => []));
  }, []);
  useDataRefresh(load);

  if (!h) return <ScreenContainer padTop={false}>{null}</ScreenContainer>;
  const isCreator = h.role === "creator";
  const nameOf = (id: string | undefined) => hcats.find((c) => c.id === id)?.name;

  const saveList = async (list: { id?: string; name: string; shared?: boolean }[]) => {
    try {
      await saveHouseholdCategories(list);
      await load();
    } catch (e) {
      toast(formatError("Categories", e), { tone: "danger" });
    }
  };

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {theirs.length > 0 && (
          <Card className="mb-3">
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Their categories</Text>
            <Text className="text-xs text-muted-foreground mb-2 leading-4">
              Categories others in {h.name} file shared bills under that you don&apos;t have. Your share of those bills goes where you choose.
            </Text>
            {theirs.map((t) => (
              <View key={t.name} className="py-2.5 border-b border-border">
                <View className="flex-row items-center">
                  <View className="flex-1 mr-2">
                    <Text className="text-sm text-foreground">{t.name}</Text>
                    <Text className="text-xs text-muted-foreground">
                      {t.members.join(", ")}
                      {t.mappedTo ? ` · goes to your ${mine.find((c) => c.id === t.mappedTo)?.name ?? "category"}` : t.suggestion ? ` · closest: your ${t.suggestion.name}` : ""}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setMappingTheirs(t)}
                    className="px-3 py-1 rounded-full border mr-2"
                    style={{ borderColor: theme.alpha("foreground", 0.15) }}
                    accessibilityRole="button"
                  >
                    <Text className="text-xs" style={{ color: theme.primary }}>{t.mappedTo ? "Change" : "Map"}</Text>
                  </Pressable>
                  {!t.mappedTo && (
                    <Pressable
                      onPress={async () => {
                        try {
                          await createFromTheirs(h, t.name);
                          toast(`Added ${t.name} to your categories`);
                          await load();
                        } catch (e) {
                          toast(formatError("Categories", e), { tone: "danger" });
                        }
                      }}
                      className="px-3 py-1 rounded-full"
                      style={{ backgroundColor: theme.alpha("primary", 0.12) }}
                      accessibilityRole="button"
                    >
                      <Text className="text-xs font-semibold" style={{ color: theme.primary }}>Create</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            ))}
          </Card>
        )}

        <Card className="mb-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Household categories</Text>
          <Text className="text-xs text-muted-foreground mb-2 leading-4">
            {isCreator
              ? "Arth's categories, so everyone's map by name. Always share: every spend shows in Together. Only when split: a spend shows once it's split with someone in the household."
              : "Set by whoever started the household. Always share: every spend shows in Together. Only when split: a spend shows once it's split with someone in the household."}
          </Text>
          {hcats.map((c) => (
            <View key={c.id} className="flex-row items-center py-2 border-b border-border">
              <Text className="text-sm text-foreground flex-1">{c.name}</Text>
              {isCreator ? (
                <Pressable
                  onPress={() => setRuleFor(c)}
                  className="flex-row items-center mr-3"
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.name}: ${c.shared_default ? "always share" : "share only when split"}`}
                >
                  <Text className="text-xs font-medium" style={{ color: theme.primary }}>{c.shared_default ? "Always" : "When split"}</Text>
                  <Ionicons name="chevron-down" size={12} color={theme.primary} style={{ marginLeft: 2 }} />
                </Pressable>
              ) : (
                <Text className="text-xs text-muted-foreground">{c.shared_default ? "Always" : "When split"}</Text>
              )}
              {isCreator && (
                <Pressable
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${c.name}`}
                  onPress={() => void saveList(hcats.filter((x) => x.id !== c.id).map((x) => ({ id: x.id, name: x.name, shared: !!x.shared_default })))}
                >
                  <Ionicons name="close" size={18} color={theme.mutedForeground} />
                </Pressable>
              )}
            </View>
          ))}
          {isCreator && (
            <View className="flex-row items-end mt-3 gap-2">
              <View className="flex-1">
                <Input value={newName} onChangeText={setNewName} placeholder="Add a category, e.g. Kids" maxLength={40} />
              </View>
              <Button
                title="Add"
                variant="outline"
                onPress={() => {
                  if (!newName.trim()) return;
                  void saveList([...hcats.map((x) => ({ id: x.id, name: x.name, shared: !!x.shared_default })), { name: newName.trim(), shared: false }]);
                  setNewName("");
                }}
              />
            </View>
          )}
        </Card>

        <Card>
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Your categories</Text>
          <Text className="text-xs text-muted-foreground mb-2 leading-4">
            Tap one to say which household category it counts as. Spends in those are household spending; the rest stay personal.
          </Text>
          {mine.map((c) => {
            const mapped = nameOf(map.get(c.id));
            return (
              <Pressable
                key={c.id}
                className="flex-row items-center py-2.5 border-b border-border"
                onPress={() => setPicking(c)}
                accessibilityRole="button"
                accessibilityLabel={`${c.name}: ${mapped ?? "personal"}`}
              >
                <Text className="text-sm text-foreground flex-1">{c.name}</Text>
                <Text className="text-sm mr-1" style={{ color: mapped ? theme.primary : theme.mutedForeground }}>
                  {mapped ?? "Personal"}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
              </Pressable>
            );
          })}
        </Card>
      </ScrollView>

      <SelectSheet<"always" | "split">
        visible={!!ruleFor}
        title={ruleFor ? `Share ${ruleFor.name}` : ""}
        value={ruleFor ? (ruleFor.shared_default ? "always" : "split") : null}
        options={[
          { value: "always", label: "Always share", description: "Every spend shows in Together" },
          { value: "split", label: "Share only when split", description: "A spend shows once it's split with someone in the household" },
        ]}
        onChange={(v) => {
          if (!ruleFor) return;
          void saveList(hcats.map((x) => ({ id: x.id, name: x.name, shared: x.id === ruleFor.id ? v === "always" : !!x.shared_default })));
        }}
        onClose={() => setRuleFor(null)}
      />

      <SelectSheet<string>
        visible={!!picking}
        title={picking ? `${picking.name} counts as` : ""}
        value={picking ? (map.get(picking.id) ?? NOT_SHARED) : null}
        options={[
          ...hcats.map((c) => ({ value: c.id, label: c.name })),
          { value: NOT_SHARED, label: "Personal", description: "Not household spending. Shared only if you share every transaction" },
        ]}
        onChange={async (v) => {
          if (!picking) return;
          await setCategoryMapping(h.id, picking.id, v === NOT_SHARED ? null : v);
          await categoriesRemapped();
          await load();
        }}
        onClose={() => setPicking(null)}
      />

      <SelectSheet<string>
        visible={!!mappingTheirs}
        title={mappingTheirs ? `Their "${mappingTheirs.name}" goes to` : ""}
        value={mappingTheirs?.mappedTo ?? mappingTheirs?.suggestion?.id ?? null}
        options={mine.map((c) => ({ value: c.id, label: c.name }))}
        onChange={async (v) => {
          if (!mappingTheirs) return;
          await mapTheirCategory(h, mappingTheirs.name, v);
          await load();
        }}
        onClose={() => setMappingTheirs(null)}
      />
    </ScreenContainer>
  );
}
