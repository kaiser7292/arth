import { useState, useCallback, useEffect } from "react";
import { View, Text, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer } from "@/components/ui";
import { DuplicateGroupCard } from "@/components/expense/DuplicateGroupCard";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import { StatusColors } from "@/constants/theme";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getDismissedDuplicateGroups,
  restoreDismissedGroup,
  clearDismissedDuplicates,
  type DismissedGroup,
} from "@/services/duplicate-detection";

export default function DismissedDuplicatesScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors, colorScheme } = useColorScheme();
  const warn = StatusColors[colorScheme].warning;

  const [groups, setGroups] = useState<DismissedGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await getDismissedDuplicateGroups(DEFAULT_USER_ID);
      // Sort: larger clusters first, then by first expense's date desc
      const sorted = [...data].sort((a, b) => {
        if (b.expenses.length !== a.expenses.length) {
          return b.expenses.length - a.expenses.length;
        }
        const ad = a.expenses[0]?.date ?? "";
        const bd = b.expenses[0]?.date ?? "";
        return bd.localeCompare(ad);
      });
      setGroups(sorted);
    } catch {
      // DB not ready
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

  // Also refresh on mount (first render) in case useFocusEffect is skipped
  useEffect(() => {
    load();
  }, [load]);

  const handleRestoreOne = useCallback(
    (key: string) => {
      alert(
        "Restore Group",
        "Flag this group again on the next duplicate scan?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Restore",
            onPress: () => {
              restoreDismissedGroup(key);
              setGroups((prev) => prev.filter((g) => g.key !== key));
            },
          },
        ],
      );
    },
    [alert],
  );

  const handleRestoreAll = useCallback(() => {
    alert(
      "Restore All",
      `Flag all ${groups.length} dismissed groups again on the next scan?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore All",
          onPress: () => {
            clearDismissedDuplicates();
            setGroups([]);
          },
        },
      ],
    );
  }, [alert, groups.length]);

  if (loading) {
    return (
      <ScreenContainer padTop={false} centered>
        <ActivityIndicator size="large" color={colors.blue} />
      </ScreenContainer>
    );
  }

  if (groups.length === 0) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="checkmark-done-outline" size={48} color={colors.textSecondary} />
          <Text className="text-lg font-medium text-foreground mt-4">
            Nothing dismissed
          </Text>
          <Text className="text-sm text-muted-foreground text-center mt-2">
            Groups you mark as "Keep Both" will appear here so you can restore them later.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      {/* Summary + bulk action bar */}
      <View className="flex-row items-center justify-between px-4 py-2.5 border-b border-border">
        <Text className="text-sm text-muted-foreground flex-1 mr-2">
          {groups.length} dismissed group{groups.length !== 1 ? "s" : ""}
        </Text>
        <Pressable
          onPress={handleRestoreAll}
          accessibilityRole="button"
          accessibilityLabel="Restore all dismissed groups"
          className="flex-row items-center py-1.5 px-3 rounded-lg"
          style={{ backgroundColor: warn + "26", borderWidth: 1, borderColor: warn + "66" }}
        >
          <Ionicons name="refresh-outline" size={14} color={warn} />
          <Text className="text-xs font-semibold ml-1" style={{ color: warn }}>
            Restore All
          </Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40, paddingTop: 12 }}
      >
        {groups.map((g, i) => (
          <DuplicateGroupCard
            key={g.key}
            group={{
              expenses: g.expenses,
              reason: `${g.expenses.length} transactions marked as "not duplicates"`,
            }}
            index={i}
            readOnly
            onTapExpense={(id) => router.push(`/expense/${id}`)}
            onRestore={() => handleRestoreOne(g.key)}
          />
        ))}

        {/* Danger: remove this restored group entirely from the dismissals list is not offered —
            the only ways to "remove" a dismissed group are to restore it (flag again) or to delete
            one of its expenses so the group key changes. */}
        <View className="px-4 mt-2">
          <Text className="text-[11px] text-faint-foreground">
            Tip: restoring a group makes it appear in the duplicate review again. To permanently
            dismiss, use "Keep Both" during review - dismissed groups re-surface only if you restore
            them or if a new duplicate joins the cluster.
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
