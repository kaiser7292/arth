import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useMemo, useRef, useState } from "react";
import { PanResponder, View, type LayoutChangeEvent } from "react-native";
import { Text } from "./Text";
import { useTheme } from "@/hooks/use-theme";

export interface RailItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const SLOT = 30;

/**
 * A thumb rail for long grouped lists (owner, Nov 2026: "something on the right side which users
 * can use their thumb to quickly scroll or tap and drag through"). One icon per group down the
 * right edge; tap one to jump there, or put a thumb on the rail and slide: the list follows, a
 * bubble beside the thumb names the group, and a light tick marks each new group.
 *
 * The phone's version of a keyboard shortcut: gets you anywhere in the list in one gesture.
 */
export function FastScrollRail({ items, onSelect }: { items: RailItem[]; onSelect: (index: number) => void }) {
  const theme = useTheme();
  const [active, setActive] = useState<number | null>(null);
  const height = useRef(0);
  const last = useRef<number | null>(null);
  const latest = useRef({ items, onSelect });
  latest.current = { items, onSelect };

  const pick = (y: number) => {
    const { items: list, onSelect: select } = latest.current;
    if (list.length === 0 || height.current <= 0) return;
    const i = Math.max(0, Math.min(list.length - 1, Math.floor((y / height.current) * list.length)));
    if (i === last.current) return;
    last.current = i;
    setActive(i);
    select(i);
    Haptics.selectionAsync().catch(() => {});
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Hold on to the drag: a sideways wobble must not hand it to the Home pager.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          last.current = null;
          pick(e.nativeEvent.locationY);
        },
        onPanResponderMove: (e) => pick(e.nativeEvent.locationY),
        onPanResponderRelease: () => {
          last.current = null;
          setActive(null);
        },
        onPanResponderTerminate: () => {
          last.current = null;
          setActive(null);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (items.length < 2) return null;
  const current = active != null ? items[active] : null;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", right: 2, top: 0, bottom: 0, justifyContent: "center" }}
    >
      <View
        {...responder.panHandlers}
        onLayout={(e: LayoutChangeEvent) => {
          height.current = e.nativeEvent.layout.height;
        }}
        className="rounded-pill items-center"
        style={{
          paddingVertical: 6,
          width: 30,
          backgroundColor: active != null ? theme.alpha("primary", 0.12) : theme.alpha("foreground", 0.05),
        }}
        accessibilityRole="adjustable"
        accessibilityLabel="Jump to a group"
        accessibilityValue={{ text: current?.label ?? items[0].label }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => {
          const from = active ?? 0;
          const to = e.nativeEvent.actionName === "increment" ? Math.min(items.length - 1, from + 1) : Math.max(0, from - 1);
          setActive(to);
          onSelect(to);
        }}
      >
        {items.map((it, i) => (
          <View key={it.key} pointerEvents="none" style={{ height: SLOT, width: 30, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={it.icon} size={15} color={active === i ? theme.primary : theme.mutedForeground} />
          </View>
        ))}
      </View>
      {current && active != null ? (
        <View
          pointerEvents="none"
          className="rounded-control flex-row items-center px-3"
          style={{
            position: "absolute",
            right: 40,
            top: "50%",
            marginTop: (active - (items.length - 1) / 2) * SLOT - 20,
            height: 40,
            gap: 8,
            backgroundColor: theme.card,
            borderWidth: 1,
            borderColor: theme.primary,
          }}
        >
          <Ionicons name={current.icon} size={16} color={theme.primary} />
          <Text className="text-body font-semibold text-foreground" numberOfLines={1}>
            {current.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
