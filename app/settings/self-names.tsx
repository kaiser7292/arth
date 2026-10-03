import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { Button, Card, Input, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import {
  addSelfName,
  dismissSelfNameSuggestion,
  getSelfNameSuggestion,
  getSelfNames,
  removeSelfName,
} from "@/services/self-names";
import { recheckSelfTransfers } from "@/services/money-events";

/**
 * Settings → Your name in bank messages. Banks print the account holder's name on transfers
 * between their own accounts; listing it here lets Arth treat those as transfers.
 */
export default function SelfNamesScreen() {
  const theme = useTheme();
  const [names, setNames] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{ name: string; count: number } | null>(null);

  const load = useCallback(() => {
    setNames(getSelfNames());
    getSelfNameSuggestion(DEFAULT_USER_ID).then(setSuggestion).catch(() => setSuggestion(null));
  }, []);

  useFocusEffect(load);

  const add = () => {
    const name = draft.trim();
    if (name.replace(/[^A-Za-z]/g, "").length < 3) {
      setError("Enter the name as your bank writes it");
      return;
    }
    addSelfName(name);
    void recheckSelfTransfers(DEFAULT_USER_ID).catch(() => {});
    setDraft("");
    setError(null);
    load();
  };

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text className="text-sm text-muted-foreground mb-4">
          Banks print your name on transfers between your own accounts, like “Transferred to Mr. RAHULVERMA”. Add it
          here and Arth treats that money as moving between your accounts, not spending or income. Shortened spellings
          (“RAHUL VER”, “RAHULVERMA”) match too.
        </Text>

        {suggestion && (
          <Card className="mb-4">
            <Text className="text-sm text-foreground">
              <Text className="text-sm font-semibold text-foreground">{suggestion.name}</Text> appears in{" "}
              {suggestion.count} of your bank messages. Is this you?
            </Text>
            <View className="flex-row gap-3 mt-3">
              <View className="flex-1">
                <Button
                  title="No"
                  variant="outline"
                  onPress={() => {
                    dismissSelfNameSuggestion(suggestion.name);
                    load();
                  }}
                />
              </View>
              <View className="flex-1">
                <Button
                  title="Yes, that's me"
                  onPress={() => {
                    addSelfName(suggestion.name);
                    void recheckSelfTransfers(DEFAULT_USER_ID).catch(() => {});
                    load();
                  }}
                />
              </View>
            </View>
          </Card>
        )}

        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Your names</Text>
        <Card className="mb-4">
          {names.length === 0 ? (
            <Text className="text-sm text-muted-foreground">None yet.</Text>
          ) : (
            names.map((n, i) => (
              <View
                key={n}
                className={`flex-row items-center justify-between py-2.5 ${i > 0 ? "border-t border-border" : ""}`}
              >
                <Text className="text-base text-foreground flex-1" numberOfLines={1}>
                  {n}
                </Text>
                <Pressable
                  onPress={() => {
                    removeSelfName(n);
                    load();
                  }}
                  hitSlop={8}
                  accessibilityLabel={`Remove ${n}`}
                >
                  <Ionicons name="close-circle-outline" size={20} color={theme.mutedForeground} />
                </Pressable>
              </View>
            ))
          )}
        </Card>

        <Input
          label="Add a name"
          value={draft}
          onChangeText={(t) => {
            setDraft(t);
            if (error) setError(null);
          }}
          placeholder="RAHUL VERMA"
          autoCapitalize="characters"
          error={error ?? undefined}
          containerClassName="mb-3"
        />
        <Button title="Add name" variant="outline" onPress={add} />
        <Text className="text-xs text-faint-foreground mt-3">
          Add a family member’s name too if you treat their account as your own money.
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}
