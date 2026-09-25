import { useEffect, useRef } from "react";
import { Animated, Appearance, Easing, View } from "react-native";
import { Circle, G, Rect, Svg } from "react-native-svg";
import { Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

/**
 * The Arth loader: pulsing logo, wordmark and a status line.
 *
 * Shown by the root layout while the database opens, and by Home while its first data loads
 * (so Home never opens on zeros). Home uses it in-screen rather than holding the root splash:
 * holding the root splash delayed the navigator, and the biometric-lock redirect - which runs
 * during the splash - raced it (v4.1.6: no unlock prompt, sometimes stuck on the loader).
 */
export function ArthLoader({ step }: { step?: string }) {
  const theme = useTheme();
  const isDark = Appearance.getColorScheme() === "dark";
  const pulseAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.6,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: isDark ? "#111111" : "#FFFFFF" }}>
      <Animated.View style={{ 
        opacity: pulseAnim,
        marginBottom: 20,
        shadowColor: "#134E4A",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 8
      }}>
        <View style={{ width: 120, height: 120, borderRadius: 30, overflow: 'hidden' }}>
          <Svg width={120} height={120} viewBox="0 0 400 400">
            <Rect
              width="400"
              height="400"
              rx="80"
              ry="80"
              fill="#134E4A"
            />
            <Circle
              cx="200"
              cy="200"
              r="152"
              fill="none"
              stroke={theme.warning}
              strokeWidth="5.5"
            />
            <Circle
              cx="200"
              cy="200"
              r="139"
              fill="none"
              stroke={theme.warning}
              strokeWidth="1.2"
            />
            <G fill={theme.warning} opacity={0.6}>
              <Circle cx="200" cy="55" r="2.3"/>
              <Circle cx="271" cy="75" r="2.3"/>
              <Circle cx="325" cy="129" r="2.3"/>
              <Circle cx="345" cy="200" r="2.3"/>
              <Circle cx="325" cy="271" r="2.3"/>
              <Circle cx="271" cy="325" r="2.3"/>
              <Circle cx="200" cy="345" r="2.3"/>
              <Circle cx="129" cy="325" r="2.3"/>
              <Circle cx="75" cy="271" r="2.3"/>
              <Circle cx="55" cy="200" r="2.3"/>
              <Circle cx="75" cy="129" r="2.3"/>
              <Circle cx="129" cy="75" r="2.3"/>
            </G>
          </Svg>
          <View style={{ position: 'absolute', width: 120, height: 120, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 60, fontWeight: "bold", color: "#FFFFFF" }}>अ</Text>
          </View>
        </View>
      </Animated.View>
      <Text style={{ fontSize: 36, fontWeight: "bold", color: isDark ? "#FFFFFF" : "#111111", letterSpacing: 2 }}>
        अर्थ
      </Text>
      <Text style={{ fontSize: 16, fontWeight: "600", color: isDark ? "#D1D5DB" : theme.mutedForeground, marginTop: 4, letterSpacing: 3, textTransform: "uppercase" }}>
        Arth
      </Text>
      <Text style={{ fontSize: 13, color: isDark ? theme.mutedForeground : theme.faintForeground, marginTop: 12, fontStyle: "italic" }}>
        your finances, your way
      </Text>
      <Text style={{ fontSize: 12, color: isDark ? theme.mutedForeground : theme.faintForeground, marginTop: 32 }}>
        {step ?? ""}
      </Text>
    </View>
  );
}
