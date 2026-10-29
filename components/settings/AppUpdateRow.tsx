import { useState } from "react";
import { Platform, Pressable, Switch, View } from "react-native";

import { Text, useToast } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { checkForUpdate, installUpdate, isUpdateCheckEnabled, setUpdateCheckEnabled, updateSource } from "@/services/app-update";

/** Settings → About: whether Home says when a newer Arth is out, and a Check now. Android only. */
export function AppUpdateRow() {
  const theme = useTheme();
  const toast = useToast();
  const [on, setOn] = useState(isUpdateCheckEnabled);
  const [checking, setChecking] = useState(false);

  if (Platform.OS !== "android") return null;
  const fromPlay = updateSource() === "play";

  return (
    <View className="py-2 border-b border-border">
      <View className="flex-row items-center">
        <View className="flex-1 mr-3">
          <Text className="text-sm text-foreground">Tell me about new versions</Text>
          <Text className="text-xs text-muted-foreground mt-0.5 leading-4">
            {fromPlay
              ? "Asks the Play Store, which Arth was installed from."
              : "Checks Arth's releases on GitHub once a day. Nothing about you is sent."}
          </Text>
        </View>
        <Switch
          value={on}
          onValueChange={(v) => {
            setUpdateCheckEnabled(v);
            setOn(v);
          }}
          accessibilityLabel="Tell me about new versions"
        />
      </View>
      {on && (
        <Pressable
          disabled={checking}
          onPress={async () => {
            setChecking(true);
            try {
              const u = await checkForUpdate({ force: true });
              if (!u) toast("You have the latest version");
              else if (!(await installUpdate(u).catch(() => false))) toast(`Arth ${u.version} is out, but the update couldn't open`, { tone: "danger" });
            } finally {
              setChecking(false);
            }
          }}
          hitSlop={8}
          className="self-start mt-1"
          accessibilityRole="button"
        >
          <Text className="text-xs font-semibold" style={{ color: theme.primary }}>{checking ? "Checking…" : "Check now"}</Text>
        </Pressable>
      )}
    </View>
  );
}
