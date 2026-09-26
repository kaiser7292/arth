import { Ionicons } from "@expo/vector-icons";
import { Linking, Pressable, View } from "react-native";
import { Card, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { BROKER_TERMS, type BrokerId } from "@/services/broker-terms";

interface BrokerTermsCardProps {
  broker: BrokerId;
  agreed: boolean;
  onAgreedChange: (agreed: boolean) => void;
}

/**
 * "You're connecting with your own API key" — shown above Connect on every
 * broker credentials screen. The parent keeps Connect disabled until `agreed`.
 */
export function BrokerTermsCard({ broker, agreed, onAgreedChange }: BrokerTermsCardProps) {
  const theme = useTheme();
  const t = BROKER_TERMS[broker];

  return (
    <Card className="mb-3">
      <View className="flex-row items-center mb-2">
        <Ionicons name="key-outline" size={16} color={theme.primary} />
        <Text className="text-sm font-semibold text-foreground ml-1.5">
          You're connecting with your own API key
        </Text>
      </View>
      <Text className="text-xs text-muted-foreground leading-5 mb-2">
        These credentials belong to your {t.name} account, and your use of them is governed by {t.name}'s
        terms. Arth is not affiliated with or endorsed by {t.name}.
      </Text>
      <Text className="text-xs text-muted-foreground leading-5 mb-2">
        <Text className="text-xs font-semibold text-foreground">What Arth does: </Text>
        reads your holdings and balances. It never places orders or moves money.
      </Text>
      <Text className="text-xs text-muted-foreground leading-5 mb-2">
        <Text className="text-xs font-semibold text-foreground">Where your credentials go: </Text>
        {t.credentialsNote}
      </Text>
      <Text className="text-xs text-muted-foreground leading-5 mb-3">
        <Text className="text-xs font-semibold text-foreground">To revoke: </Text>
        tap Remove here, and delete or regenerate the key in the {t.consoleLabel}.
      </Text>

      {t.warning ? (
        <View className="flex-row items-start rounded-lg p-2.5 mb-3" style={{ backgroundColor: theme.alpha("warning", 0.12) }}>
          <Ionicons name="warning-outline" size={14} color={theme.warning} style={{ marginTop: 2, marginRight: 6 }} />
          <Text className="flex-1 text-xs leading-5" style={{ color: theme.warning }}>
            {t.warning}
          </Text>
        </View>
      ) : null}

      <View className="flex-row flex-wrap mb-3" style={{ columnGap: 16, rowGap: 6 }}>
        {t.links.map((l) => (
          <Pressable
            key={l.url}
            onPress={() => Linking.openURL(l.url).catch(() => {})}
            accessibilityRole="link"
            hitSlop={6}
            className="flex-row items-center"
          >
            <Ionicons name="open-outline" size={12} color={theme.primary} />
            <Text className="text-xs font-semibold ml-1" style={{ color: theme.primary }}>
              {l.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={() => onAgreedChange(!agreed)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agreed }}
        className="flex-row items-start pt-3 border-t border-border"
      >
        <Ionicons
          name={agreed ? "checkbox" : "square-outline"}
          size={20}
          color={agreed ? theme.primary : theme.mutedForeground}
          style={{ marginRight: 8 }}
        />
        <Text className="flex-1 text-xs text-foreground leading-5">
          I'm using my own API credentials and agree to follow {t.name}'s terms.
        </Text>
      </Pressable>
    </Card>
  );
}
