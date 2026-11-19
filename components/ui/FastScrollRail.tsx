import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { Text } from "./Text";
import { useTheme } from "@/hooks/use-theme";

export interface RailItem {
  key: string;
  /** In the bubble beside the thumb: "November 2026", "Food". */
  label: string;
  /** Drawn on the rail: an icon, or a few letters ("Nov", "12"). */
  icon?: keyof typeof Ionicons.glyphMap;
  /** A drawn mark of its own instead (an account-type icon), in the colour and size given. */
  glyph?: (color: string, size: number) => ReactNode;
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
export function FastScrollRail({
  items,
  onSelect,
  bottomInset = 0,
}: {
  items: RailItem[];
  onSelect: (index: number) => void;
  /** Keep clear of a FAB in the bottom corner. */
  bottomInset?: number;
}) {
  const theme = useTheme();
  const [active, setActive] = useState<number | null>(null);
  const [avail, setAvail] = useState(0);
  const [bubbleH, setBubbleH] = useState(56);
  const { width: winW } = useWindowDimensions();
  // Wide enough for a whole name, wrapped onto a second line when it needs one, never truncated
  // (owner, Nov 2026: "all the names get truncated, wrap it and make it bigger").
  const bubbleW = Math.max(160, Math.min(280, winW - 72));
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
  const thumbY = active != null ? (avail - railH) / 2 + 6 + ((active + 0.5) / items.length) * (railH - 12) : 0;
  const bubbleTop = Math.max(0, Math.min(Math.max(0, avail - bubbleH), thumbY - bubbleH / 2));

  return (
    <View
      pointerEvents="box-none"
      onLayout={(e: LayoutChangeEvent) => setAvail(e.nativeEvent.layout.height)}
      style={{ position: "absolute", right: 2, top: 0, bottom: bottomInset, justifyContent: "center" }}
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
              {it.glyph ? (
                it.glyph(on ? theme.primary : theme.mutedForeground, 15)
              ) : it.icon ? (
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
          onLayout={(e: LayoutChangeEvent) => setBubbleH(e.nativeEvent.layout.height)}
          className="rounded-card flex-row items-center"
          style={{
            position: "absolute",
            right: 40,
            top: bubbleTop,
            width: bubbleW,
            minHeight: 56,
            paddingHorizontal: 14,
            paddingVertical: 10,
            gap: 10,
            backgroundColor: theme.card,
            borderWidth: 1.5,
            borderColor: theme.primary,
          }}
        >
          {current.glyph ? current.glyph(theme.primary, 22) : current.icon ? <Ionicons name={current.icon} size={22} color={theme.primary} /> : null}
          <Text className="font-bold text-foreground" style={{ flex: 1, fontSize: 18, lineHeight: 23 }} numberOfLines={2}>
            {current.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
