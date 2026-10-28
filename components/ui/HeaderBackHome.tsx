import { Pressable, View } from "react-native";
import { useRouter, useNavigation } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useColorScheme } from "@/hooks/use-color-scheme";

/**
 * Drop-in headerLeft replacement for every sub-stack layout.
 * Renders the standard back chevron followed by a home icon.
 * Tapping back does router.back(); tapping home jumps to the Home tab root.
 */
export function HeaderBackHome() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useColorScheme();
  // Always a way back. Whether there's a screen behind can't be trusted at the moment the header
  // draws: the first screen of a section opened from elsewhere (Home → Hisaab, Together → ledger)
  // reported nothing behind it, and iPhone has no hardware back. With nothing to go back to, back
  // goes Home.
  const goBack = () => {
    if (navigation.canGoBack() || router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };

  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginLeft: 4, gap: 4 }}>
      <Pressable onPress={goBack} hitSlop={8} accessibilityLabel="Go back" style={{ padding: 4 }}>
        <Ionicons name="chevron-back" size={24} color={colors.tint} />
      </Pressable>
      <Pressable
        onPress={() => router.replace("/(tabs)")}
        hitSlop={8}
        accessibilityLabel="Go to Home"
        style={{ padding: 4 }}
      >
        <Ionicons name="home-outline" size={20} color={colors.tint} />
      </Pressable>
    </View>
  );
}
