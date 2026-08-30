import { DEFAULT_USER_ID } from "@/constants/app";
import { Colors, Shadows } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { setHasLandedOnHome } from "@/services/biometric-lock";
import { getPendingExpenseCount } from "@/services/expense";
import { subscribeDataVersion } from "@/services/settings";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Tabs } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function TabLayout() {
  const { colors } = useColorScheme();
  const insets = useSafeAreaInsets();
  const [pendingCount, setPendingCount] = useState(0);

  const refreshPending = useCallback(async () => {
    const count = await getPendingExpenseCount(DEFAULT_USER_ID);
    setPendingCount(count);
  }, []);

  useEffect(() => {
    refreshPending();
    setHasLandedOnHome(true);
    const interval = setInterval(refreshPending, 30_000);
    const sub = subscribeDataVersion(refreshPending);
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [refreshPending]);

  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenListeners={{
        tabPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        },
      }}
      screenOptions={{
        tabBarActiveTintColor: colors.tint,
        tabBarInactiveTintColor: colors.tabIconDefault,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopWidth: 0,
          height: 60 + insets.bottom,
          paddingBottom: 8 + insets.bottom,
          paddingTop: 8,
          ...Shadows.tabBar,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Arth",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="expenses"
        options={{
          // v15.13.1: renamed tab to "Transactions" — reflects that the list
          // shows expenses, credits, and (via filter) refunds/forecasts. Route
          // name stays "expenses" to avoid breaking deep-links that went
          // through `constants/routes.ts` or any saved navigation state.
          title: "Transactions",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="receipt-outline" size={size} color={color} />
          ),
          tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.budget.over, fontSize: 10 },
        }}
      />
      <Tabs.Screen
        name="budget"
        options={{
          title: "Budget",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="wallet-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="goals"
        options={{
          title: "Goals",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trophy-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
    </View>
  );
}
