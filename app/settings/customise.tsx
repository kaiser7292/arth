import { Pressable, ScrollView, Switch, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useCustomisation } from "@/hooks/use-customisation";
import { useTheme } from "@/hooks/use-theme";
import { isBrokerHistoryOn, setBrokerHistoryOn } from "@/services/broker-history/enabled";
import { syncBrokerCaptureTask } from "@/services/broker-history/background";
import { syncBrokerReminders } from "@/services/broker-history/reminders";
import { getFlag } from "@/services/feature-flags";
import { FEATURES, INNER_TABS, TABS, isPartOn, setPartOn, type PartId } from "@/services/customise";
import {
  HOME_CARDS,
  getHomeCardOrder,
  isHomeCardSwitchedOn,
  moveHomeCard,
  owningPart,
  resetCustomisation,
  setHomeCardVisible,
  type HomeCardId,
} from "@/services/home-card-preferences";

/**
 * Settings → Customise Arth. Switch off what you don't use and it's gone from every screen: tabs,
 * cards, Settings rows and search. Off only hides; nothing is deleted.
 */
export default function CustomiseScreen() {
  useCustomisation();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const order = getHomeCardOrder();
  const trackColor = { false: colors.border, true: theme.primary };

  const partRow = (p: { id: PartId; label: string; description: string }, last: boolean) => (
    <View key={p.id} className={`flex-row items-center py-3 ${last ? "" : "border-b border-border"}`}>
      <View className="flex-1 mr-3">
        <Text className="text-sm font-semibold text-foreground">{p.label}</Text>
        <Text className="text-xs text-muted-foreground mt-0.5">{p.description}</Text>
      </View>
      <Switch
        value={isPartOn(p.id)}
        onValueChange={(v) => setPartOn(p.id, v)}
        trackColor={trackColor}
        thumbColor="#ffffff"
        accessibilityLabel={p.label}
      />
    </View>
  );

  const cardRow = (id: HomeCardId, position: number | null) => {
    const card = HOME_CARDS.find((c) => c.id === id);
    if (!card) return null;
    const owner = owningPart(id);
    const ownerOff = owner && !isPartOn(owner);
    const ownerLabel = owner ? ([...FEATURES, ...TABS].find((p) => p.id === owner)?.label ?? "") : "";
    return (
      <View key={id} className="flex-row items-center py-2.5 border-b border-border">
        {position !== null ? (
          <View className="mr-2.5 items-center">
            <Pressable
              onPress={() => moveHomeCard(id, -1)}
              disabled={position === 0}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Move ${card.label} up`}
            >
              <Ionicons name="chevron-up" size={18} color={position === 0 ? colors.border : theme.primary} />
            </Pressable>
            <Pressable
              onPress={() => moveHomeCard(id, 1)}
              disabled={position === order.length - 1}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Move ${card.label} down`}
            >
              <Ionicons name="chevron-down" size={18} color={position === order.length - 1 ? colors.border : theme.primary} />
            </Pressable>
          </View>
        ) : (
          <View style={{ width: 28 }} />
        )}
        <View className="flex-1 mr-3">
          <Text className="text-sm font-semibold text-foreground">{card.label}</Text>
          <Text className="text-xs text-muted-foreground mt-0.5">{ownerOff ? `Off with ${ownerLabel}` : card.description}</Text>
        </View>
        <Switch
          value={!ownerOff && isHomeCardSwitchedOn(id)}
          disabled={!!ownerOff}
          onValueChange={(v) => setHomeCardVisible(id, v)}
          trackColor={trackColor}
          thumbColor="#ffffff"
          accessibilityLabel={card.label}
        />
      </View>
    );
  };

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Text className="text-sm text-muted-foreground mb-3 px-1">
          Switch off what you don&apos;t use and it&apos;s gone from every screen and from search. Nothing is deleted: switch it back on and it&apos;s all there.
        </Text>

        <Card title="Features" className="mb-4">
          {FEATURES.map((f, i) => partRow(f, i === FEATURES.length - 1 && !getFlag("broker_history")))}
          {getFlag("broker_history") && (
            <View className="flex-row items-center py-3">
              <View className="flex-1 mr-3">
                <Text className="text-sm font-semibold text-foreground">Broker records</Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  {isPartOn("investments")
                    ? "Gains from broker reports and daily trade saves, in demat History and the Income Calculator. Off: just money in and out from detected transfers."
                    : "Off with Investments"}
                </Text>
              </View>
              <Switch
                value={isBrokerHistoryOn()}
                disabled={!isPartOn("investments")}
                onValueChange={(v) => {
                  setBrokerHistoryOn(v);
                  syncBrokerCaptureTask().catch(() => {});
                  syncBrokerReminders().catch(() => {});
                }}
                trackColor={trackColor}
                thumbColor="#ffffff"
                accessibilityLabel="Broker records"
              />
            </View>
          )}
        </Card>

        <Card title="Bottom tabs" className="mb-4">
          {TABS.map((t, i) => partRow(t, i === TABS.length - 1))}
          <Text className="text-xs text-muted-foreground mt-1">Home, Transactions and Settings always stay.</Text>
        </Card>

        <Card title="Tabs inside screens" className="mb-4">
          {INNER_TABS.map((t, i) => partRow(t, i === INNER_TABS.length - 1))}
        </Card>

        <Card title="Home cards" className="mb-4">
          <Text className="text-xs text-muted-foreground mb-1">Use the arrows to change their order on Home.</Text>
          {order.flatMap((id, i) => (id === "my_month" ? [cardRow(id, i), cardRow("total_spent", null)] : [cardRow(id, i)]))}
          {cardRow("min_balance_alert", null)}
          <Text className="text-xs text-muted-foreground mt-2">Low-balance alerts always sit at the top of Home.</Text>
        </Card>

        <Button title="Reset to defaults" variant="outline" onPress={resetCustomisation} />
      </ScrollView>
    </ScreenContainer>
  );
}
