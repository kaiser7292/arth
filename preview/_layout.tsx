import "../global.css";
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
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Slot />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
