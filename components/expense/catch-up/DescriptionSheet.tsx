import { useEffect, useState } from "react";
import { View } from "react-native";
import { Button, Input, Sheet, Text } from "@/components/ui";

/** Add or change a transaction's description without leaving Catch Up. */
export function DescriptionSheet({
  visible,
  initial,
  saving,
  onSave,
  onClose,
}: {
  visible: boolean;
  initial: string;
  saving: boolean;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);

  useEffect(() => {
    if (visible) setText(initial);
  }, [visible, initial]);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="px-5 pt-2 pb-6">
        <Text className="text-lg font-bold text-foreground mb-3">Description</Text>
        <Input
          value={text}
          onChangeText={setText}
          placeholder="e.g. Dinner with team, Mom's medicines"
          autoFocus
          maxLength={200}
          returnKeyType="done"
          onSubmitEditing={() => onSave(text)}
        />
        <View className="flex-row gap-3 mt-3">
          <View className="flex-1">
            <Button title="Cancel" variant="outline" onPress={onClose} />
          </View>
          <View className="flex-1">
            <Button title={saving ? "Saving…" : "Save"} onPress={() => onSave(text)} loading={saving} />
          </View>
        </View>
      </View>
    </Sheet>
  );
}
