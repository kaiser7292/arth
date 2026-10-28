import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { getDatabase } from "@/database";

/**
 * On "Paid by Sourav" (my share of a bill someone in the household paid): who paid, and a way to
 * the Hisaab with them, where the same bill is the matching entry (same household_ref).
 */
export function HouseholdShareLink({ householdRef }: { householdRef: string }) {
  const router = useRouter();
  const theme = useTheme();
  const [person, setPerson] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    getDatabase()
      .getFirstAsync<{ id: string; name: string }>(
        `SELECT p.id, p.name FROM hisaab_entries e JOIN hisaab_persons p ON p.id = e.hisaab_person_id
         WHERE e.household_ref = ? LIMIT 1;`,
        householdRef,
      )
      .then(setPerson)
      .catch(() => setPerson(null));
  }, [householdRef]);

  return (
    <View className="mt-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: theme.alpha("primary", 0.06) }}>
      <Text className="text-xs text-muted-foreground leading-4">
        Your share of a bill {person?.name ?? "someone in your household"} paid. It updates when they change it.
      </Text>
      {person && (
        <Pressable
          onPress={() => router.push({ pathname: "/hisaab/ledger", params: { personId: person.id, personName: person.name } })}
          className="flex-row items-center mt-1.5"
          accessibilityRole="button"
          hitSlop={6}
        >
          <Ionicons name="people-outline" size={14} color={theme.primary} />
          <Text className="text-xs font-semibold ml-1" style={{ color: theme.primary }}>Open Hisaab with {person.name}</Text>
        </Pressable>
      )}
    </View>
  );
}
