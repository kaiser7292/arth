import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Linking, Platform, Pressable, View } from "react-native";

import { ShortcutSetupSteps } from "@/components/sms/ShortcutSetupSteps";
import { Button, Card, Text } from "@/components/ui";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getMessageStats, waitingMessageCount } from "@/services/message-inbox";
import { settingsStorage } from "@/services/storage";

/** Registered in SETTINGS_REGISTRY (services/backup-settings.ts) as device-only. */
const DISMISSED_KEY = "iphone_messages_setup_card_dismissed";

/**
 * iPhone, until the first bank message arrives: iPhone gives apps no access to messages, so this
 * shows the Shortcuts setup (the same steps as Settings → Bank messages on iPhone) and a way to
 * paste a message meanwhile. Self-loading; hidden on Android, once a message came in, or dismissed.
 */
export function IphoneMessagesSetupCard() {
  const router = useRouter();
  const theme = useTheme();
  const [show, setShow] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useDataRefresh(
    useCallback(async () => {
      if (Platform.OS !== "ios" || settingsStorage.getBoolean(DISMISSED_KEY)) {
        setShow(false);
        return;
      }
      const waiting = await waitingMessageCount().catch(() => 0);
      setShow(getMessageStats().lastMessageAt == null && waiting === 0);
    }, []),
  );

  if (!show) return null;

  return (
    <Card className="mx-4 mt-3">
      <View className="flex-row items-start">
        <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.primary} />
        <View className="flex-1 ml-2.5">
          <Text className="text-sm font-semibold text-foreground">Get bank messages into Arth</Text>
          <Text className="text-xs text-muted-foreground mt-1 leading-4">
            iPhone doesn&apos;t let apps read messages. A two-minute automation in Shortcuts hands each bank message to
            Arth, which reads it on this phone.
          </Text>
        </View>
      </View>

      {expanded ? (
        <View className="mt-2">
          <ShortcutSetupSteps />
          <Button title="Open Shortcuts" onPress={() => void Linking.openURL("shortcuts://")} className="mt-2" />
        </View>
      ) : (
        <Button title="Show me how" onPress={() => setExpanded(true)} className="mt-3" />
      )}

      <View className="flex-row gap-3 mt-3">
        <View className="flex-1">
          <Button title="Paste a message" variant="outline" onPress={() => router.push("/expense/paste-message")} />
        </View>
        <View className="flex-1">
          <Button title="More" variant="outline" onPress={() => router.push("/settings/iphone-bank-messages")} />
        </View>
      </View>

      <Pressable
        onPress={() => {
          settingsStorage.set(DISMISSED_KEY, true);
          setShow(false);
        }}
        hitSlop={8}
        className="self-end mt-3"
        accessibilityRole="button"
      >
        <Text className="text-xs font-medium" style={{ color: theme.primary }}>Dismiss</Text>
      </Pressable>
    </Card>
  );
}
