import { useCallback, useEffect, useState } from "react";
import { Switch, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { getFlag } from "@/services/feature-flags";
import { getActiveHousehold, getMembers } from "@/services/household/store";
import { effectiveChoice, fixedSplitNote, setShareChoice, type ShareChoice } from "@/services/household/shares";
import { requestSync } from "@/services/household/sync";
import type { Household } from "@/services/household/types";

interface Props {
  expenseId: string;
  categoryId: string | null;
  /** The whole bill (before any split). Unused since 4.28.2; kept so callers needn't change. */
  total?: number;
  /** Called after the choice is saved (the screen may want to reload). */
  onChanged?: () => void;
}

/**
 * "Shared with Home" on a transaction (Catch Up, the transaction screen): whether the household sees
 * it. Only that - splitting is the transaction's ordinary Split, so there is one split in one place.
 * When it's split with someone in the household it's shared anyway, and this says how instead of
 * offering a switch. Hidden outside a household.
 */
export function SharedWithHome({ expenseId, categoryId, onChanged }: Props) {
  const theme = useTheme();
  const [h, setH] = useState<Household | null>(null);
  const [hasOthers, setHasOthers] = useState(false);
  const [choice, setChoice] = useState<ShareChoice | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!getFlag("household")) return;
    const hh = await getActiveHousehold().catch(() => null);
    setH(hh);
    if (!hh) return;
    setHasOthers((await getMembers(hh.id)).some((m) => m.id !== hh.my_member_id));
    setNote(await fixedSplitNote(hh, expenseId).catch(() => null));
    setChoice(await effectiveChoice(hh, expenseId, categoryId));
  }, [expenseId, categoryId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!h || !choice || !hasOthers) return null;

  return (
    <View className="mt-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: theme.alpha("primary", 0.06) }}>
      <View className="flex-row items-center">
        <Ionicons name="home-outline" size={16} color={theme.primary} />
        <Text className="text-sm text-foreground flex-1 ml-2">{note ? `Shared with ${h.name}` : `${h.name} sees this`}</Text>
        {!note && (
          <Switch
            value={choice.shared}
            onValueChange={async (v) => {
              const next = { ...choice, shared: v };
              setChoice(next);
              await setShareChoice(h, expenseId, next);
              requestSync(1500);
              onChanged?.();
            }}
            accessibilityLabel={`${h.name} sees this`}
          />
        )}
      </View>
      <Text className="text-xs text-muted-foreground mt-2 leading-4">
        {note ?? (choice.shared ? "In Together, in full. Nobody owes anything for it unless you split it." : "Personal: only you see it.")}
      </Text>
    </View>
  );
}
