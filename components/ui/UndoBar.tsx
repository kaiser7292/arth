import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/use-theme";
import { Text } from "./Text";

/**
 * A bar pinned to the bottom of the screen that offers to undo the last change. Unlike a toast it
 * doesn't time out: it stays until the user taps Undo or the cross. Big touch targets on purpose.
 */
export function UndoBar({ message, onUndo, onClose }: { message: string; onUndo: () => Promise<void> | void; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  return (
    <View
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: insets.bottom + 12,
        flexDirection: "row",
        alignItems: "center",
        borderRadius: 16,
        paddingLeft: 16,
        paddingVertical: 6,
        paddingRight: 6,
        backgroundColor: theme.foreground,
        elevation: 8,
        shadowColor: "#000",
        shadowOpacity: 0.2,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      }}
      accessibilityLiveRegion="polite"
    >
      <Ionicons name="checkmark-circle" size={20} color={theme.background} />
      <Text className="text-sm flex-1 ml-2.5 mr-2" style={{ color: theme.background }} numberOfLines={2}>
        {message}
      </Text>
      <Pressable
        onPress={async () => {
          if (busy) return;
          setBusy(true);
          try {
            await onUndo();
          } finally {
            setBusy(false);
          }
        }}
        style={{ minWidth: 76, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 }}
        accessibilityRole="button"
        accessibilityLabel="Undo"
      >
        {busy ? (
          <ActivityIndicator color={theme.background} />
        ) : (
          <Text className="text-sm font-bold" style={{ color: theme.primary }}>
            UNDO
          </Text>
        )}
      </Pressable>
      <Pressable
        onPress={onClose}
        style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" }}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <Ionicons name="close" size={22} color={theme.background} />
      </Pressable>
    </View>
  );
}
