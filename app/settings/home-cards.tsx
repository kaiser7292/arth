import { useState, useCallback } from "react";
import { View, Text, Pressable, ScrollView, Switch } from "react-native";
import { ScreenContainer, Card } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  HOME_CARDS,
  isHomeCardVisible,
  setHomeCardVisible,
  resetHomeCardPreferences,
} from "@/services/home-card-preferences";
import { Ionicons } from "@expo/vector-icons";

/**
 * Settings → Preferences → Home cards (v17.4.0).
 *
 * Toggle visibility of every Home screen card. Hidden cards don't render;
 * feature is always reachable via its deep-link or the related tab.
 */
export default function HomeCardsScreen() {
  const { colors, accent } = useColorScheme();
  const [tick, setTick] = useState(0);

  const handleToggle = useCallback((id: string, visible: boolean) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setHomeCardVisible(id as any, visible);
    setTick((t) => t + 1);
  }, []);

  const handleReset = useCallback(() => {
    resetHomeCardPreferences();
    setTick((t) => t + 1);
  }, []);

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Card className="mb-4">
          <Text className="text-sm text-muted-foreground">
            Toggle any card off to declutter Home. Hidden cards stay reachable
            through their related tab or deep-link. Defaults match the original
            Home layout.
          </Text>
        </Card>

        <Card title="Cards" className="mb-4">
          {HOME_CARDS.map((card, i) => {
            const visible = isHomeCardVisible(card.id);
            return (
              <View
                key={card.id + tick}
                className={`flex-row items-center py-3 ${
                  i < HOME_CARDS.length - 1
                    ? "border-b border-border"
                    : ""
                }`}
              >
                <View className="flex-1 mr-3">
                  <Text className="text-sm font-semibold text-foreground">
                    {card.label}
                  </Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">
                    {card.description}
                  </Text>
                </View>
                <Switch
                  value={visible}
                  onValueChange={(v) => handleToggle(card.id, v)}
                  trackColor={{ false: colors.border, true: accent[500] }}
                  thumbColor="#ffffff"
                />
              </View>
            );
          })}
        </Card>

        <Pressable
          onPress={handleReset}
          className="py-3 items-center rounded-xl"
          style={{
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          }}
          accessibilityRole="button"
          accessibilityLabel="Reset home card visibility to defaults"
        >
          <View className="flex-row items-center">
            <Ionicons name="refresh-outline" size={16} color={colors.textSecondary} />
            <Text
              className="text-sm font-semibold ml-2"
              style={{ color: colors.textSecondary }}
            >
              Reset to defaults
            </Text>
          </View>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}
