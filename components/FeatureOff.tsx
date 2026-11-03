import { View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, ScreenContainer, Text } from "@/components/ui";
import { useCustomisation } from "@/hooks/use-customisation";
import { useTheme } from "@/hooks/use-theme";
import { FEATURES, isPartOn, setPartOn, type FeatureId } from "@/services/customise";

/** What a screen shows when a reminder or a link leads to something that's switched off. */
function FeatureOff({ feature }: { feature: FeatureId }) {
  const theme = useTheme();
  const router = useRouter();
  const label = FEATURES.find((f) => f.id === feature)?.label ?? "This";
  return (
    <ScreenContainer>
      <View className="flex-1 items-center justify-center px-8">
        <Ionicons name="eye-off-outline" size={36} color={theme.mutedForeground} />
        <Text className="text-lg font-bold text-foreground mt-3">{label} is off</Text>
        <Text className="text-sm text-muted-foreground text-center mt-1 mb-5">
          Everything in it is still here. Turn it on to see it again, or change this any time in Customise Arth.
        </Text>
        <Button title="Turn on" onPress={() => setPartOn(feature, true)} className="self-stretch mb-2" />
        <Button title="Go back" variant="outline" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} className="self-stretch" />
      </View>
    </ScreenContainer>
  );
}

/** For a feature's layout: the screens when it's on, the page above when it's off. */
export function FeatureGate({ feature, children }: { feature: FeatureId; children: React.ReactNode }) {
  useCustomisation();
  return isPartOn(feature) ? <>{children}</> : <FeatureOff feature={feature} />;
}
