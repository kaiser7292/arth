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
  }, []);
  useDataRefresh(load);

  if (!h) return <ScreenContainer padTop={false}>{null}</ScreenContainer>;
  const isCreator = h.role === "creator";
  const nameOf = (id: string | undefined) => hcats.find((c) => c.id === id)?.name;

  const saveList = async (list: { id?: string; name: string }[]) => {
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
        <Card className="mb-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Household categories</Text>
          <Text className="text-xs text-muted-foreground mb-2 leading-4">
            {isCreator
              ? "The household's shared spending. Everyone maps their own categories onto these."
              : "Set by whoever started the household. Map your own categories onto these below."}
          </Text>
          {hcats.map((c) => (
            <View key={c.id} className="flex-row items-center py-2 border-b border-border">
              <Text className="text-sm text-foreground flex-1">{c.name}</Text>
              {isCreator && (
                <Pressable
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${c.name}`}
                  onPress={() => void saveList(hcats.filter((x) => x.id !== c.id))}
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
                  void saveList([...hcats, { name: newName.trim() }]);
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
    </ScreenContainer>
  );
}
