import { useState, useCallback } from "react";

import { View, ScrollView, Pressable, Switch } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import Ionicons from "@expo/vector-icons/Ionicons";
import { EmptyState, FAB, ScreenContainer, Text } from "@/components/ui";
import { tint } from "@/constants/brand";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getAllPaymentModes,
  updatePaymentMode,
  getPaymentModeExpenseCount,
  hardDeletePaymentMode,
  PAYMENT_MODE_TYPE_LABELS,
} from "@/services/payment-mode";
import type { PaymentMode, PaymentModeType } from "@/services/payment-mode";
import { TYPE_ICONS } from "@/constants/icons";
import { getErrorMessage } from "@/utils/error-message";
import { useTheme } from "@/hooks/use-theme";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";



export default function PaymentModesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const alert = useAlert();
  const { colors } = useColorScheme();
  const [modes, setModes] = useState<PaymentMode[]>([]);

  const [loadFailed, setLoadFailed] = useState(false);
  const loadModes = useCallback(async () => {
    try {
      const data = await getAllPaymentModes(DEFAULT_USER_ID);
      setModes(data);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      // Database not initialized
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadModes();
    }, [loadModes]),
  );

  const handleToggleActive = useCallback(
    async (pm: PaymentMode) => {
      try {
        const newActive = pm.is_active === 1 ? 0 : 1;
        await updatePaymentMode(pm.id, { is_active: newActive });
        loadModes();
      } catch (e) {
        alert("Couldn't update", getErrorMessage(e, "Failed to update payment mode."));
      }
    },
    [loadModes],
  );

  const handleDelete = useCallback(
    async (pm: PaymentMode) => {
      const count = await getPaymentModeExpenseCount(pm.id);
      if (count > 0) {
        alert(
          "Cannot delete",
          `"${pm.name}" has ${count} expense${count > 1 ? "s" : ""} linked to it. Remove or reassign them first.`,
        );
        return;
      }
      alert("Delete payment mode", `Permanently delete "${pm.name}"? This cannot be undone.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await hardDeletePaymentMode(pm.id);
              loadModes();
            } catch (e) {
              alert("Couldn't delete", getErrorMessage(e, "Failed to delete payment mode."));
            }
          },
        },
      ]);
    },
    [loadModes],
  );

  // One colour per kind of payment (board "Payment modes"): UPI blue, cards amber, cash green,
  // bank teal, wallets purple.
  const typeColor = (t: string) =>
    t === "upi"
      ? theme.data.series[3]
      : t === "credit_card" || t === "debit_card"
        ? theme.data.series[1]
        : t === "cash"
          ? theme.data.series[5]
          : t === "wallet"
            ? theme.data.series[2]
            : theme.data.series[0];

  const renderItem = (item: PaymentMode, index: number) => {
    const off = item.is_active === 0;
    const c = off ? theme.mutedForeground : typeColor(item.type);
    return (
      <View
        key={item.id}
        className={`flex-row items-center pl-3.5 pr-2 ${index > 0 ? "border-t border-border" : ""}`}
        style={{ minHeight: 60, gap: 12, opacity: off ? 0.7 : 1 }}
      >
        <View className="w-9 h-9 rounded-control items-center justify-center" style={{ backgroundColor: tint(c, 0.1) }}>
          <Ionicons name={TYPE_ICONS[item.type as PaymentModeType]} size={18} color={c} />
        </View>
        <Pressable
          onPress={() => router.push({ pathname: "/settings/payment-mode-edit", params: { id: item.id } })}
          className="flex-1 py-2"
          style={{ minWidth: 0 }}
          accessibilityRole="button"
          accessibilityLabel={`${item.name}, ${PAYMENT_MODE_TYPE_LABELS[item.type as PaymentModeType]}${off ? ", off" : ""}. Edit`}
        >
          <Text className="text-body font-semibold text-foreground" numberOfLines={1}>
            {item.name}
          </Text>
          <Text className="text-meta" style={{ color: off ? theme.danger : theme.mutedForeground }} numberOfLines={1}>
            {off ? "Inactive" : PAYMENT_MODE_TYPE_LABELS[item.type as PaymentModeType]}
          </Text>
        </Pressable>
        <Switch
          value={!off}
          onValueChange={() => handleToggleActive(item)}
          trackColor={{ false: theme.border, true: theme.primary }}
          thumbColor="#FFFFFF"
          accessibilityLabel={`${item.name} on`}
        />
        <Pressable onPress={() => handleDelete(item)} className="w-10 h-10 items-center justify-center" accessibilityRole="button" accessibilityLabel={`Delete ${item.name}`}>
          <Ionicons name="trash-outline" size={17} color={theme.mutedForeground} />
        </Pressable>
      </View>
    );
  };

  return (
    <ScreenContainer padTop={false}>
      {loadFailed && <LoadFailedBanner onRetry={loadModes} />}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 96, gap: 12 }} showsVerticalScrollIndicator={false}>
        <Text className="text-meta text-muted-foreground">Lets Arth tell UPI from card from cash. Tap one to rename it or change its type.</Text>
        {modes.length === 0 ? (
          <EmptyState icon="card-outline" title="No payment modes yet" subtitle="Payment modes let Arth tell UPI from card from cash. Tap + to add one." />
        ) : (
          <View className="rounded-card bg-card border border-border overflow-hidden">{modes.map(renderItem)}</View>
        )}
      </ScrollView>
      <FAB icon="add" label="Mode" onPress={() => router.push("/settings/payment-mode-edit")} />
    </ScreenContainer>
  );
}
