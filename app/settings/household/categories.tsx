import { useCallback, useState } from "react";
import { Pressable, ScrollView, Switch, View } from "react-native";
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
 * categories count as each. Spends in a mapped category are shared in full; the rest only as totals.
 */
export default function HouseholdCategoriesScreen() {
  const toast = useToast();
  const theme = useTheme();
  const [h, setH] = useState<Household | null>(null);
  const [hcats, setHcats] = useState<HouseholdCategory[]>([]);
  const [mine, setMine] = useState<{ id: string; name: string }[]>([]);
  const [map, setMap] = useState<Map<string, string>>(new Map());
  const [picking, setPicking] = useState<{ id: string; name: string } | null>(null);
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
              ? "Arth's categories, so everyone's map by name. Spends in the ones marked shared are shared and split as they're approved."
              : "Set by whoever started the household. Spends in the ones marked shared are shared and split as they're approved."}
          </Text>
          {hcats.map((c) => (
            <View key={c.id} className="flex-row items-center py-2 border-b border-border">
              <View className="flex-1">
                <Text className="text-sm text-foreground">{c.name}</Text>
                {!isCreator && c.shared_default ? <Text className="text-xs" style={{ color: theme.primary }}>Shared by default</Text> : null}
              </View>
              {isCreator && (
                <View className="flex-row items-center mr-3">
                  <Text className="text-xs text-muted-foreground mr-1">Shared</Text>
                  <Switch
                    value={!!c.shared_default}
                    onValueChange={(v) =>
                      void saveList(hcats.map((x) => ({ id: x.id, name: x.name, shared: x.id === c.id ? v : !!x.shared_default })))
                    }
                    accessibilityLabel={`${c.name} shared by default`}
                  />
                </View>
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
            Spends in a mapped category are shared in full. The rest count only as totals, if you share totals.
          </Text>
          {mine.map((c) => {
            const mapped = nameOf(map.get(c.id));
            return (
              <Pressable
                key={c.id}
                className="flex-row items-center py-2.5 border-b border-border"
                onPress={() => setPicking(c)}
                accessibilityRole="button"
                accessibilityLabel={`${c.name}: ${mapped ?? "not shared in full"}`}
              >
                <Text className="text-sm text-foreground flex-1">{c.name}</Text>
                <Text className="text-sm mr-1" style={{ color: mapped ? theme.primary : theme.mutedForeground }}>
                  {mapped ?? "Not in full"}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
              </Pressable>
            );
          })}
        </Card>
      </ScrollView>

      <SelectSheet<string>
        visible={!!picking}
        title={picking ? `${picking.name} counts as` : ""}
        value={picking ? (map.get(picking.id) ?? NOT_SHARED) : null}
        options={[
          ...hcats.map((c) => ({ value: c.id, label: c.name })),
          { value: NOT_SHARED, label: "Not household spending", description: "Shared only as a monthly total, if you share totals" },
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
