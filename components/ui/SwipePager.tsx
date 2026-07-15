import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, Text, View } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";

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
  /** Width of each tab label cell. Defaults to 80. Increase for longer labels. */
  tabWidth?: number;
}

export function SwipePager({ pages, activeIndex, onIndexChange, children, trailing, tabWidth: tabWidthProp }: SwipePagerProps) {
  const tw = tabWidthProp ?? 80;
  const { colors, accent } = useColorScheme();
  const contentRef = useRef<ScrollView>(null);
  const tabStripRef = useRef<ScrollView>(null);
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });
  const [tabStripWidth, setTabStripWidth] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;

  // When tabs fit within the strip, centre them; otherwise left-align and scroll.
  const totalTabsWidth = pages.length * tw;
  const centerOffset = tabStripWidth > 0 ? Math.max(0, (tabStripWidth - totalTabsWidth) / 2) : 0;

  // Scroll content to active page whenever activeIndex changes (from tab tap)
  useEffect(() => {
    if (contentSize.width === 0) return;
    contentRef.current?.scrollTo({ x: activeIndex * contentSize.width, animated: true });
    tabStripRef.current?.scrollTo({ x: Math.max(0, (activeIndex - 1) * tw), animated: true });
  }, [activeIndex, contentSize.width, tw]);

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
        tabStripRef.current?.scrollTo({ x: Math.max(0, (newIndex - 1) * tw), animated: true });
      }
    },
    [activeIndex, contentSize.width, onIndexChange],
  );

  // Underline translates across the tab strip in sync with page scroll.
  // Add centerOffset so it stays under the correct (centred) tab.
  const underlineX =
    contentSize.width > 0
      ? scrollX.interpolate({
          inputRange: pages.map((_, i) => i * contentSize.width),
          outputRange: pages.map((_, i) => centerOffset + i * tw),
          extrapolate: "clamp",
        })
      : new Animated.Value(centerOffset + activeIndex * tw);

  return (
    <View style={{ flex: 1 }}>
      {/* Tab strip */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderBottomWidth: 0.5,
          borderBottomColor: colors.border,
          backgroundColor: colors.background,
        }}
        onLayout={(e) => setTabStripWidth(e.nativeEvent.layout.width)}
      >
        <ScrollView
          ref={tabStripRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEnabled={pages.length > 4}
          style={{ flex: 1 }}
          contentContainerStyle={{ position: "relative", flexGrow: 1, justifyContent: "center" }}
        >
          {pages.map((page, index) => (
            <Pressable
              key={page.key}
              onPress={() => handleTabPress(index)}
              style={{ width: tw, height: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}
              hitSlop={8}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 13,
                  fontWeight: activeIndex === index ? "600" : "400",
                  color: activeIndex === index ? accent[500] : colors.textSecondary,
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
              height: 2,
              width: tw - 28, // 14px margin each side
              marginHorizontal: 14,
              backgroundColor: accent[500],
              borderRadius: 2,
              transform: [{ translateX: underlineX }],
            }}
          />
        </ScrollView>
        {trailing && (
          <View style={{ paddingHorizontal: 12, flexDirection: "row", alignItems: "center" }}>
            {trailing}
          </View>
        )}
      </View>

      {/* Content area */}
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
