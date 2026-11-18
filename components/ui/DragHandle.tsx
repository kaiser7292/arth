import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useMemo, useRef } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useTheme } from "@/hooks/use-theme";

/**
 * ⋮⋮ on a row you can reorder (board "Customise": "Drag to order"). Put a thumb on it and slide:
 * every row's height of travel moves the row one place, live, with a light tick. Screen readers
 * get the same as swipe up / down actions.
 *
 * `step` is roughly one row's height; `onMove(-1 | 1)` does the actual move.
 */
export function DragHandle({
  label,
  first,
  last,
  onMove,
  step = 56,
}: {
  label: string;
  first: boolean;
  last: boolean;
  onMove: (by: -1 | 1) => void;
  step?: number;
}) {
  const theme = useTheme();
  // The latest props, for the gesture callbacks (they're made once).
  const live = useRef({ first, last, onMove, step });
  live.current = { first, last, onMove, step };
  const used = useRef(0);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(4)
        .onStart(() => {
          used.current = 0;
        })
        .onUpdate((e) => {
          const { first: atTop, last: atBottom, onMove: move, step: h } = live.current;
          const d = e.translationY - used.current;
          if (d > h * 0.6 && !atBottom) {
            used.current += h;
            move(1);
            Haptics.selectionAsync().catch(() => {});
          } else if (d < -h * 0.6 && !atTop) {
            used.current -= h;
            move(-1);
            Haptics.selectionAsync().catch(() => {});
          }
        }),
    [],
  );

  return (
    <GestureDetector gesture={pan}>
      <View
        className="items-center justify-center mr-2"
        style={{ width: 32, height: 40 }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`Move ${label}`}
        accessibilityHint="Drag up or down to change the order"
        accessibilityActions={[
          { name: "increment", label: "Move down" },
          { name: "decrement", label: "Move up" },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === "increment" && !last) onMove(1);
          if (e.nativeEvent.actionName === "decrement" && !first) onMove(-1);
        }}
      >
        <Ionicons name="reorder-three" size={22} color={theme.mutedForeground} />
      </View>
    </GestureDetector>
  );
}
