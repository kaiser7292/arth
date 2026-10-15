import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from "react-native";
import { Button, ScreenContainer, Text } from "@/components/ui";
import { getMerchantPickRequest, setMerchantPickResult } from "@/components/expense/catch-up/merchant-pick";
import { useTheme } from "@/hooks/use-theme";

/** Type a merchant or pick one you've used before. Opened from the merchant chip on a Catch Up card. */
export default function CatchUpMerchantScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [request] = useState(getMerchantPickRequest);
  const [draft, setDraft] = useState(request?.value ?? "");

  const suggestions = useMemo(() => {
    const names = request?.merchantNames ?? [];
    const q = draft.trim().toLowerCase();
    const list = q ? names.filter((m) => m.toLowerCase().includes(q) && m.toLowerCase() !== q) : names;
    return list.slice(0, 50);
  }, [draft, request]);

  const save = (name: string) => {
    if (request) setMerchantPickResult(request.expenseId, name);
    router.back();
  };

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen options={{ title: request?.title ?? "Merchant" }} />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View
          className="flex-row items-center mx-4 mt-3 mb-2 rounded-lg border px-3 bg-card"
          style={{ borderColor: theme.primary, minHeight: 48 }}
        >
          <Ionicons name="storefront-outline" size={16} color={theme.mutedForeground} />
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Swiggy, rent, Mom"
            placeholderTextColor={theme.mutedForeground}
            autoFocus
            maxLength={100}
            returnKeyType="done"
            onSubmitEditing={() => save(draft)}
            className="flex-1 text-sm text-foreground py-2 ml-2"
            accessibilityLabel={request?.title ?? "Merchant"}
          />
          {draft.length > 0 && (
            <Pressable onPress={() => setDraft("")} hitSlop={8} accessibilityLabel="Clear">
              <Ionicons name="close-circle" size={16} color={theme.mutedForeground} />
            </Pressable>
          )}
        </View>
        {suggestions.length > 0 && (
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 pt-2 pb-1">
            {draft.trim() ? "Matches" : "Used before"}
          </Text>
        )}
        <FlatList
          data={suggestions}
          keyExtractor={(m) => m}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={15}
          className="flex-1"
          renderItem={({ item }) => (
            <Pressable
              onPress={() => save(item)}
              className="flex-row items-center px-4 py-3 border-b border-border"
              accessibilityRole="button"
            >
              <Ionicons name="time-outline" size={16} color={theme.mutedForeground} />
              <Text className="text-sm text-foreground ml-3 flex-1" numberOfLines={1}>{item}</Text>
            </Pressable>
          )}
        />
        <View className="px-4 pt-3 pb-4">
          <Button title="Save" onPress={() => save(draft)} />
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
