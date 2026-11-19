import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useMemo, useRef, useState } from "react";
import { PanResponder, View, type LayoutChangeEvent } from "react-native";
import { Text } from "./Text";
import { useTheme } from "@/hooks/use-theme";

export interface RailItem {
  key: string;
  /** In the bubble beside the thumb: "November 2026", "Food". */
  label: string;
  /** Drawn on the rail: an icon, or a few letters ("Nov", "12"). */
  icon?: keyof typeof Ionicons.glyphMap;
  short?: string;
}

const SLOT = 30;
/** Below this a rail of many groups draws every second (third…) one; all of them still answer the thumb. */
const MIN_SLOT = 18;

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
  const [avail, setAvail] = useState(0);
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
  // Long lists (two years of months) fit the space: fewer marks drawn, every group still reachable.
  const room = avail > 0 ? avail - 24 : items.length * SLOT;
  const step = Math.max(1, Math.ceil(items.length / Math.max(2, Math.floor(room / MIN_SLOT))));
  const drawn = items.map((it, i) => ({ it, i })).filter(({ i }) => i % step === 0);
  const slot = Math.min(SLOT, room / drawn.length);
  const railH = drawn.length * slot + 12;
  const bubbleTop = active != null ? (avail - railH) / 2 + 6 + ((active + 0.5) / items.length) * (railH - 12) - 20 : 0;

  return (
    <View
      pointerEvents="box-none"
      onLayout={(e: LayoutChangeEvent) => setAvail(e.nativeEvent.layout.height)}
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
        {drawn.map(({ it, i }) => {
          const on = active != null && active >= i && active < i + step;
          return (
            <View key={it.key} pointerEvents="none" style={{ height: slot, width: 30, alignItems: "center", justifyContent: "center" }}>
              {it.icon ? (
                <Ionicons name={it.icon} size={15} color={on ? theme.primary : theme.mutedForeground} />
              ) : (
                <Text style={{ fontSize: 10, fontWeight: "700", color: on ? theme.primary : theme.mutedForeground }} numberOfLines={1}>
                  {it.short ?? it.label.slice(0, 3)}
                </Text>
              )}
            </View>
          );
        })}
      </View>
      {current && active != null ? (
        <View
          pointerEvents="none"
          className="rounded-control flex-row items-center px-3"
          style={{
            position: "absolute",
            right: 40,
            top: Math.max(0, bubbleTop),
            height: 40,
            gap: 8,
            backgroundColor: theme.card,
            borderWidth: 1,
            borderColor: theme.primary,
          }}
        >
          {current.icon ? <Ionicons name={current.icon} size={16} color={theme.primary} /> : null}
          <Text className="text-body font-semibold text-foreground" numberOfLines={1}>
            {current.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
