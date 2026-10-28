import { useCallback, useEffect, useState } from "react";
import { Pressable, Switch, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { getFlag } from "@/services/feature-flags";
import { formatAmount } from "@/utils/format";
import { getActiveHousehold, getMembers } from "@/services/household/store";
import { effectiveChoice, setShareChoice, type ShareChoice, type SplitKind } from "@/services/household/shares";
import { requestSync } from "@/services/household/sync";
import type { Household } from "@/services/household/types";

interface Props {
  expenseId: string;
  categoryId: string | null;
  /** The whole bill (before any split). */
  total: number;
  /** Called after the choice is saved (the screen may want to reload). */
  onChanged?: () => void;
}

const SPLITS: { kind: SplitKind; label: string }[] = [
  { kind: "equal", label: "Split equally" },
  { kind: "payer_all", label: "I pay all" },
  { kind: "custom", label: "Custom" },
];

/**
 * "Shared with Home" on a transaction (Catch Up, the transaction screen): whether the household sees
 * it and how it's split. Hidden outside a household. Household-category spends start shared.
 */
export function SharedWithHome({ expenseId, categoryId, total, onChanged }: Props) {
  const theme = useTheme();
  const [h, setH] = useState<Household | null>(null);
  const [others, setOthers] = useState<string[]>([]);
  const [choice, setChoice] = useState<ShareChoice | null>(null);
  const [pct, setPct] = useState("");

  const load = useCallback(async () => {
    if (!getFlag("household")) return;
    const hh = await getActiveHousehold().catch(() => null);
    setH(hh);
    if (!hh) return;
    setOthers((await getMembers(hh.id)).filter((m) => m.id !== hh.my_member_id).map((m) => m.name));
    const c = await effectiveChoice(hh, expenseId, categoryId);
    setChoice(c);
    setPct(c.myPct != null ? String(Math.round(c.myPct)) : "");
  }, [expenseId, categoryId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!h || !choice || others.length === 0) return null;

  const save = async (next: ShareChoice) => {
    setChoice(next);
    await setShareChoice(h, expenseId, next);
    requestSync(1500);
    onChanged?.();
  };

  const n = others.length + 1;
  const myPct = choice.split === "custom" && choice.myPct != null ? choice.myPct : choice.split === "payer_all" ? 100 : 100 / n;
  const mine = Math.round((total * myPct) / 100);
  const theirs = Math.round((total - mine) / others.length);
  const who = others.length === 1 ? others[0] : `Each of the ${others.length} others`;

  return (
    <View className="mt-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: theme.alpha("primary", 0.06) }}>
      <View className="flex-row items-center">
        <Ionicons name="home-outline" size={16} color={theme.primary} />
        <Text className="text-sm text-foreground flex-1 ml-2">Shared with {h.name}</Text>
        <Switch
          value={choice.shared}
          onValueChange={(v) => void save({ ...choice, shared: v })}
          accessibilityLabel={`Shared with ${h.name}`}
        />
      </View>
      {choice.shared && (
        <>
          <View className="flex-row flex-wrap gap-1.5 mt-2">
            {SPLITS.map((s) => {
              const on = choice.split === s.kind;
              return (
                <Pressable
                  key={s.kind}
                  onPress={() => void save({ ...choice, split: s.kind, myPct: s.kind === "custom" ? (choice.myPct ?? Math.round(100 / n)) : null })}
                  className="px-3 py-1 rounded-full border"
                  style={{ borderColor: on ? "transparent" : theme.alpha("foreground", 0.15), backgroundColor: on ? theme.alpha("primary", 0.14) : "transparent" }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                >
                  <Text className="text-xs" style={{ color: on ? theme.primary : theme.mutedForeground }}>{s.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {choice.split === "custom" && (
            <View className="flex-row items-center mt-2">
              <Text className="text-xs text-muted-foreground">Your share</Text>
              <TextInput
                value={pct}
                onChangeText={setPct}
                onEndEditing={() => {
                  const v = Math.max(0, Math.min(100, Number(pct) || 0));
                  void save({ ...choice, myPct: v });
                }}
                keyboardType="numeric"
                className="mx-2 px-2 py-1 rounded-md border text-sm text-foreground"
                style={{ borderColor: theme.alpha("foreground", 0.15), minWidth: 48, textAlign: "center" }}
                accessibilityLabel="Your share, percent"
              />
              <Text className="text-xs text-muted-foreground">%</Text>
            </View>
          )}
          <Text className="text-xs text-muted-foreground mt-2 leading-4">
            {choice.split === "payer_all"
              ? `${h.name} sees it; nobody owes anything for it.`
              : `Your share ${formatAmount(mine)} counts in your budget. ${who} owes you ${formatAmount(theirs)}, on both phones.`}
          </Text>
        </>
      )}
    </View>
  );
}
