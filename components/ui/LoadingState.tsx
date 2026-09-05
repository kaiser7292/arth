import { View } from "react-native";
import type { Ionicons } from "@expo/vector-icons";
import { Text } from "./Text";
import { SkeletonList } from "./Skeleton";

interface LoadingStateProps {
  message?: string;
  /** Accepted for source compatibility with the previous icon-based version; no longer rendered. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Number of placeholder rows. Tune to roughly match what the screen is about to show. */
  rows?: number;
}

/**
 * The app's loading state.
 *
 * Rewritten to show a skeleton of the content rather than a pulsing icon in the middle of an empty
 * screen. A centred icon says only "wait", and because it sits nowhere near where the content will
 * land, the screen jumps when data arrives. Rows shaped like the eventual list say what is coming
 * and hold its place.
 *
 * Changed here rather than at the 31 call sites, so every screen using it improves without being
 * edited - and the `icon` prop is still accepted so none of them break.
 *
 * The message is kept but demoted: it is context, not the main event, and several screens pass a
 * useful one ("Crunching your numbers", "Building the schedule").
 */
export function LoadingState({ message, rows = 6 }: LoadingStateProps) {
  return (
    <View className="flex-1 pt-2" accessibilityLabel={message ?? "Loading"}>
      <SkeletonList rows={rows} />
      {message ? (
        <Text className="text-meta text-faint-foreground text-center mt-2">{message}</Text>
      ) : null}
    </View>
  );
}
