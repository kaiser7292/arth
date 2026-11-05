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
  getHomeCardBlocks,
  getHomeCardOrder,
  isHomeCardSwitchedOn,
  moveHomeCard,
  moveHomeBlock,
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
  const blocks = getHomeCardBlocks(order);
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

  const arrows = (label: string, first: boolean, last: boolean, move: (by: -1 | 1) => void) => (
    <View className="mr-2.5 items-center">
      <Pressable onPress={() => move(-1)} disabled={first} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Move ${label} up`}>
        <Ionicons name="chevron-up" size={18} color={first ? colors.border : theme.primary} />
      </Pressable>
      <Pressable onPress={() => move(1)} disabled={last} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Move ${label} down`}>
        <Ionicons name="chevron-down" size={18} color={last ? colors.border : theme.primary} />
      </Pressable>
    </View>
  );

  const cardRow = (id: HomeCardId, place: { first: boolean; last: boolean } | null) => {
    const card = HOME_CARDS.find((c) => c.id === id);
    if (!card) return null;
    const owner = owningPart(id);
    const ownerOff = owner && !isPartOn(owner);
    const ownerLabel = owner ? ([...FEATURES, ...TABS].find((p) => p.id === owner)?.label ?? "") : "";
    return (
      <View key={id} className="flex-row items-center py-2.5 border-b border-border">
        {place ? (
          arrows(card.label, place.first, place.last, (by) => moveHomeCard(id, by))
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
                <Text className="text-sm font-semibold text-foreground">Broker historic records</Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  {isPartOn("investments")
                    ? "Upload past broker reports, and see gains in demat History and the Income Calculator, with reminders to save trades. What Arth saved and detected stays: a report overwrites it only for its period. Off: just money in and out from detected transfers."
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
                accessibilityLabel="Broker historic records"
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
          <Text className="text-xs text-muted-foreground mb-1">
            The arrows beside a title move those cards together. The arrows beside a card move just that card, anywhere you like. A card moved out of its group brings its title along.
          </Text>
          {blocks.map((b, bi) => (
            <View key={b.cards[0]}>
              <View className="flex-row items-center pt-3 pb-2 border-b border-border">
                {arrows(b.title, bi === 0, bi === blocks.length - 1, (by) => moveHomeBlock(b.cards[0], by))}
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex-1">{b.title}</Text>
              </View>
              {b.cards.flatMap((id) => {
                const at = order.indexOf(id);
                const row = cardRow(id, { first: at === 0, last: at === order.length - 1 });
                return id === "my_month" ? [row, cardRow("total_spent", null)] : [row];
              })}
            </View>
          ))}
          <View className="pt-1">{cardRow("min_balance_alert", null)}</View>
          <Text className="text-xs text-muted-foreground mt-2">
            Low-balance alerts always sit at the top of Home. "This Month" only shows as a title when those cards aren't first.
          </Text>
        </Card>

        <Button title="Reset to defaults" variant="outline" onPress={resetCustomisation} />
      </ScrollView>
    </ScreenContainer>
  );
}
