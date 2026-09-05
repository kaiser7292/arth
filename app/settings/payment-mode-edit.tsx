import { useState, useEffect, useRef } from "react";
import { View, ScrollView, Pressable, Keyboard } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Button, Input, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import { formatError } from "@/utils/error-message";
import { logger } from "@/utils/logger";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getPaymentModeById,
  createPaymentMode,
  updatePaymentMode,
  PAYMENT_MODE_TYPE_LABELS,
} from "@/services/payment-mode";
import type { PaymentModeType } from "@/services/payment-mode";

const TYPE_OPTIONS: PaymentModeType[] = [
  "credit_card",
  "debit_card",
  "upi",
  "cash",
  "wallet",
  "bank_transfer",
];

export default function PaymentModeEditScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { accent, colorScheme } = useColorScheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEditing = !!id;
  const scrollRef = useRef<ScrollView>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState<PaymentModeType>("upi");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (id) {
      getPaymentModeById(id).then((pm) => {
        if (pm) {
          setName(pm.name);
          setType(pm.type);
        }
      });
    }
  }, [id]);

  const handleSave = async () => {
    if (!name.trim()) {
      alert("Error", "Name is required.");
      return;
    }

    setLoading(true);
    try {
      if (isEditing && id) {
        await updatePaymentMode(id, { name: name.trim(), type });
      } else {
        await createPaymentMode({
          user_id: DEFAULT_USER_ID,
          name: name.trim(),
          type,
        });
      }
      router.back();
    } catch (e) {
      logger.error("Save payment mode failed:", e);
      alert("Error", formatError("Save payment mode", e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer padTop={false} keyboardAware>
      <ScrollView ref={scrollRef} className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View className="px-4 py-4">
          <Input
            label="Payment Mode Name"
            value={name}
            onChangeText={setName}
            placeholder="e.g., HDFC CC, GPay"
            maxLength={50}
            containerClassName="mb-6"
          />

          <Text className="text-sm font-medium text-muted-foreground mb-2">
            Type
          </Text>
          <View className="flex-row flex-wrap mb-8">
            {TYPE_OPTIONS.map((t) => (
              <Pressable
                key={t}
                onPress={() => setType(t)}
                className={`px-4 py-3 rounded-lg mr-2 mb-2 border ${
                  type === t
                    ? ""
                    : "bg-card border-transparent"
                }`}
                style={type === t ? {
                  backgroundColor: ac(accent, colorScheme, 100, 700),
                  borderColor: ac(accent, colorScheme, 600, 300),
                } : undefined}
              >
                <Text
                  className={`text-sm ${
                    type === t
                      ? "font-medium"
                      : "text-muted-foreground"
                  }`}
                  style={type === t ? { color: ac(accent, colorScheme, 500, 200) } : undefined}
                >
                  {PAYMENT_MODE_TYPE_LABELS[t]}
                </Text>
              </Pressable>
            ))}
          </View>

          <Button
            title={isEditing ? "Update Payment Mode" : "Add Payment Mode"}
            onPress={handleSave}
            loading={loading}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
