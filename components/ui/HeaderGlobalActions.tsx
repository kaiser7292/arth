import { useCallback, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { isAmountsHidden, toggleAmountsHidden } from "@/services/privacy-mode";

/**
 * Search and Hide amounts, on the right of every inner screen's header, the same two Home has.
 * Mic and Scan stay on Home and inside Search ("Search or do something"), so titles keep their room.
 * `leading` puts a screen's own buttons before them (the yearly plan's Year over year).
 */
export function HeaderGlobalActions({ color, leading }: { color?: string; leading?: ReactNode } = {}) {
  const router = useRouter();
  const { colors } = useColorScheme();
  const tint = color ?? colors.tint;
  const [hidden, setHidden] = useState(isAmountsHidden());

  // Another screen (or Home) may have flipped it since this header drew.
  useFocusEffect(useCallback(() => setHidden(isAmountsHidden()), []));

  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginRight: 4, gap: 6 }}>
      {leading}
      <Pressable
        onPress={() => router.push("/search")}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Search or do something"
        style={{ padding: 4 }}
      >
        <Ionicons name="search-outline" size={20} color={tint} />
      </Pressable>
      <Pressable
        onPress={() => setHidden(toggleAmountsHidden())}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={hidden ? "Show amounts" : "Hide amounts"}
        style={{ padding: 4 }}
      >
        <Ionicons name={hidden ? "eye-off-outline" : "eye-outline"} size={20} color={tint} />
      </Pressable>
    </View>
  );
}
