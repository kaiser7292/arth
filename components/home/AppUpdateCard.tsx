import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { Button, Card, Text, useToast } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { checkForUpdate, dismissUpdate, installUpdate, type AvailableUpdate } from "@/services/app-update";

/**
 * "Arth 4.28.2 is available": from the Play Store for a Play install, from GitHub for an APK
 * (services/app-update.ts). Checked once when Home opens; dismissing hides it until a later version.
 */
export function AppUpdateCard() {
  const theme = useTheme();
  const toast = useToast();
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);

  useEffect(() => {
    let alive = true;
    // After Home has drawn: the check waits on the network or the Play Store.
    const t = setTimeout(() => {
      void checkForUpdate().then((u) => alive && setUpdate(u));
    }, 3000);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);

  if (!update) return null;

  return (
    <Card className="mx-4 mt-3">
      <View className="flex-row items-start">
        <Ionicons name="arrow-up-circle-outline" size={22} color={theme.primary} />
        <View className="flex-1 ml-2.5">
          <Text className="text-sm font-semibold text-foreground">Arth {update.version} is available</Text>
          <Text className="text-xs text-muted-foreground mt-1 leading-4">
            {update.source === "play"
              ? "The Play Store downloads it and restarts Arth. Your data stays."
              : "Download the new APK and install it over this one. Your data stays."}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            dismissUpdate(update.version);
            setUpdate(null);
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Not now"
        >
          <Ionicons name="close" size={18} color={theme.mutedForeground} />
        </Pressable>
      </View>
      <Button
        title={update.source === "play" ? "Update" : "Download"}
        className="mt-3"
        onPress={async () => {
          if (!(await installUpdate(update).catch(() => false))) {
            toast("Couldn't open the update. Try again later.", { tone: "danger" });
            setUpdate(null);
          }
        }}
      />
    </Card>
  );
}
