import "../global.css";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Slot } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

/**
 * Root layout for the preview harness ONLY.
 *
 * Deliberately empty of everything app/_layout.tsx does - no database, no MMKV, no SMS scan, no
 * notification channels, no background tasks. That is the whole point: those are the reason the
 * real app cannot render anywhere except an Android device, and rendering the design system is
 * the thing that needs to be cheap.
 */
export default function PreviewLayout() {
  /**
   * Load the SAME Inter the app bundles.
   *
   * app.json registers Inter through the expo-font plugin for ANDROID ONLY, so the harness was
   * rendering in whatever sans-serif the browser defaults to. That font is narrower than Inter,
   * which made every width measurement optimistic - columns that fit here wrapped on the
   * device, and I sized the Compare table against them twice.
   *
   * The family name has to be "Inter" because that is what tailwind.config maps font-sans to.
   */
  const [loaded, error] = useFonts({
    Inter: Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Hold the first paint until Inter is in, so nothing is ever measured against a fallback.
  // On failure, render anyway rather than showing a blank page forever - but say so loudly,
  // because a harness that silently uses the wrong font is worse than no harness. Getting
  // this wrong is what made me size the Compare columns against a narrower font twice.
  if (!loaded && !error) return null;
  if (error) {
    console.warn(
      "[preview] Inter failed to load - widths below are NOT what the device renders:",
      error,
    );
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Slot />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
