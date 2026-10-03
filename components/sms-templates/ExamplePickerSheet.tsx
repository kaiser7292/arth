import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { Button, Input, Sheet, Text } from "@/components/ui";

interface ExamplePickerSheetProps {
  visible: boolean;
  /** Unread messages from the same sender, newest first. */
  candidates: { id: string; body: string }[];
  onPick: (body: string) => void;
  onClose: () => void;
}

/** "Add another example": pick one of the sender's other unread messages, or paste one. */
export function ExamplePickerSheet({ visible, candidates, onPick, onClose }: ExamplePickerSheetProps) {
  const [pasted, setPasted] = useState("");
  useEffect(() => {
    if (visible) setPasted("");
  }, [visible]);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="px-4 pb-6">
        <Text className="text-lg font-semibold text-foreground mb-1">Add another example</Text>
        <Text className="text-sm text-muted-foreground mb-3">
          A second message of the same kind. Arth keeps the words both share and lets the rest change.
        </Text>
        {candidates.length > 0 && (
          <ScrollView style={{ maxHeight: 280 }}>
            {candidates.map((c) => (
              <Pressable key={c.id} onPress={() => onPick(c.body)} className="py-2.5 border-b border-border">
                <Text className="text-sm text-foreground" numberOfLines={3}>
                  {c.body}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
        <Input
          label={candidates.length > 0 ? "Or paste one" : "Paste a message"}
          value={pasted}
          onChangeText={setPasted}
          multiline
          containerClassName="mt-3"
        />
        <View className="mt-2">
          <Button
            title="Use this message"
            variant="outline"
            onPress={() => pasted.trim().length >= 10 && onPick(pasted.trim())}
            disabled={pasted.trim().length < 10}
          />
        </View>
      </View>
    </Sheet>
  );
}
