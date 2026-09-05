import { useState, useCallback } from "react";

import { View, FlatList, Pressable } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Ionicons } from "@expo/vector-icons";
import { FAB, ScreenContainer, Text } from "@/components/ui";
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



export default function PaymentModesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const alert = useAlert();
  const { colors } = useColorScheme();
  const [modes, setModes] = useState<PaymentMode[]>([]);

  const loadModes = useCallback(async () => {
    try {
      const data = await getAllPaymentModes(DEFAULT_USER_ID);
      setModes(data);
    } catch {
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
          "Cannot Delete",
          `"${pm.name}" has ${count} expense${count > 1 ? "s" : ""} linked to it. Remove or reassign them first.`,
        );
        return;
      }
      alert("Delete Payment Mode", `Permanently delete "${pm.name}"? This cannot be undone.`, [
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

  const renderItem = ({ item }: { item: PaymentMode }) => (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/settings/payment-mode-edit",
          params: { id: item.id },
        })
      }
      className={`flex-row items-center px-4 py-3 border-b border-border ${
        item.is_active === 0 ? "opacity-40" : ""
      }`}
    >
      <View className="w-10 h-10 rounded-full bg-card items-center justify-center mr-3">
        <Ionicons
          name={TYPE_ICONS[item.type as PaymentModeType]}
          size={20}
          color={colors.blue}
        />
      </View>
      <View className="flex-1">
        <Text className="text-base font-medium text-foreground">
          {item.name}
        </Text>
        <View className="flex-row items-center">
          <Text className="text-xs text-muted-foreground">
            {PAYMENT_MODE_TYPE_LABELS[item.type as PaymentModeType]}
          </Text>
          {item.is_active === 0 && (
            <Text className="text-xs text-danger ml-2">Inactive</Text>
          )}
        </View>
      </View>

      {/* Active/Inactive toggle */}
      <Pressable onPress={() => handleToggleActive(item)} className="p-2">
        <Ionicons
          name={item.is_active === 1 ? "eye-outline" : "eye-off-outline"}
          size={18}
          color={item.is_active === 1 ? colors.blue : theme.faintForeground}
        />
      </Pressable>

      {/* Delete button */}
      <Pressable onPress={() => handleDelete(item)} className="p-2">
        <Ionicons name="trash-outline" size={18} color={theme.danger} />
      </Pressable>
    </Pressable>
  );

  return (
    <ScreenContainer padTop={false}>
      <FlatList
        data={modes}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 80 }}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center py-20">
            <Text className="text-muted-foreground">
              No payment modes yet. Tap + to add one.
            </Text>
          </View>
        }
      />
      <FAB icon="add" onPress={() => router.push("/settings/payment-mode-edit")} />
    </ScreenContainer>
  );
}
