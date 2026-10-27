import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { ClipboardPasteButton } from "expo-clipboard";
import { Button, ScreenContainer, Text, useToast } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { addMessageText } from "@/services/message-inbox";
import { formatError } from "@/utils/error-message";

/**
 * Paste a bank message (copied in Messages) and see what Arth reads from it on "Just arrived".
 *
 * Uses iOS's own Paste button where there is one (iOS 16+): tapping it is the permission, so there's
 * no "Allow Paste?" prompt every time. Elsewhere an ordinary button reads the clipboard.
 */
export default function PasteMessageScreen() {
  const router = useRouter();
  const theme = useTheme();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const read = async (text: string | undefined | null) => {
    if (!text?.trim()) {
      toast("Copy a bank message first: press and hold it in Messages, then Copy");
      return;
    }
    setBusy(true);
    try {
      await addMessageText(text);
      router.replace("/expense/just-arrived");
    } catch (e) {
      toast(formatError("Read message", e), { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenContainer padTop={false}>
      <View className="flex-1 px-6 pt-10 items-center">
        <View className="w-14 h-14 rounded-full items-center justify-center" style={{ backgroundColor: theme.alpha("primary", 0.12) }}>
          <Ionicons name="clipboard-outline" size={26} color={theme.primary} />
        </View>
        <Text className="text-xl font-bold text-foreground mt-4 text-center">Paste a bank message</Text>
        <Text className="text-sm text-muted-foreground mt-2 text-center leading-5">
          In Messages, press and hold your bank&apos;s message and tap Copy. Then paste it here: Arth reads it on this phone and
          shows you what it found before anything is saved.
        </Text>
        <View className="mt-8 items-center" style={{ opacity: busy ? 0.5 : 1 }} pointerEvents={busy ? "none" : "auto"}>
          {Clipboard.isPasteButtonAvailable ? (
            <ClipboardPasteButton
              onPress={(data) => void read(data.type === "text" ? data.text : null)}
              acceptedContentTypes={["plain-text"]}
              displayMode="iconAndLabel"
              cornerStyle="capsule"
              backgroundColor={theme.primary}
              foregroundColor={theme.primaryForeground}
              style={{ width: 160, height: 48 }}
            />
          ) : (
            <Button title="Paste message" onPress={async () => void read(await Clipboard.getStringAsync())} loading={busy} />
          )}
        </View>
      </View>
    </ScreenContainer>
  );
}
