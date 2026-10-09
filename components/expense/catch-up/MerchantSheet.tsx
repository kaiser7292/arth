import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import { Button, Sheet, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

interface MerchantSheetProps {
  visible: boolean;
  /** "Paid to" for spending, "Received from" for credits. */
  title: string;
  value: string | null;
  /** Past merchants, for suggestions. */
  merchantNames: string[];
  onSave: (name: string) => void;
  onClose: () => void;
}

/** Type a merchant or pick one you've used before. Catch Up's merchant chip. */
export function MerchantSheet({ visible, title, value, merchantNames, onSave, onClose }: MerchantSheetProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    if (visible) setDraft(value ?? "");
  }, [visible, value]);

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    const list = q ? merchantNames.filter((m) => m.toLowerCase().includes(q) && m.toLowerCase() !== q) : merchantNames;
    return list.slice(0, 30);
  }, [draft, merchantNames]);

  return (
    <Sheet visible={visible} onClose={onClose} maxHeightPct={80}>
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 pb-2">{title}</Text>
      <View className="flex-row items-center mx-4 mb-2 rounded-lg border px-3" style={{ borderColor: theme.primary, minHeight: 44 }}>
        <Ionicons name="storefront-outline" size={16} color={theme.mutedForeground} />
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Swiggy, rent, Mom"
          placeholderTextColor={theme.mutedForeground}
          autoFocus
          maxLength={100}
          returnKeyType="done"
          onSubmitEditing={() => onSave(draft)}
          className="flex-1 text-sm text-foreground py-2 ml-2"
          accessibilityLabel={title}
        />
        {draft.length > 0 && (
          <Pressable onPress={() => setDraft("")} hitSlop={8} accessibilityLabel="Clear">
            <Ionicons name="close-circle" size={16} color={theme.mutedForeground} />
          </Pressable>
        )}
      </View>
      <FlatList
        data={suggestions}
        keyExtractor={(m) => m}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        style={{ flexGrow: 0 }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onSave(item)}
            className="flex-row items-center px-4 py-3 border-b border-border"
            accessibilityRole="button"
          >
            <Ionicons name="time-outline" size={16} color={theme.mutedForeground} />
            <Text className="text-sm text-foreground ml-3 flex-1" numberOfLines={1}>{item}</Text>
          </Pressable>
        )}
      />
      <View className="px-4 pt-3">
        <Button title="Save" onPress={() => onSave(draft)} />
      </View>
    </Sheet>
  );
}
