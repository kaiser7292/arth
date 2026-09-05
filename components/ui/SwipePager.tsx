import { useCallback, useEffect, useRef, useState } from "react";
import { Text } from "./Text";
import { Animated, Pressable, ScrollView, View } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";

export interface SwipePagerPage {
  key: string;
  label: string;
}

interface SwipePagerProps {
  pages: SwipePagerPage[];
  activeIndex: number;
  onIndexChange: (index: number) => void;
  children: React.ReactNode[];
  trailing?: React.ReactNode;
  /**
   * MINIMUM width of each tab cell. Defaults to 80. Tabs grow past it to fit their label, so a
   * long one is never truncated - this used to be a fixed width, which clipped "Monthly Summary"
   * to "Monthly Su...".
   */
  tabWidth?: number;
}

export function SwipePager({ pages, activeIndex, onIndexChange, children, trailing, tabWidth: tabWidthProp }: SwipePagerProps) {
  const tw = tabWidthProp ?? 80;
  const { colors } = useColorScheme();
  const theme = useTheme();
  const contentRef = useRef<ScrollView>(null);
  const tabStripRef = useRef<ScrollView>(null);
  // Dimensions of the content area (below tab strip)
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });
  // Measured tab geometry. Tabs are sized by their label, so the underline cannot be derived from
  // a constant - it has to follow what actually got laid out.
  const [tabs, setTabs] = useState<{ x: number; width: number }[]>([]);
  const measured = tabs.length === pages.length && tabs.every((t) => t && t.width > 0);
  const scrollX = useRef(new Animated.Value(0)).current;

  // Scroll content to active page whenever activeIndex changes (from tab tap)
  useEffect(() => {
    if (contentSize.width === 0) return;
    contentRef.current?.scrollTo({ x: activeIndex * contentSize.width, animated: true });
    // Keep tab strip centred on active tab
    const prev = tabs[activeIndex - 1];
    tabStripRef.current?.scrollTo({ x: prev ? prev.x : 0, animated: true });
  }, [activeIndex, contentSize.width, tabs]);

  const handleTabPress = useCallback(
    (index: number) => {
      onIndexChange(index);
    },
    [onIndexChange],
  );

  const handleMomentumScrollEnd = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      if (contentSize.width === 0) return;
      const newIndex = Math.round(e.nativeEvent.contentOffset.x / contentSize.width);
      if (newIndex !== activeIndex) {
        onIndexChange(newIndex);
        const prev = tabs[newIndex - 1];
        tabStripRef.current?.scrollTo({ x: prev ? prev.x : 0, animated: true });
      }
    },
    [activeIndex, contentSize.width, onIndexChange, tabs],
  );

  /**
   * Underline geometry, interpolated from measured tabs so it matches whatever width each label
   * needed.
   *
   * `width` cannot be animated with the native driver, which the page scroll uses, so the bar is
   * 1px wide and scaled. scaleX grows it about its own centre, hence positioning by tab centre.
   */
  const INSET = 14;
  const canAnimate = measured && contentSize.width > 0 && pages.length > 1;
  const inputRange = pages.map((_, i) => i * contentSize.width);

  const underlineX = canAnimate
    ? scrollX.interpolate({
        inputRange,
        outputRange: tabs.map((t) => t.x + t.width / 2 - 0.5),
        extrapolate: "clamp",
      })
    : new Animated.Value(measured ? tabs[activeIndex].x + tabs[activeIndex].width / 2 - 0.5 : 0);

  const underlineScale = canAnimate
    ? scrollX.interpolate({
        inputRange,
        outputRange: tabs.map((t) => Math.max(1, t.width - INSET * 2)),
        extrapolate: "clamp",
      })
    : new Animated.Value(measured ? Math.max(1, tabs[activeIndex].width - INSET * 2) : 1);

  return (
    <View style={{ flex: 1 }}>
      {/* Tab strip */}
      <View style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 0.5, borderBottomColor: colors.border, backgroundColor: colors.background }}>
        <ScrollView
          ref={tabStripRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          // Intrinsic widths can overflow with as few as three long labels.
          scrollEnabled
          style={{ flex: 1 }}
          contentContainerStyle={{ position: "relative" }}
        >
          {pages.map((page, index) => (
            <Pressable
              key={page.key}
              onPress={() => handleTabPress(index)}
              onLayout={(e) => {
                const { x, width } = e.nativeEvent.layout;
                setTabs((prev) => {
                  const next = [...prev];
                  next[index] = { x, width };
                  return next;
                });
              }}
              style={{ minWidth: tw, height: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 }}
              hitSlop={8}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 13,
                  fontWeight: activeIndex === index ? "600" : "400",
                  color: activeIndex === index ? theme.primary : colors.textSecondary,
                }}
              >
                {page.label}
              </Text>
            </Pressable>
          ))}

          {/* Animated underline pill */}
          <Animated.View
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              height: 2,
              width: 1,
              opacity: measured ? 1 : 0,
              backgroundColor: theme.primary,
              borderRadius: 2,
              transform: [{ translateX: underlineX }, { scaleX: underlineScale }],
            }}
          />
        </ScrollView>
        {trailing && (
          <View style={{ paddingHorizontal: 12, flexDirection: "row", alignItems: "center" }}>
            {trailing}
          </View>
        )}
      </View>

      {/* Content area — captures its own size so pages fill it exactly */}
      <View
        style={{ flex: 1 }}
        onLayout={(e) =>
          setContentSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
        }
      >
        {contentSize.width > 0 && (
          <Animated.ScrollView
            ref={contentRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            decelerationRate="fast"
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
              useNativeDriver: true,
            })}
            onMomentumScrollEnd={handleMomentumScrollEnd}
            style={{ flex: 1 }}
            contentContainerStyle={{
              flexDirection: "row",
              height: contentSize.height,
            }}
          >
            {children.map((child, index) => (
              <View
                key={pages[index]?.key ?? index}
                style={{ width: contentSize.width, height: contentSize.height }}
              >
                {child}
              </View>
            ))}
          </Animated.ScrollView>
        )}
      </View>
    </View>
  );
}
